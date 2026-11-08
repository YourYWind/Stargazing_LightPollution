# 观星地图 · 中国光污染可视化（纯静态版）

原项目基于阿里云服务器 + GeoServer 发布 `World_Atlas_2015` 栅格图层，前端通过 `AMap.TileLayer.WMS` 与 `GetFeatureInfo` 取数据。
本目录是**去掉 GeoServer 的纯静态版本**：光污染数据在构建阶段预渲染成 XYZ 瓦片与两级栅格索引，前端只读取静态文件，可直接托管在 GitHub Pages / 任意静态服务器上。

## 目录结构

```
site/
├── index.html                入口（自动跳转到 lightpollution.html）
├── lightpollution.html       主页面（地图、查询、统计）
├── js/
│   ├── region.js             省/市/区县数据与搜索
│   └── echarts.min.js        ECharts 5.4.3（随仓库内置，不依赖 CDN）
├── img/logo.png
├── tools/
│   └── build_data.py         构建脚本：TIF/zip → 瓦片 + 栅格索引
├── data/
│   ├── lp_level.png          0.02° 波特尔等级栅格（3200×1900，8 位，0=亮度恰为 0，1..7=等级）
│   ├── lp_value.png          0.10° 光污染数值栅格（640×380，8 位，对数量化）
│   ├── lp_overlay.png        整幅叠加图（父瓦片未就绪时的兜底取样源）
│   └── tile_stats.json       瓦片统计
└── tiles/{z}/{x}/{y}.png     预渲染 XYZ 瓦片，z0–z9（8794 张 / 9.41 MB）
```

站点合计 **8809 个文件 / 11.64 MB**。

## 数据链路

| 原方案（GeoServer） | 现方案（静态） |
|---|---|
| `AMap.TileLayer.WMS` + `STYLES=light_pollution_bright` | `AMap.TileLayer({getTileUrl})` → `tiles/{z}/{x}/{y}.png` |
| `GetFeatureInfo`（`info_format=application/json`）取单点数值 | 浏览器内读 `data/lp_value.png` 的 `ImageData` 取单点数值 |
| 区域统计逐点打 WMS（0.2° 采样、每批 20 个请求） | 纯内存采样 `calculateRegionPollutionFromWMS`，零网络请求 |

- **z ≤ 9**：直接命中预渲染瓦片。瓦片由源数据**原生分辨率**（`1/120°` = 120 px/deg）生成，z8 及以下逐像素还原，z9 起用双线性插值平滑放大。
- **z > 9**：`lpOverzoomTile()` 取 z9 父瓦片（364 px/deg）裁剪放大，`imageSmoothingEnabled = true` + `imageSmoothingQuality = 'high'`，放大倍数仅 2/4/8，无硬边马赛克。父瓦片尚未下载完时退回 `lp_overlay.png` 兜底。

## 分级口径（波特尔 7 级）

阈值 `[0.0005, 0.001, 0.005, 0.01, 0.03, 0.06]`，与页面 `getBortleLevel()`、`BRK` 生成脚本完全一致。

| 级 | 颜色 | 说明 |
|---|---|---|
| 1 | `#12203a` | 极暗 |
| 2 | `#1b4a7a` | 暗 |
| 3 | `#1f7a6a` | 良好 |
| 4 | `#c9c93b` | 中等 |
| 5 | `#e08f26` | 轻度 |
| 6 | `#d94f28` | 重度 |
| 7 | `#ff2d55` | 极重度 |

> 等级 0 **不是「无数据」**，而是该像元辐射值恰好为 0（青藏高原西侧、塔克拉玛干腹地、海面等完全无人工光源的区域），属有效观测值，等价波特尔 1 级「极暗」。因此：
>
> - 单点查询遇到 0 会正常弹出信息窗，数值显示为「0（无人工光源）」；
> - 区域统计把 0 级采样点计入 1 级，不会凭空少掉一大片区域；
> - 只有坐标落在栅格覆盖矩形（72–136°E / 17–55°N）之外，才判定为「无数据」并回退到城市距离衰减模型。

## 本地预览

```bash
cd site
python -m http.server 8899
# 打开 http://127.0.0.1:8899/
```

> 必须通过 HTTP 访问，直接双击 `file://` 打开会因 canvas 跨域污染导致取不到像素值。

## 部署到 GitHub Pages

见仓库根目录 `DEPLOY.md` 的操作条目。

## 数据来源与许可

光污染数据来自 **Falchi et al., 2016, The new world atlas of artificial night sky brightness**。

- 数据 DOI：<https://doi.org/10.5880/GFZ.1.4.2016.001>
- 论文 DOI：<https://doi.org/10.1126/sciadv.1600377>

原始数据集（`World_Atlas_2015.zip`，含约 3.0 GB GeoTIFF）**不在本仓库中**：其 `README.txt` 明确声明 *further distribution of these files and commercial use are both generally prohibited*，禁止再分发与商业使用。仓库内只保留由其派生的低分辨率可视化瓦片，并按上述要求引用两项 DOI。

如需完整精度数据，请自行向 GFZ 申请获取原始 GeoTIFF，再用 `tools/build_data.py` 重新生成。

## 重新生成数据

```bash
python tools/build_data.py --zip ../World_Atlas_2015.zip --out . --zmax 9
```

常用参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--zmax` | `9` | 预生成瓦片最深层级。10 → 25 MB，11 → 约 60 MB |
| `--step` | `1/120` | 网格步长 = 源数据原生分辨率。**不要调粗**，会重新引入马赛克 |
| `--level-step` | `0.02` | 查询用等级栅格步长 |
| `--value-step` | `0.1` | 查询用数值栅格步长 |
| `--overlay-step` | `0.02` | 叠加图取样步长（刻意比渲染分辨率粗，避免 canvas 超 30 MB） |
| `--grid-cache` | 无 | 指定 `.npy` 缓存全分辨率网格，二次构建可省去重读 3 GB TIF（首次约 156 秒，有缓存约 30 秒） |

初次构建建议先跑一次生成缓存：

```bash
python tools/build_data.py --zip ../World_Atlas_2015.zip --out . \
  --grid-cache "$TEMP/nat_grid.npy"
# 后续改 zmax 只需
python tools/build_data.py --zip ../World_Atlas_2015.zip --out . --zmax 10 --grid-cache "$TEMP/nat_grid.npy"
```
