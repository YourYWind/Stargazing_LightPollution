// ================================================================
// 光污染等级配置
// ================================================================
//
// 波特尔 7 级分级的口径、配色、文案，以及栅格覆盖范围之外使用的城市距离衰减估算模型。
// 本文件只包含常量与纯函数，不接触 DOM，也不接触地图对象。
//

// ================================================================
// 1. 光污染数据生成
// ================================================================

const MAJOR_CITIES = [
    [116.4, 39.9, 180, 5],
    [121.5, 31.2, 170, 5],
    [113.3, 23.1, 150, 5],
    [114.1, 22.5, 140, 5],
    [106.5, 29.6, 120, 4],
    [104.1, 30.6, 110, 4],
    [118.8, 32.1, 110, 4],
    [114.3, 30.6, 100, 4],
    [113.3, 28.2, 90, 4],
    [117.0, 36.7, 100, 4],
    [120.2, 30.3, 80, 3],
    [117.2, 39.1, 80, 3],
    [103.8, 36.1, 70, 3],
    [87.6, 43.8, 60, 3],
    [91.1, 29.7, 50, 2],
    [126.6, 45.8, 70, 3],
    [125.3, 43.9, 70, 3],
    [123.4, 41.8, 70, 3],
    [112.5, 37.9, 60, 3],
    [114.5, 38.0, 60, 3],
    [110.3, 34.3, 60, 3],
    [106.7, 26.6, 60, 3],
    [102.7, 25.0, 60, 3],
    [108.3, 22.8, 60, 3],
    [119.3, 26.1, 60, 3],
    [115.9, 28.7, 60, 3],
];

const TIBET_REGIONS = [
    { minLng: 75, maxLng: 100, minLat: 25, maxLat: 40, maxLevel: 2 },
    { minLng: 80, maxLng: 95, minLat: 28, maxLat: 35, maxLevel: 1 },
];

function calcDistance(lng1, lat1, lng2, lat2) {
    const dx = (lng1 - lng2) * 111 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    const dy = (lat1 - lat2) * 111;
    return Math.sqrt(dx * dx + dy * dy);
}

function getLightPollutionLevel(lat, lng) {
    // 优先使用本地真实栅格数据（1..7 级）
    // 0 表示该像元极暗（波特尔 1 级），只有在数据范围外才退回估算模型
    if (inLPRange(lng, lat)) {
        const real = getLevelAt(lng, lat);
        return real > 0 ? real : 1;
    }

    // 栅格无数据的区域（海洋之外的中国境内极少）退回估算模型
    let level = 1;
    MAJOR_CITIES.forEach(city => {
        const dist = calcDistance(lng, lat, city[0], city[1]);
        if (dist < city[2]) {
            const ratio = 1 - (dist / city[2]);
            const cityLevel = 1 + ratio * (city[3] - 1);
            if (cityLevel > level) level = Math.min(5, Math.round(cityLevel));
        }
    });
    TIBET_REGIONS.forEach(region => {
        if (lng >= region.minLng && lng <= region.maxLng &&
            lat >= region.minLat && lat <= region.maxLat) {
            level = Math.min(level, region.maxLevel);
        }
    });
    return Math.max(1, Math.min(5, Math.round(level)));
}

// 7 级波特尔配色（与瓦片、叠加图保持一致）
const LEVEL_COLORS = {
    1: '#12203a', 2: '#1b4a7a', 3: '#1f7a6a',
    4: '#c9c93b', 5: '#e08f26', 6: '#d94f28', 7: '#ff2d55'
};
const LEVEL_LABELS = {
    1: '极佳', 2: '优秀', 3: '良好', 4: '中等',
    5: '轻度污染', 6: '重度污染', 7: '极重度污染'
};
const LEVEL_ICONS = {
    1: '🌑', 2: '🌙', 3: '✨', 4: '⭐', 5: '💡', 6: '🏙️', 7: '🌇'
};

function getPollutionColor(level) {
    return LEVEL_COLORS[level] || LEVEL_COLORS[1];
}

function getLevelLabel(level) {
    return LEVEL_LABELS[level] || '未知';
}

function getLevelIcon(level) {
    return LEVEL_ICONS[level] || '❓';
}

// ================================================================
// 光污染等级信息映射
// ================================================================

const lightPollutionInfo = {
    1: {
        level: '1级（极佳）',
        sqm: '21.80 ~ 22.00',
        limitMagnitude: '7.0 ~ 7.5',
        galaxy: '明亮，结构细节清晰可见',
        m31: '非常明显，肉眼可见',
        zodiacLight: '明显可见，带微红色',
        description: '极暗天空，最佳观星地点'
    },
    2: {
        level: '2级（优秀）',
        sqm: '21.50 ~ 21.79',
        limitMagnitude: '6.6 ~ 7.0',
        galaxy: '明显可见，结构可见',
        m31: '非常明显',
        zodiacLight: '可见，带微黄色',
        description: '优秀的暗夜环境'
    },
    3: {
        level: '3级（良好）',
        sqm: '21.20 ~ 21.49',
        limitMagnitude: '6.3 ~ 6.5',
        galaxy: '可见，结构模糊',
        m31: '明显可见',
        zodiacLight: '可见',
        description: '轻度光污染'
    },
    4: {
        level: '4级（轻度污染）',
        sqm: '20.90 ~ 21.19',
        limitMagnitude: '6.0 ~ 6.2',
        galaxy: '可见，无细节',
        m31: '可见',
        zodiacLight: '不可见',
        description: '光污染明显'
    },
    5: {
        level: '5级（中度污染）',
        sqm: '20.50 ~ 20.89',
        limitMagnitude: '5.5 ~ 5.9',
        galaxy: '隐约可见',
        m31: '模糊可见',
        zodiacLight: '不可见',
        description: '光污染较重'
    },
    6: {
        level: '6级（重度污染）',
        sqm: '20.00 ~ 20.49',
        limitMagnitude: '5.0 ~ 5.4',
        galaxy: '不可见',
        m31: '勉强可见',
        zodiacLight: '不可见',
        description: '光污染严重'
    },
    7: {
        level: '7级（极重度污染）',
        sqm: '19.50 ~ 19.99',
        limitMagnitude: '4.5 ~ 4.9',
        galaxy: '不可见',
        m31: '不可见',
        zodiacLight: '不可见',
        description: '基本无法观星'
    }
};

function getLightPollutionInfo(level) {
    return lightPollutionInfo[level] || lightPollutionInfo[3];
}
