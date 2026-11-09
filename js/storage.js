// ================================================================
// 本地存储与轻提示
// ================================================================
//
// 自定义观星点保存在 localStorage 的 stargazing_spots_cn 键下；
// showToast 负责底部短暂提示。
//

// ================================================================
// 3. 本地存储
// ================================================================

function loadCustomSpots() {
    const saved = localStorage.getItem('stargazing_spots_cn');
    if (saved) { try { customSpots = JSON.parse(saved); } catch (e) { customSpots = []; } }
}

function saveCustomSpots() {
    localStorage.setItem('stargazing_spots_cn', JSON.stringify(customSpots));
}

// ================================================================
// 4. Toast
// ================================================================

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.style.opacity = '1';
    setTimeout(() => toast.style.opacity = '0', 2000);
}
