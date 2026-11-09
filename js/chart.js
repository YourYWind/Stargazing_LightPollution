// ================================================================
// 区域统计环形图（ECharts）
// ================================================================
//
// 对选定行政区做网格采样，统计 1–7 级光污染占比并渲染成环形图。
// 所有采样都在内存里完成，不产生任何网络请求。
//

// ================================================================
// ECharts 饼图 - 基于 WMS 真实光污染数据
// ================================================================

let pieChartInstance = null;

// 初始化饼图
function initPieChart() {
    const chartDom = document.getElementById('pieChart');
    if (!chartDom) return null;
    if (typeof echarts === 'undefined') {
        console.error('ECharts 未加载，无法渲染统计图');
        return null;
    }
    if (pieChartInstance) {
        pieChartInstance.dispose();
        pieChartInstance = null;
    }
    try {
        pieChartInstance = echarts.init(chartDom);
    } catch (err) {
        console.error('ECharts 初始化失败:', err);
        pieChartInstance = null;
    }
    return pieChartInstance;
}

// 判断点是否在多边形内
function isPointInPolygon(lng, lat, polygon) {
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygon[i].lng, yi = polygon[i].lat;
        const xj = polygon[j].lng, yj = polygon[j].lat;
        const intersect = ((yi > lat) !== (yj > lat)) &&
            (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// 从本地栅格查询单个点的光污染等级
function queryWMSPoint(lng, lat) {
    if (!inLPRange(lng, lat)) return Promise.resolve(null);
    const raw = getLevelAt(lng, lat);
    return Promise.resolve(raw > 0 ? raw : 1);   // 0 按 1 级「极暗」处理
}

// 统计区域内的光污染等级分布（本地栅格，无网络请求）
async function calculateRegionPollutionFromWMS(boundaries, regionName) {
    // 采样点步长（度）
    const step = 0.2;
    const levelCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
    let totalPoints = 0;
    let successCount = 0;

    // 获取区域边界范围
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    boundaries.forEach(boundary => {
        boundary.forEach(point => {
            if (point.lng < minLng) minLng = point.lng;
            if (point.lng > maxLng) maxLng = point.lng;
            if (point.lat < minLat) minLat = point.lat;
            if (point.lat > maxLat) maxLat = point.lat;
        });
    });

    // 生成采样点
    const samplePoints = [];
    for (let lng = minLng; lng <= maxLng; lng += step) {
        for (let lat = minLat; lat <= maxLat; lat += step) {
            let inside = false;
            for (const boundary of boundaries) {
                if (isPointInPolygon(lng, lat, boundary)) {
                    inside = true;
                    break;
                }
            }
            if (inside) {
                samplePoints.push({ lng, lat });
                totalPoints++;
            }
        }
    }

    if (totalPoints === 0) {
        return null;
    }

    // 全部在内存里取值，无网络往返
    samplePoints.forEach(point => {
        const raw = getLevelAt(point.lng, point.lat);
        // 0 表示亮度恰好为 0（完全无人工光源），按 1 级「极暗」计入，
        // 不能跳过，否则青海/西藏/新疆大片区域会被误判成「无数据」
        const level = raw > 0 ? raw : 1;
        levelCount[level] = (levelCount[level] || 0) + 1;
        successCount++;
    });

    showToast(`✅ 统计完成: ${successCount} 个有效采样点`);

    return { levelCount, totalPoints: successCount };
}

// 更新饼图
async function updatePieChart(boundaries, regionName) {
    const container = document.getElementById('chartContainer');
    const regionNameEl = document.getElementById('chartRegionName');

    if (!boundaries || boundaries.length === 0) {
        container.style.display = 'none';
        return;
    }

    // 显示加载状态
    container.style.display = 'block';
    regionNameEl.textContent = `⏳ 正在统计 ${regionName} ...`;

    // 执行统计
    const result = await calculateRegionPollutionFromWMS(boundaries, regionName);

    if (!result || result.totalPoints === 0) {
        regionNameEl.textContent = `❌ ${regionName} 暂无有效数据`;
        setTimeout(() => {
            container.style.display = 'none';
        }, 2000);
        return;
    }

    const { levelCount, totalPoints } = result;

    // 准备饼图数据（7 级波特尔）
    const levelLabels = {
        1: '1级 极佳',
        2: '2级 优秀',
        3: '3级 良好',
        4: '4级 中等',
        5: '5级 轻度',
        6: '6级 重度',
        7: '7级 极重'
    };

    const chartData = [];
    for (let i = 1; i <= 7; i++) {
        if (levelCount[i] > 0) {
            chartData.push({
                name: levelLabels[i],
                value: levelCount[i],
                itemStyle: { color: LEVEL_COLORS[i] }
            });
        }
    }

    // 更新显示
    regionNameEl.textContent = `📍 ${regionName} · 基于光污染数据 (${totalPoints} 个采样点)`;

    // 初始化图表（容器此时已显示，尺寸有效）
    const chart = initPieChart();
    if (!chart) {
        regionNameEl.textContent = `⚠️ ${regionName} · 图表组件加载失败`;
        return;
    }

    const option = {
        tooltip: {
            trigger: 'item',
            formatter: function (params) {
                return `${params.name}<br/>占比: ${params.percent}%<br/>采样点: ${params.value}`;
            }
        },
        series: [{
            name: '光污染等级',
            type: 'pie',
            radius: ['40%', '70%'],
            avoidLabelOverlap: true,
            itemStyle: {
                borderRadius: 10,
                borderColor: '#0a1628',
                borderWidth: 2
            },
            label: {
                color: '#88aacc',
                fontSize: 11,
                formatter: '{b}\n{d}%'
            },
            labelLine: {
                lineStyle: { color: '#334466' }
            },
            emphasis: {
                itemStyle: {
                    shadowBlur: 10,
                    shadowOffsetX: 0,
                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                }
            },
            data: chartData
        }],
        backgroundColor: 'transparent'
    };

    pieChartInstance.setOption(option, true);
    pieChartInstance.resize();
}

// 关闭统计图
document.getElementById('closeChartBtn').addEventListener('click', function () {
    document.getElementById('chartContainer').style.display = 'none';
});

// 窗口大小变化时自适应
window.addEventListener('resize', function () {
    if (pieChartInstance && document.getElementById('chartContainer').style.display !== 'none') {
        pieChartInstance.resize();
    }
});
