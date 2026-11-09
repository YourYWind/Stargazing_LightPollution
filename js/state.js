// ================================================================
// 全局运行时状态
// ================================================================
//
// 地图实例、图层、标记、热力图等跨模块共享的变量集中在此声明，
// 避免它们散落在各个业务文件里造成隐式依赖。
//

let customSpots = [];
let map = null;
let markers = [];
let gridData = [];
let boundsData = null;
let pickMarker = null;
let markerClickHandler = null;
let isPicking = false;

// ===== 图层变量 =====
let satelliteLayer = null;
let roadLayer = null;
let wmsLayer = null;
let heatmapInstance = null;
let heatmapData = [];
let currentLayer = 'satellite';
