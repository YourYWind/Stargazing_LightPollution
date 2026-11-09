// ================================================================
// 搜索与区域定位
// ================================================================
//
// 观星点关键字搜索、省/市/区县三级联动定位，以及行政区统计的触发。
//

// ================================================================
// 6. 搜索功能 - 全局函数 (由 main.js 调用)
// ================================================================

window.performSpotSearch = function (keyword) {
    const allSpots = [...defaultSpots, ...customSpots];
    const matched = allSpots.filter(s =>
        s.name.includes(keyword) ||
        s.name.toLowerCase().includes(keyword.toLowerCase()) ||
        (s.desc && s.desc.includes(keyword))
    );

    if (matched.length === 0) {
        showToast('未找到匹配的观星点');
        return;
    }

    if (matched.length === 1) {
        const spot = matched[0];
        map.setZoomAndCenter(12, [spot.lng, spot.lat]);
        showToast(`📍 定位到 ${spot.name}`);
    } else {
        const spot = matched[0];
        map.setZoomAndCenter(11, [spot.lng, spot.lat]);
        showToast(`找到 ${matched.length} 个匹配点，定位到 ${spot.name}`);
    }
};

// 存储当前显示的轮廓（全局变量）
var currentDistrictPolygon = null;

// 执行区域定位
window.performRegionSearch = function () {
    var provSel = document.getElementById('selProvince');
    var citySel = document.getElementById('selCity');
    var countySel = document.getElementById('selCounty');

    var province = provSel ? provSel.value : '';
    var city = citySel ? citySel.value : '';
    var county = countySel ? countySel.value : '';

    if (!province) {
        showToast('请至少选择一个省份');
        return;
    }

    var keyword = province;
    var level = 'province';
    if (county) {
        keyword = county;
        level = 'district';
    } else if (city) {
        keyword = city;
        level = 'city';
    }

    // 清除旧轮廓
    if (currentDistrictPolygon) {
        try {
            map.remove(currentDistrictPolygon);
        } catch (e) {
            console.warn('清除轮廓失败:', e);
        }
        currentDistrictPolygon = null;
    }

    // 关闭旧的统计图
    document.getElementById('chartContainer').style.display = 'none';

    var search = new AMap.DistrictSearch({
        level: level,
        extensions: 'all'
    });

    search.search(keyword, function (status, result) {
        if (status === 'complete' && result.districtList.length > 0) {
            var districtData = result.districtList[0];
            var center = districtData.center;
            var boundaries = districtData.boundaries;

            if (center) {
                var zoom = 10;
                if (county) zoom = 12;
                else if (city) zoom = 10;
                else zoom = 7;
                map.setZoomAndCenter(zoom, [center.lng, center.lat]);
                showToast('📍 定位到 ' + keyword);
            }

            // ===== 绘制区域轮廓（红色） =====
            if (boundaries && boundaries.length > 0) {
                var paths = [];
                boundaries.forEach(function (boundary) {
                    var path = boundary.map(function (point) {
                        return [point.lng, point.lat];
                    });
                    paths.push(path);
                });

                if (currentDistrictPolygon) {
                    try {
                        map.remove(currentDistrictPolygon);
                    } catch (e) { }
                    currentDistrictPolygon = null;
                }

                currentDistrictPolygon = new AMap.Polygon({
                    path: paths,
                    strokeColor: '#ff0000',
                    strokeWeight: 3,
                    strokeOpacity: 0.9,
                    fillColor: 'rgba(255, 68, 68, 0.08)',
                    fillOpacity: 0.3,
                    strokeStyle: 'solid',
                    zIndex: 1000
                });

                map.add(currentDistrictPolygon);
                showToast('📍 已显示 ' + keyword + ' 轮廓（红色）');

                // ===== 只有在光污染图模式下才显示统计图 =====
                if (currentLayer === 'wms') {
                    updatePieChart(boundaries, keyword);
                } else {
                    showToast('💡 切换到「光污染图」模式查看等级统计');
                }
            }
        } else {
            showToast('未找到该区域');
        }
    });
};

// ================================================================
// 取消定位 - 清除轮廓并重置下拉列表
// ================================================================

document.getElementById('cancelRegionBtn').addEventListener('click', function () {
    // 1. 清除轮廓
    if (currentDistrictPolygon) {
        try {
            map.remove(currentDistrictPolygon);
        } catch (e) {
            console.warn('清除轮廓失败:', e);
        }
        currentDistrictPolygon = null;
        showToast('已取消定位');
    } else {
        showToast('当前没有定位轮廓');
    }

    // 2. 关闭统计图
    document.getElementById('chartContainer').style.display = 'none';

    // 3. 重置下拉列表
    var provSel = document.getElementById('selProvince');
    var citySel = document.getElementById('selCity');
    var countySel = document.getElementById('selCounty');

    if (provSel) provSel.value = '';
    if (citySel) {
        citySel.value = '';
        citySel.disabled = true;
    }
    if (countySel) {
        countySel.value = '';
        countySel.disabled = true;
    }

    if (citySel) {
        citySel.innerHTML = '<option value="">请选择城市</option>';
        citySel.disabled = true;
    }
    if (countySel) {
        countySel.innerHTML = '<option value="">请选择县/区</option>';
        countySel.disabled = true;
    }
});
