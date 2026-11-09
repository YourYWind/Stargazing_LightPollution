// ================================================================
// 光污染数据层（本地栅格 + 预渲染瓦片）
// ================================================================
//
// data/lp_level.png 与 data/lp_value.png 两幅 8 位栅格在内存中提供单点查询；
// tiles/{z}/{x}/{y}.png 提供地图瓦片，超出预生成层级后从最深层父瓦片裁剪放大。
// 对外接口：loadLPData()、loadLPOverlay()、getLevelAt()、getValueAt()、queryWMSFeatureInfo()。
//

// ================================================================
// 本地光污染栅格（替代 GeoServer WMS GetFeatureInfo）
// ================================================================
//
// data/lp_level.png  3200×1900，8 位单通道，0=无数据，1..7=波特尔等级
// data/lp_value.png   640× 380，8 位单通道，对数量化后的亮度值（0.1° 粗网格）
//
// 两图左上角均为 (72°E, 55°N)，分别按 0.02° / 0.1° 向东、向南排列。
// ----------------------------------------------------------------

const LP_DATA = {
    level: { url: 'data/lp_level.png', step: 0.02, lon0: 72.0, lat0: 55.0, w: 0, h: 0, px: null },
    value: { url: 'data/lp_value.png', step: 0.10, lon0: 72.0, lat0: 55.0, w: 0, h: 0, px: null },
    ready: false
};

// ---- 瓦片与叠加图 ------------------------------------------------
const LP_TILE_ROOT = 'tiles/';
const LP_MAX_TILE_ZOOM = 9;         // 预生成瓦片的最深层级（源数据原生约 z7.4）
const LP_OVERLAY_URL = 'data/lp_overlay.png';
const LP_OVERLAY = { canvas: null, w: 0, h: 0, loading: false };

// 载入整幅叠加图，供高缩放级别裁剪放大
function loadLPOverlay() {
    if (LP_OVERLAY.loading || LP_OVERLAY.canvas) return;
    LP_OVERLAY.loading = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        cv.getContext('2d').drawImage(img, 0, 0);
        LP_OVERLAY.canvas = cv;
        LP_OVERLAY.w = cv.width;
        LP_OVERLAY.h = cv.height;
        LP_OVERLAY.loading = false;
        console.log('光污染叠加图就绪', cv.width + '×' + cv.height);
        if (wmsLayer && wmsLayer.reload) wmsLayer.reload();
    };
    img.onerror = function () {
        LP_OVERLAY.loading = false;
        console.error('光污染叠加图加载失败:', LP_OVERLAY_URL);
    };
    img.src = LP_OVERLAY_URL;
}

// 高缩放级别：超出预生成层级后，从【最深层瓦片】裁剪放大。
// 早期版本从整幅叠加图（0.02°，仅 50 px/deg）裁剪，在 z10 相当于 14 倍放大，
// 马赛克非常明显；改从 z9 瓦片（364 px/deg）裁剪后放大倍数为 2、4、8…，清晰得多。
const LP_OVERZOOM_LEVEL = LP_MAX_TILE_ZOOM;   // 用作放大源的最深层级
const LP_BLANK_TILE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const lpTileCache = new Map();
const lpParentCache = new Map();   // 'z/x/y' -> { img, state }

// 同步返回父级瓦片图像；未就绪时触发加载并返回 null
function lpGetParentTile(px, py) {
    const key = LP_OVERZOOM_LEVEL + '/' + px + '/' + py;
    let ent = lpParentCache.get(key);
    if (ent) return ent.state === 'ready' ? ent.img : null;
    ent = { img: new Image(), state: 'loading' };
    lpParentCache.set(key, ent);
    ent.img.crossOrigin = 'anonymous';
    ent.img.onload = function () {
        ent.state = 'ready';
        // 更清晰的源到了：丢弃基于旧源生成的瓦片并重新请求
        lpTileCache.clear();
        if (wmsLayer && wmsLayer.reload) wmsLayer.reload();
    };
    ent.img.onerror = function () {
        ent.state = 'error';
        if (wmsLayer && wmsLayer.reload) wmsLayer.reload();
    };
    ent.img.src = LP_TILE_ROOT + LP_OVERZOOM_LEVEL + '/' + px + '/' + py + '.png';
    return null;
}

