# -*- coding: utf-8 -*-
"""从 World_Atlas_2015 GeoTIFF 重新生成站点所需的全部静态数据。

用法：
    python tools/build_data.py --tif "D:/path/World_Atlas_2015.tif" --out .

可选参数：
    --zip PATH        直接用官方 zip 包（内部文件名 World_Atlas_2015.tif），无需先解压
    --step FLOAT      渲染网格步长（度），默认 0.00833333（等于源数据原生 120 px/deg）
    --zmax INT        预渲染瓦片最大层级，默认 9
    --level-step      查询用等级栅格步长，默认 0.02
    --value-step      查询用数值栅格步长，默认 0.1

设计要点：渲染（瓦片 + 叠加图）用 --step 的全分辨率，查询栅格单独降采样到
--level-step / --value-step。查询只做点取样，0.02°（约 2.2 km）已远超需要，
按原生分辨率塞给浏览器会变成 7680x4560x4 = 140 MB 的 ImageData，移动端会崩。

产出（相对 --out）：
    data/lp_level.png     等级栅格（8 位灰度，0=无数据，1..7=等级），供点击查询
    data/lp_value.png     数值栅格（8 位灰度，对数量化），供点击查询
    data/lp_overlay.png   整幅 RGBA 叠加图（全分辨率，供 z>zmax 时裁剪放大）
    data/tile_stats.json  瓦片体积统计
    tiles/{z}/{x}/{y}.png XYZ 瓦片（调色板 PNG，索引 0 全透明）

依赖：numpy, Pillow
"""
import argparse
import io
import json
import math
import os
import struct
import time
import zipfile

import numpy as np
from PIL import Image

# ---------------------------------------------------------------- 常量
# 中国窗口（略作外扩），与前端 LP_DATA 的 lon0/lat0/w/h 必须一致
LONW, LONE, LATS, LATN = 72.0, 136.0, 17.0, 55.0
GLON0, GLAT1 = LONW, LATN           # 网格左上角
BRK = [0.0005, 0.001, 0.005, 0.01, 0.03, 0.06]   # 波特尔分级阈值
PAL = [(18, 32, 58), (27, 74, 122), (31, 122, 106),
       (201, 201, 59), (224, 143, 38), (217, 79, 40), (255, 45, 85)]
ALPHA = [90, 125, 150, 175, 195, 210, 225]
VALUE_FACTOR = 5                     # 数值栅格相对等级栅格的降采样倍数
LOG_MIN, LOG_SPAN = -6.0, 7.5        # 对数量化区间 log10(1e-6) .. log10(1e1.5)


# ---------------------------------------------------------------- GeoTIFF 读取
class TiledTiff:
    """只解析首部 IFD 的最小 GeoTIFF 读取器，支持 tiled + float32。"""

    _TYPE_SIZE = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1,
                  8: 2, 9: 4, 10: 8, 11: 4, 12: 8}

    def __init__(self, fh):
        head = fh.read(4096 * 200)
        if head[:2] == b'II':
            bo = '<'
        elif head[:2] == b'MM':
            bo = '>'
        else:
            raise ValueError('不是有效的 TIFF 文件')
        off = struct.unpack(bo + 'I', head[4:8])[0]
        n = struct.unpack(bo + 'H', head[off:off + 2])[0]
        tags = {}
        for i in range(n):
            e = off + 2 + i * 12
            tag, typ, cnt = struct.unpack(bo + 'HHI', head[e:e + 8])
            sz = self._TYPE_SIZE.get(typ, 1) * cnt
            if sz <= 4:
                raw = head[e + 8:e + 8 + sz]
            else:
                po = struct.unpack(bo + 'I', head[e + 8:e + 12])[0]
                raw = head[po:po + sz]
            if typ == 3:
                tags[tag] = struct.unpack(bo + '%dH' % cnt, raw[:2 * cnt])
            elif typ == 4:
                tags[tag] = struct.unpack(bo + '%dI' % cnt, raw[:4 * cnt])
            elif typ == 12:
                tags[tag] = struct.unpack(bo + '%dd' % cnt, raw[:8 * cnt])

        self.fh = fh
        self.bo = bo
        self.W, self.H = tags[256][0], tags[257][0]
        self.TW, self.TH = tags[322][0], tags[323][0]
        self.sx, self.sy = tags[33550][0], tags[33550][1]
        tp = tags[33922]
        self.lon0, self.lat0 = tp[3], tp[4]
        self.TOFF, self.TBC = tags[324], tags[325]
        self.tilesX = (self.W + self.TW - 1) // self.TW

    def read_window(self, lonw, lone, lats, latn):
        """读回指定经纬度窗口的 float32 数组，返回 (win, x0, y0)。

        x0/y0 是全图像素坐标系下窗口左上角的位置；调用方做下标换算时
        **必须先减去它们**，否则会拿到全图坐标却被 clip 到窗口边界，
        结果整幅静默变成角落那一个像元的值（此处曾导致全 0）。
        """
        x0 = int((lonw - self.lon0) / self.sx)
        x1 = int((lone - self.lon0) / self.sx)
        y0 = int((self.lat0 - latn) / self.sy)
        y1 = int((self.lat0 - lats) / self.sy)
        wpx, hpx = x1 - x0 + 1, y1 - y0 + 1
        win = np.zeros((hpx, wpx), dtype=np.float32)

        tx0, tx1 = x0 // self.TW, x1 // self.TW
        ty0, ty1 = y0 // self.TH, y1 // self.TH
        read = 0
        for ty in range(ty0, ty1 + 1):
            for tx in range(tx0, tx1 + 1):
                idx = ty * self.tilesX + tx
                self.fh.seek(self.TOFF[idx])
                b = self.fh.read(self.TBC[idx])
                dtype = ('<f4' if self.bo == '<' else '>f4')
                a = np.frombuffer(b, dtype=dtype).reshape(self.TH, self.TW)
                gx = tx * self.TW - x0
                gy = ty * self.TH - y0
                ax0, ay0 = max(0, gx), max(0, gy)
                ax1, ay1 = min(wpx, gx + self.TW), min(hpx, gy + self.TH)
                if ax1 <= ax0 or ay1 <= ay0:
                    continue
                win[ay0:ay1, ax0:ax1] = a[ay0 - gy:ay1 - gy, ax0 - gx:ax1 - gx]
                read += 1
        print('  读取 tile 数量 %d，像素窗口 %dx%d' % (read, wpx, hpx), flush=True)
        return win, x0, y0


