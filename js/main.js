// ================================================================
// 启动入口与文献引用弹窗
// ================================================================

// 按顺序加载数据、创建地图，并绑定文献引用弹窗的开关与 ESC 关闭。


// ================================================================
// 启动
// ================================================================

loadCustomSpots();
loadLPData();
loadLPOverlay();
initMap();

// ================================================================
// 文献引用弹窗控制
// ================================================================

// 等待DOM完全加载后再绑定事件
document.addEventListener('DOMContentLoaded', function () {
    var citationBtn = document.getElementById('citationBtn');
    var closeBtn = document.getElementById('closeCitationBtn');
    var overlay = document.getElementById('citationOverlay');

    if (citationBtn) {
        citationBtn.addEventListener('click', function () {
            overlay.style.display = 'flex';
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', function () {
            overlay.style.display = 'none';
        });
    }

    if (overlay) {
        overlay.addEventListener('click', function (e) {
            if (e.target === this) {
                overlay.style.display = 'none';
            }
        });
    }

    // ESC键关闭弹窗
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            if (overlay) overlay.style.display = 'none';
        }
    });
});