function lpOverzoomTile(x, y, z) {
    const key = z + '/' + x + '/' + y;
    if (lpTileCache.has(key)) return lpTileCache.get(key);

    // 1) 优先：由最深层瓦片裁剪（解析度最高）
    const d = z - LP_OVERZOOM_LEVEL;
    const px = x >> d, py = y >> d;
    const parent = lpGetParentTile(px, py);
    if (parent) {
        const sub = 256 / Math.pow(2, d);           // 子瓦片在父瓦片中的边长
        const ox = (x - (px << d)) * sub;
        const oy = (y - (py << d)) * sub;
        const cv = document.createElement('canvas');
        cv.width = 256;
        cv.height = 256;
        const cx = cv.getContext('2d');
        cx.imageSmoothingEnabled = true;             // 平滑插值，避免硬边马赛克
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(parent, ox, oy, sub, sub, 0, 0, 256, 256);
        const url = cv.toDataURL('image/png');
        lpTileCache.set(key, url);
        return url;
    }

    // 2) 兜底：父瓦片仍在加载时，用整幅叠加图先顶上，避免出现空洞
    if (LP_OVERLAY.canvas) {
        const n = Math.pow(2, z);
        const lonL = x / n * 360 - 180;
        const lonR = (x + 1) / n * 360 - 180;
        const latT = Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y / n)) * 180 / Math.PI;
        const latB = Math.atan(Math.sinh(Math.PI - 2 * Math.PI * (y + 1) / n)) * 180 / Math.PI;
        const step = 0.02;
        const sx = (lonL - 72.0) / step;
        const sy = (55.0 - latT) / step;
        const sw = (lonR - lonL) / step;
        const sh = (latT - latB) / step;
        if (sx + sw <= 0 || sy + sh <= 0 || sx >= LP_OVERLAY.w || sy >= LP_OVERLAY.h) {
            return LP_BLANK_TILE;   // 范围外，且不缓存（父瓦片到达后由 reload 重新判定）
        }
        const cv = document.createElement('canvas');
        cv.width = 256;
        cv.height = 256;
        const cx = cv.getContext('2d');
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(LP_OVERLAY.canvas, sx, sy, sw, sh, 0, 0, 256, 256);
        return cv.toDataURL('image/png');   // 兜底结果不缓存，等父瓦片到达后替换
    }

    // 3) 两者都没就绪：返回空瓦片，绝不写入缓存，
    //    否则就绪后仍会一直拿到空白。就绪时 reload() 会重新拉取。
    loadLPOverlay();
    return LP_BLANK_TILE;
}

// 把 PNG 画到离屏 canvas 并取出像素，之后所有查询都在内存里完成
function loadLPChannel(ch, done) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0);
        ch.w = cv.width;
        ch.h = cv.height;
        ch.px = cx.getImageData(0, 0, cv.width, cv.height).data;
        done();
    };
    img.onerror = function () {
        console.error('光污染数据加载失败:', ch.url);
        done();
    };
    img.src = ch.url;
}

function loadLPData() {
    let left = 2;
    const tick = function () {
        if (--left > 0) return;
        LP_DATA.ready = true;
        console.log('光污染本地数据就绪', LP_DATA.level.w + '×' + LP_DATA.level.h);
        // 数据到位后刷新热力图与图层
        gridData = generateGridData(0.4);
        heatmapData = buildHeatmapData();
        if (typeof heatmapInstance !== 'undefined' && heatmapInstance) {
            heatmapInstance.setDataSet({ data: heatmapData, max: 4 });
        }
    };
    loadLPChannel(LP_DATA.level, tick);
    loadLPChannel(LP_DATA.value, tick);
}

