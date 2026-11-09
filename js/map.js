// ================================================================
// 地图：初始化、图层切换、地图选点
// ================================================================
//
// 高德地图实例的创建、底图与叠加图层的装配、图层按钮切换与地图选点交互。
//

// ================================================================
// 7. 地图选点
// ================================================================

document.getElementById('pickLocationBtn').addEventListener('click', function () {
    if (!map) return;
    if (isPicking) {
        showToast('已在选点模式');
        return;
    }

    isPicking = true;
    document.getElementById('container').classList.add('pick-mode');
    showToast('点击地图上的位置选择经纬度');

    if (markerClickHandler) {
        map.off('click', markerClickHandler);
    }

    markerClickHandler = function (e) {
        const lng = e.lnglat.getLng();
        const lat = e.lnglat.getLat();
        document.getElementById('addLat').value = lat.toFixed(6);
        document.getElementById('addLng').value = lng.toFixed(6);

        if (pickMarker) {
            map.remove(pickMarker);
        }
        pickMarker = new AMap.Marker({
            position: [lng, lat],
            icon: 'https://webapi.amap.com/theme/v1.3/markers/n/mark_b.png',
            map: map
        });

        showToast(`已选点: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        isPicking = false;
        document.getElementById('container').classList.remove('pick-mode');
        map.off('click', markerClickHandler);
        markerClickHandler = null;
    };

    map.on('click', markerClickHandler);
});

document.getElementById('cancelPickBtn').addEventListener('click', function () {
    if (pickMarker) {
        map.remove(pickMarker);
        pickMarker = null;
    }
    if (markerClickHandler) {
        map.off('click', markerClickHandler);
        markerClickHandler = null;
    }
    isPicking = false;
    document.getElementById('container').classList.remove('pick-mode');
    showToast('已取消选点');
});

// ================================================================
// 8. 图层切换
// ================================================================

function switchLayer(target) {
    // 1. 先隐藏所有叠加层
    if (wmsLayer) wmsLayer.hide();
    if (heatmapInstance) heatmapInstance.hide();

    // 2. 更新按钮状态
    document.querySelectorAll('.layer-toggle button').forEach(btn => {
        btn.classList.remove('active');
    });

    // 3. 根据目标切换
    if (target === 'satellite') {
        document.getElementById('btnSatellite').classList.add('active');
        // 关闭统计图
        document.getElementById('chartContainer').style.display = 'none';
        showToast('已切换至卫星图');
    } else if (target === 'wms') {
        if (wmsLayer) {
            wmsLayer.setOpacity(0.7);
            wmsLayer.show();
        }
        document.getElementById('btnWMS').classList.add('active');
        showToast('已切换至 WMS 光污染图层');

        // ===== 如果当前有轮廓，自动显示统计图 =====
        if (currentDistrictPolygon) {
            // 获取轮廓的边界数据
            var path = currentDistrictPolygon.getPath();
            if (path && path.length > 0) {
                // 从轮廓提取边界
                var boundaries = [];
                var currentBoundary = [];
                path.forEach(function (point) {
                    if (Array.isArray(point)) {
                        // 如果是多个多边形
                        if (point.length > 0 && typeof point[0] === 'object' && point[0].getLng) {
                            var boundary = point.map(function (p) {
                                return { lng: p.getLng(), lat: p.getLat() };
                            });
                            boundaries.push(boundary);
                        }
                    } else if (point.getLng) {
                        // 单个多边形
                        currentBoundary.push({ lng: point.getLng(), lat: point.getLat() });
                    }
                });
                if (currentBoundary.length > 0) {
                    boundaries.push(currentBoundary);
                }

                // 获取区域名称
                var regionName = document.getElementById('selProvince').value ||
                    document.getElementById('selCity').value ||
                    document.getElementById('selCounty').value ||
                    '当前区域';

                if (boundaries.length > 0) {
                    updatePieChart(boundaries, regionName);
                }
            }
        }
    } else if (target === 'heatmap') {
        if (heatmapInstance) {
            heatmapInstance.show();
            heatmapInstance.setDataSet({
                data: heatmapData,
                max: 4
            });
        }
        document.getElementById('btnHeatmap').classList.add('active');
        // 关闭统计图
        document.getElementById('chartContainer').style.display = 'none';
        showToast('已切换至热力图');
    }

    currentLayer = target;
}

// ================================================================
// 9. Tab切换
// ================================================================

document.getElementById('tabSearch').addEventListener('click', function () {
    document.getElementById('tabSearch').classList.add('active');
    document.getElementById('tabAdd').classList.remove('active');
    document.getElementById('searchPanel').classList.add('active');
    document.getElementById('addPanel').classList.remove('active');
});

document.getElementById('tabAdd').addEventListener('click', function () {
    document.getElementById('tabAdd').classList.add('active');
    document.getElementById('tabSearch').classList.remove('active');
    document.getElementById('addPanel').classList.add('active');
    document.getElementById('searchPanel').classList.remove('active');
});

// ================================================================
// 10. 地图初始化
// ================================================================

function initMap() {
    const opts = { subdistrict: 0, extensions: 'all', level: 'city' };
    const district = new AMap.DistrictSearch(opts);
    district.search('中国', function (status, result) {
        if (status !== 'complete') {
            showToast('获取中国边界失败，使用默认视图');
            createMap(null);
            return;
        }
        boundsData = result.districtList[0].boundaries;
        createMap(boundsData);
    });
}

function createMap(bounds) {
    // 生成光污染网格数据（热力图用）
    gridData = generateGridData(0.4);
    console.log('生成光污染网格数据:', gridData.length, '个点');

    let mask = null;
    if (bounds) {
        mask = [];
        for (var i = 0; i < bounds.length; i++) {
            mask.push([bounds[i]]);
        }
    }

    // ===== 1. 创建路网图层（底图） =====
    roadLayer = new AMap.TileLayer.RoadNet({
        rejectMapMask: true,
        opacity: 0.7
    });

    // ===== 2. 创建卫星图层 =====
    satelliteLayer = new AMap.TileLayer.Satellite({
        opacity: 1
    });

    // ===== 3. 创建光污染图层（本地 XYZ 瓦片，替代 GeoServer WMS） =====
    //
    // z0–z8 直接读预生成的 tiles/{z}/{x}/{y}.png；
    // 更深缩放级别从 data/lp_overlay.png 裁剪放大，避免图层在高缩放时消失。
    // ------------------------------------------------------------
    wmsLayer = new AMap.TileLayer({
        getTileUrl: function (x, y, z) {
            if (z <= LP_MAX_TILE_ZOOM) {
                return LP_TILE_ROOT + z + '/' + x + '/' + y + '.png';
            }
            return lpOverzoomTile(x, y, z);
        },
        zIndex: 10,
        zooms: [0, 18],
        opacity: 0.85,
        visible: false
    });

    // ===== 4. 创建高德热力图 =====
    heatmapData = buildHeatmapData();

    heatmapInstance = new AMap.HeatMap(undefined, {
        radius: 16,
        opacity: [0.15, 0.7],
        gradient: {
            0.0: '#0a0a2e',
            0.15: '#16213e',
            0.35: '#0f3460',
            0.55: '#2a4a7a',
            0.75: '#533483',
            0.9: '#b83a3a',
            1.0: '#e94560'
        },
        visible: false,
        zooms: [3, 18]
    });

    heatmapInstance.setDataSet({
        data: heatmapData,
        max: 4
    });

    // ===== 5. 初始化地图 =====
    map = new AMap.Map('container', {
        mask: mask,
        center: [104.0, 35.0],
        viewMode: '2D',
        showLabel: true,
        labelzIndex: 130,
        zoom: 5,
        layers: [roadLayer, satelliteLayer, wmsLayer],
        animateEnable: true
    });

    wmsLayer.hide();
    heatmapInstance.setMap(map);
    heatmapInstance.hide();

    // 国界描边
    if (bounds) {
        for (var i = 0; i < bounds.length; i++) {
            new AMap.Polyline({
                path: bounds[i],
                strokeColor: '#ffaa33',
                strokeWeight: 3,
                strokeOpacity: 0.6,
                map: map
            });
        }
    }

    // ===== 6. 观星点 =====
    refreshMarkers();

    // ===== 地图点击事件（WMS GetFeatureInfo 查询） =====
    map.on('click', function (e) {
        if (currentLayer !== 'wms') {
            showToast('请切换到「WMS光污染」模式查看光污染信息');
            return;
        }

        var lng = e.lnglat.getLng();
        var lat = e.lnglat.getLat();

        // 显示加载提示
        showToast('🔍 查询光污染数据...');

        // 查询本地光污染栅格
        queryWMSFeatureInfo(lng, lat, function (error, value) {
            if (error) {
                console.error('光污染数据查询失败:', error);
                showToast('⚠️ 光污染数据尚未加载完成，请稍候');
                return;
            }

            // value 为 0 是有效值（完全无人工光源的区域），只有 null 才是覆盖范围外
            if (value === null || value === undefined) {
                showToast('⚠️ 该位置暂无光污染数据（超出数据覆盖范围）');
                return;
            }

            // 根据数值获取波特尔等级和信息（value=0 会落到 1 级「极暗」）
            var level = getBortleLevel(value);
            var info = getLightPollutionInfo(level);
            var levelLabel = level + '级';

            // 数值为 0 时 toExponential 会显示 0.0000e+0，改为更明确的文案
            var formattedValue = (value === 0)
                ? '0（无人工光源）'
                : (typeof value === 'number' ? value.toExponential(4) : String(value));

            // 构建信息窗口内容
            var content = `
            <div style="padding: 12px 16px; font-family: 'Segoe UI', sans-serif; min-width: 240px; max-width: 320px;">
                <div style="border-bottom: 2px solid #ffaa33; padding-bottom: 6px; margin-bottom: 8px;">
                    <strong style="color: #ffaa33; font-size: 16px;">波特尔光害 ${levelLabel}</strong><br>
                    <span style="color: #888; font-size: 14px;">📍 ${lat.toFixed(4)}°, ${lng.toFixed(4)}°</span>
                </div>
                
                <div style="font-size: 13px; color: #333;">
                    <div style="display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid #f0f0f0;">
                        <span>📊 光污染值</span>
                        <span style="font-weight: bold; color: #1e5a9e;">${formattedValue}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid #f0f0f0;">
                        <span>🔭 极限星等</span>
                        <span style="font-weight: bold; color: #1e5a9e;">${info.limitMagnitude}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid #f0f0f0;">
                        <span>📊 SQM 值</span>
                        <span style="font-weight: bold; color: #1e5a9e;">${info.sqm}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid #f0f0f0;">
                        <span>🌌 银河</span>
                        <span style="color: #533483;">${info.galaxy}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid #f0f0f0;">
                        <span>🌟 M31</span>
                        <span style="color: #533483;">${info.m31}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 3px 0;">
                        <span>☀️ 黄道光</span>
                        <span style="color: #533483;">${info.zodiacLight}</span>
                    </div>
                </div>
                
                <div style="margin-top: 8px; padding-top: 6px; border-top: 2px solid #ffaa33; font-size: 13px; color: #666; text-align: center;">
                    ${info.description}
                </div>
                <div style="font-size: 12px; color: #999; text-align: center; margin-top: 4px;">
                    📡 数据来源：2015 World Atlas of Artificial Night Sky Brightness
                </div>
            </div>
        `;

            // 不设置 offset：InfoWindow 的箭头尖端默认正对锚点，
            // 这样箭头就能精确指在鼠标点击的那个坐标上。
            var infoWindow = new AMap.InfoWindow({
                content: content
            });
            infoWindow.open(map, [lng, lat]);

            showToast('✅ 光污染数据查询完成');
        });
    });

    // 地图缩放/移动事件
    map.on('zoomend', function () {
        updateMarkersVisibility();
    });

    map.on('moveend', function () { });

    // ===== 7. 初始化搜索功能 =====
    if (typeof initSearchFeatures === 'function') {
        initSearchFeatures();
    }

    // ===== 8. 图层切换按钮 =====
    document.getElementById('btnSatellite').onclick = function () {
        switchLayer('satellite');
    };
    document.getElementById('btnWMS').onclick = function () {
        switchLayer('wms');
    };
    document.getElementById('btnHeatmap').onclick = function () {
        switchLayer('heatmap');
    };

    // 添加观星点
    document.getElementById('addSpotBtn').onclick = function () {
        const name = document.getElementById('addName').value.trim();
        const lat = parseFloat(document.getElementById('addLat').value);
        const lng = parseFloat(document.getElementById('addLng').value);
        if (addCustomSpot(name, lat, lng)) {
            document.getElementById('addName').value = '';
            document.getElementById('addLat').value = '';
            document.getElementById('addLng').value = '';
            if (pickMarker) {
                map.remove(pickMarker);
                pickMarker = null;
            }
        }
    };

    showToast('观星地图加载完成 | 点击图层按钮切换显示');
}