def build_grid(tif, step):
    """把窗口数据重采样到等距经纬网格。"""
    gnx = int(round((LONE - LONW) / step))
    gny = int(round((GLAT1 - LATS) / step))
    win, wx0, wy0 = tif.read_window(LONW, LONE, LATS, LATN)
    hpx, wpx = win.shape
    # 目标网格中心点 -> 全图像素坐标 -> 减去窗口原点 -> 窗口内下标
    cx = ((np.arange(gnx) * step + GLON0 + step / 2 - tif.lon0) / tif.sx).astype(np.int32) - wx0
    cy = ((tif.lat0 - (GLAT1 - np.arange(gny) * step - step / 2)) / tif.sy).astype(np.int32) - wy0
    cx = np.clip(cx, 0, wpx - 1)
    cy = np.clip(cy, 0, hpx - 1)
    grid = win[np.ix_(cy, cx)]
    grid = np.nan_to_num(grid, nan=0.0, posinf=0.0, neginf=0.0)
    grid = np.where(grid > 1e30, 0.0, grid).astype(np.float32)   # 剔除 NODATA
    print('  网格 %s  %.2f MB' % (grid.shape, grid.nbytes / 1e6), flush=True)
    return grid


# ---------------------------------------------------------------- 派生数据
def classify(a):
    """按 BRK 阈值分级，返回 0..7。

    必须与前端 getBortleLevel()、以及 lp_level.png 的
    `searchsorted(BRK, v, side='right')+1` 完全一致：
        0            -> 0（无数据/全黑，透明）
        (0, 0.0005)  -> 1
        [0.0005,...) -> 2
        ...
        [0.06, +inf) -> 7
    注意不能写成 `cls[a >= th] = i + 1`，那样只产出 0..6，
    会让 7 级被画成 6 级色、1 级被画成透明（配色整体掉一档）。
    """
    cls = np.zeros(a.shape, dtype=np.uint8)
    cls[a > 0] = 1
    for i, th in enumerate(BRK):
        cls[a >= th] = i + 2
    return cls


def log_quantize(v):
    """对数量化到 1..255，0 保留给无数据。"""
    code = np.zeros(v.shape, dtype=np.uint8)
    nz = v >= 10 ** LOG_MIN
    code[nz] = np.clip(np.round((np.log10(v[nz]) - LOG_MIN) / LOG_SPAN * 254.0) + 1,
                       1, 255).astype(np.uint8)
    return code


def palette_png(cls, lut):
    """把等级数组输出成 8 色、索引 0 透明的调色板 PNG。"""
    img = Image.fromarray(cls, mode='L').convert('P')
    flat = []
    for i in range(8):
        flat += list(lut[i][:3])
    img.putpalette(flat + [0] * 12)
    buf = io.BytesIO()
    img.save(buf, 'PNG', optimize=True,
             transparency=bytes([lut[i][3] for i in range(8)]))
    return buf.getvalue()