// 取一个通道在指定经纬度的原始字节，越界返回 0
function sampleChannel(ch, lng, lat) {
    if (!ch.px) return 0;
    const x = Math.floor((lng - ch.lon0) / ch.step);
    const y = Math.floor((ch.lat0 - lat) / ch.step);
    if (x < 0 || x >= ch.w || y < 0 || y >= ch.h) return 0;
    return ch.px[(y * ch.w + x) * 4];
}

// 该坐标是否落在数据集覆盖范围内
function inLPRange(lng, lat) {
    const ch = LP_DATA.level;
    if (!ch.px) return false;
    return lng >= ch.lon0 && lat <= ch.lat0 &&
        lng < ch.lon0 + ch.w * ch.step && lat > ch.lat0 - ch.h * ch.step;
}

// 波特尔等级（1..7）；0 表示该像元亮度恰好为 0（完全无人工光源），
// 属有效数据，语义上等价于 1 级「极暗」，调用方需自行按 1 处理。
function getLevelAt(lng, lat) {
    return sampleChannel(LP_DATA.level, lng, lat);
}

// 把 8 位对数量化码还原成原始亮度值；0 表示低于量化下限 1e-6
function getValueAt(lng, lat) {
    const code = sampleChannel(LP_DATA.value, lng, lat);
    if (!code) return 0;
    return Math.pow(10, (code - 1) / 254 * 7.5 - 6);
}

// 根据光污染数值获取波特尔等级
function getBortleLevel(value) {
    // 数值越小，光污染越低（根据实际数据范围调整）
    // 2015年世界光污染数据范围约 0.0001 ~ 0.1
    if (value < 0.0005) return 1;
    if (value < 0.001) return 2;
    if (value < 0.005) return 3;
    if (value < 0.01) return 4;
    if (value < 0.03) return 5;
    if (value < 0.06) return 6;
    return 7;
}

// 获取光污染详情（基于真实数值）
function getBortleInfoByValue(value) {
    const level = getBortleLevel(value);
    return getLightPollutionInfo(level);
}

// 查询指定经纬度的光污染数值（本地栅格，无网络请求）
//
// 注意：数值恰为 0 是【有效结果】（无人区、高原、海面完全没有人工光源），
// 不能当作「无数据」丢弃，否则青藏高原西部这类纯黑区域点不出任何信息。
// 只有坐标落在数据集覆盖矩形之外才返回 null。
function queryWMSFeatureInfo(lng, lat, callback) {
    if (!LP_DATA.ready) {
        callback(new Error('光污染数据尚未加载完成'), null);
        return;
    }
    if (!inLPRange(lng, lat)) {
        callback(null, null);          // 覆盖范围之外：确实没有数据
        return;
    }
    callback(null, getValueAt(lng, lat));   // 可能为 0，但仍属有效值
}

// 生成热力图数据：只取光污染较重的采样点，让热力图呈现「亮区热点」而非整幅饱和
function buildHeatmapData() {
    const data = [];
    const step = 0.2;
    const MIN_LEVEL = 4;          // 4 级（中等）及以上才进入热力统计
    for (let lng = 73; lng <= 135; lng += step) {
        for (let lat = 18; lat <= 54; lat += step) {
            if (!inLPRange(lng, lat)) continue;
            const level = getLevelAt(lng, lat);
            if (level < MIN_LEVEL) continue;
            // 归一化到 1..4，避免所有点都顶到色带末端
            data.push({ lng: lng, lat: lat, count: level - MIN_LEVEL + 1 });
        }
    }
    return data;
}

function generateGridData(step = 0.6) {
    const data = [];
    for (let lng = 73; lng <= 135; lng += step) {
        for (let lat = 18; lat <= 54; lat += step) {
            const level = getLightPollutionLevel(lat, lng);
            data.push({
                lng: Math.round(lng * 100) / 100,
                lat: Math.round(lat * 100) / 100,
                level: level,
                color: getPollutionColor(level),
                label: getLevelLabel(level),
                icon: getLevelIcon(level)
            });
        }
    }
    return data;
}
