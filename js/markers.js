// ================================================================
// 观星点标记渲染
// ================================================================
//
// 按光污染等级给标记着色，按缩放级别控制显隐，并根据数据渲染右侧观星点列表。
//

// ================================================================
// 5. 观星点标记
// ================================================================

function getSpotQuality(lat, lng) {
    const level = getLightPollutionLevel(lat, lng);
    if (level <= 2) return 'excellent';
    if (level <= 3) return 'good';
    return 'city';
}

function getMarkerColor(quality) {
    return { excellent: '#ffaa33', good: '#66cc66', city: '#ff6644' }[quality] || '#ff6644';
}

function shouldShowMarker() {
    if (!map) return false;
    const zoom = map.getZoom();
    return zoom >= 9;
}

function createMarker(spot) {
    const quality = getSpotQuality(spot.lat, spot.lng);
    const color = getMarkerColor(quality);
    const level = getLightPollutionLevel(spot.lat, spot.lng);

    const markerContent = document.createElement('div');
    markerContent.className = 'custom-marker';
    markerContent.innerHTML = `
        <div style="
            width: 28px;
            height: 28px;
            background: radial-gradient(circle at 30% 30%, ${color}, ${color}aa);
            border: 2px solid white;
            border-radius: 50%;
            box-shadow: 0 0 12px ${color};
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            transition: transform 0.2s;
        ">
            ⭐
        </div>
    `;

    markerContent.onmouseenter = () => {
        markerContent.querySelector('div').style.transform = 'scale(1.2)';
    };
    markerContent.onmouseleave = () => {
        markerContent.querySelector('div').style.transform = 'scale(1)';
    };

    const infoWindow = new AMap.InfoWindow({
        content: `
            <div style="padding: 8px 12px; font-family: sans-serif; min-width: 160px;">
                <strong style="color: #ffaa33;">⭐ ${spot.name}</strong><br>
                <span style="font-size: 12px; color: #666;">${spot.desc || ''}</span><br>
                <span style="font-size: 11px; color: #999;">📍 ${spot.lat}°, ${spot.lng}°</span><br>
                <span style="font-size: 11px; color: #533483;">🌙 光污染 ${level} 级 (${getLevelLabel(level)})</span>
            </div>
        `,
        // 箭头尖端默认正对锚点，上移 14px 正好贴到 28px 圆形图标的顶边
        offset: new AMap.Pixel(0, -14)
    });

    const marker = new AMap.Marker({
        position: [spot.lng, spot.lat],
        content: markerContent,
        // 图标 28×28，偏移半个宽高让圆心精确落在地理坐标上。
        // 注意：这里不能同时设置 anchor，anchor 会与 offset 叠加
        // （实测 anchor:'bottom-center' + offset(-14,-14) 会得到 (-14,-28)），
        // 那样图标会浮在坐标上方 28px，缩放时看起来像标记在地图上滑动。
        offset: new AMap.Pixel(-14, -14),
        visible: shouldShowMarker()
    });

    marker.on('click', () => {
        infoWindow.open(map, [spot.lng, spot.lat]);
    });

    marker._spotData = spot;
    return marker;
}

function refreshMarkers() {
    markers.forEach(marker => map.remove(marker));
    markers = [];

    const allSpots = [...defaultSpots, ...customSpots];
    allSpots.forEach(spot => {
        const marker = createMarker(spot);
        marker.setMap(map);
        markers.push(marker);
    });

    renderSpotList();
    updateMarkersVisibility();
}

function updateMarkersVisibility() {
    const visible = shouldShowMarker();
    markers.forEach(marker => {
        if (visible) {
            marker.show();
        } else {
            marker.hide();
        }
    });
}

function renderSpotList() {
    const container = document.getElementById('spotList');
    const allSpots = [...defaultSpots, ...customSpots];
    let html = '';
    allSpots.forEach(spot => {
        const level = getLightPollutionLevel(spot.lat, spot.lng);
        const icon = getLevelIcon(level);
        const quality = getSpotQuality(spot.lat, spot.lng);
        const starIcon = quality === 'excellent' ? '🌟' : (quality === 'good' ? '⭐' : '📍');
        html += `
            <div class="spot-item" data-lng="${spot.lng}" data-lat="${spot.lat}" data-name="${spot.name}">
                ${starIcon} <strong>${spot.name}</strong><br>
                <small>${spot.desc || ''} ${icon} 光污染${level}级</small>
            </div>
        `;
    });
    container.innerHTML = html;

    document.querySelectorAll('.spot-item').forEach(el => {
        el.addEventListener('click', () => {
            const lng = parseFloat(el.dataset.lng);
            const lat = parseFloat(el.dataset.lat);
            const name = el.dataset.name;
            map.setZoomAndCenter(12, [lng, lat]);
            showToast(`✈️ 定位到 ${name}`);
        });
    });
}

function addCustomSpot(name, lat, lng) {
    if (!name || isNaN(lat) || isNaN(lng)) {
        alert("请填写完整信息 (名称、纬度、经度)");
        return false;
    }
    if (lat < 18 || lat > 54 || lng < 73 || lng > 135) {
        alert("经纬度超出中国范围 (纬度18~54, 经度73~135)");
        return false;
    }

    const newSpot = {
        name: name,
        lat: lat,
        lng: lng,
        desc: `自定义观星点 · 光污染${getLightPollutionLevel(lat, lng)}级`,
        isCustom: true
    };

    customSpots.push(newSpot);
    saveCustomSpots();
    refreshMarkers();
    showToast(`✅ 已添加 ${name}`);
    return true;
}