def tile2lon(x, z):
    return x / (2 ** z) * 360.0 - 180.0


def tile2lat(y, z):
    n = math.pi - 2.0 * math.pi * y / (2 ** z)
    return math.degrees(math.atan(math.sinh(n)))


def lat2tile(lat, z):
    r = math.radians(lat)
    return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * (2 ** z))


def resample_grid(grid, step, qstep):
    """把渲染网格按最近邻重采样到查询步长（纯数组运算，不需要重读 TIF）。"""
    gny, gnx = grid.shape
    ny = int(round((GLAT1 - LATS) / qstep))
    nx = int(round((LONE - LONW) / qstep))
    xs = np.round((np.arange(nx) * qstep + qstep / 2) / step - 0.5).astype(np.int32)
    ys = np.round((np.arange(ny) * qstep + qstep / 2) / step - 0.5).astype(np.int32)
    xs = np.clip(xs, 0, gnx - 1)
    ys = np.clip(ys, 0, gny - 1)
    return grid[np.ix_(ys, xs)]


def block_mean(grid, fc):
    """fc×fc 分块求均值，用于生成较粗的数值栅格。"""
    gny, gnx = grid.shape
    hc, wc = gny // fc, gnx // fc
    blocks = grid[:hc * fc, :wc * fc].reshape(hc, fc, wc, fc)
    with np.errstate(all='ignore'):
        return blocks.mean(axis=(1, 3))


# ---------------------------------------------------------------- 主流程
def main():
    ap = argparse.ArgumentParser(description='生成静态光污染瓦片与栅格')
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument('--tif', help='World_Atlas_2015.tif 路径')
    src.add_argument('--zip', help='World_Atlas_2015.zip 路径（自动定位内部 tif）')
    ap.add_argument('--out', default='.', help='站点根目录，默认当前目录')
    ap.add_argument('--step', type=float, default=1.0 / 120.0,
                    help='渲染网格步长（度），默认 1/120 即源数据原生分辨率')
    ap.add_argument('--zmax', type=int, default=9, help='最大预渲染层级，默认 9')
    ap.add_argument('--level-step', type=float, default=0.02,
                    help='查询用等级栅格步长（度），默认 0.02')
    ap.add_argument('--value-step', type=float, default=0.1,
                    help='查询用数值栅格步长（度），默认 0.1')
    ap.add_argument('--overlay-step', type=float, default=0.02,
                    help='叠加图取样步长（度），默认 0.02；只用于 z>zmax 的放大')
    ap.add_argument('--grid-cache', help='渲染网格 .npy 缓存路径，可加速重复构建')
    args = ap.parse_args()

    t0 = time.time()
    data_dir = os.path.join(args.out, 'data')
    tiles_dir = os.path.join(args.out, 'tiles')
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(tiles_dir, exist_ok=True)
    step = args.step

    # 1. 取数据（渲染网格）
    if args.grid_cache and os.path.exists(args.grid_cache):
        grid = np.load(args.grid_cache)
        print('[1/5] 使用网格缓存 %s %s' % (args.grid_cache, grid.shape), flush=True)
    else:
        print('[1/5] 读取 GeoTIFF ...', flush=True)
        if args.zip:
            zf = zipfile.ZipFile(args.zip)
            name = next(n for n in zf.namelist() if n.lower().endswith('.tif'))
            fh = zf.open(name)
        else:
            fh = open(args.tif, 'rb')
        tif = TiledTiff(fh)
        print('  尺寸 %dx%d  tile %dx%d  像元 %.6f°  →  %.1f px/deg' %
              (tif.W, tif.H, tif.TW, tif.TH, tif.sx, 1.0 / tif.sx), flush=True)
        grid = build_grid(tif, step)
        fh.close()
        if args.grid_cache:
            np.save(args.grid_cache, grid)
            print('  网格缓存已写入 %s' % args.grid_cache, flush=True)

    gny, gnx = grid.shape
    expect = (int(round((GLAT1 - LATS) / step)), int(round((LONE - LONW) / step)))
    if grid.shape != expect:
        raise SystemExit('网格尺寸 %s 与预期 %s 不符，请检查 --step' % (grid.shape, expect))

    lut = np.zeros((8, 4), dtype=np.uint8)
    lut[0] = (0, 0, 0, 0)
    for i in range(7):
        lut[i + 1] = (*PAL[i], ALPHA[i])

    # 2. 渲染用等级数组（全分辨率，供瓦片）
    print('[2/5] 生成等级栅格 ...', flush=True)
    lv = classify(grid)

    # 2a. 查询用等级栅格：只在 level_step 比 step 更粗时才降采样。
    #     判断方向不能写反 —— 写反会让 lp_level.png 保持 7680×4560，
    #     浏览器端 getImageData 要占 140 MB，移动端必崩。
    if args.level_step > step + 1e-9:
        qlv = classify(resample_grid(grid, step, args.level_step))
        qstep = args.level_step
    else:
        qlv, qstep = lv, step
    p = os.path.join(data_dir, 'lp_level.png')
    Image.fromarray(qlv, mode='L').save(p, optimize=True)
    print('  lp_level.png %.1f KB %dx%d step %.4f' %
          (os.path.getsize(p) / 1024, qlv.shape[1], qlv.shape[0], qstep), flush=True)

    # 3. 查询用数值栅格（块均值 + 对数量化）
    print('[3/5] 生成数值栅格 ...', flush=True)
    fc = max(1, int(round(args.value_step / step)))
    hc, wc = gny // fc, gnx // fc
    coarse = block_mean(grid, fc) if fc > 1 else grid[:hc * fc, :wc * fc]
    p = os.path.join(data_dir, 'lp_value.png')
    Image.fromarray(log_quantize(coarse), mode='L').save(p, optimize=True)
    print('  lp_value.png %.1f KB %dx%d step %.4f' %
          (os.path.getsize(p) / 1024, wc, hc, step * fc), flush=True)

    # 4. 整幅叠加图（z>zmax 时的高缩放取样源）
    #    只用于超出瓦片层级的放大，此时数据本就已重度上采样，
    #    因此刻意限制在 overlay_step，避免 canvas 占用超过 30 MB。
    print('[4/5] 生成叠加图 ...', flush=True)
    if args.overlay_step > step + 1e-9:
        ovl = classify(resample_grid(grid, step, args.overlay_step))
        ostep = args.overlay_step
    else:
        ovl, ostep = lv, step
    p = os.path.join(data_dir, 'lp_overlay.png')
    Image.fromarray(lut[ovl], 'RGBA').save(p, optimize=True)
    print('  lp_overlay.png %.1f KB %dx%d step %.4f' %
          (os.path.getsize(p) / 1024, ovl.shape[1], ovl.shape[0], ostep), flush=True)

    # 5. XYZ 瓦片
    print('[5/5] 生成 XYZ 瓦片 z0..z%d ...' % args.zmax, flush=True)
    stats = {}
    for z in range(0, args.zmax + 1):
        n = 2 ** z
        xa = int((LONW + 180) / 360 * n)
        xb = int((LONE + 180) / 360 * n)
        ya, yb = lat2tile(LATN, z), lat2tile(LATS, z)
        tot = cnt = 0
        for tx in range(xa, xb + 1):
            lo0, lo1 = tile2lon(tx, z), tile2lon(tx + 1, z)
            gx0 = int((lo0 - GLON0) / step)
            gx1 = max(gx0 + 1, int((lo1 - GLON0) / step))
            ixx = np.clip(np.arange(gx0, gx1), 0, gnx - 1)
            d = os.path.join(tiles_dir, str(z), str(tx))
            os.makedirs(d, exist_ok=True)
            for ty in range(ya, yb + 1):
                la0, la1 = tile2lat(ty, z), tile2lat(ty + 1, z)
                gy0 = int((GLAT1 - la0) / step)
                gy1 = max(gy0 + 1, int((GLAT1 - la1) / step))
                iyy = np.clip(np.arange(gy0, gy1), 0, gny - 1)
                blk = grid[np.ix_(iyy, ixx)]
                # 源数据比瓦片密（z <= 原生层级）用 NEAREST 保持原貌；
                # 源数据比瓦片稀（z 超过原生层级）改用 BILINEAR，
                # 让放大时呈现渐变色块而不是硬边马赛克。
                native_z = math.log2(360.0 / step / 256.0)
                resample = Image.BILINEAR if z > native_z else Image.NEAREST
                a = np.array(Image.fromarray(blk, mode='F').resize((256, 256), resample))
                b = palette_png(classify(a), lut)
                with open(os.path.join(d, '%d.png' % ty), 'wb') as fh:
                    fh.write(b)
                tot += len(b)
                cnt += 1
        stats[z] = {'tiles': cnt, 'KB': round(tot / 1024, 1)}
        print('  z%d  %d 张  %.1f KB' % (z, cnt, tot / 1024), flush=True)

    total_kb = sum(v['KB'] for v in stats.values())
    print('  瓦片合计 %.1f KB = %.2f MB' % (total_kb, total_kb / 1024), flush=True)
    with open(os.path.join(data_dir, 'tile_stats.json'), 'w', encoding='utf-8') as fh:
        json.dump(stats, fh, indent=1, ensure_ascii=False)

    print('完成，用时 %.1fs' % (time.time() - t0), flush=True)


if __name__ == '__main__':
    main()
