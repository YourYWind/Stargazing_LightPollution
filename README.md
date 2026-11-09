# 观星地图 · 中国光污染可视化

一个帮助天文爱好者挑选观星地点的交互式地图。底图用高德地图，其上叠加按波特尔暗空分类（Bortle scale）着色的光污染图层，点击任意位置即可查到该点的天空亮度、极限星等、SQM 值，以及银河、M31、黄道光能否看见；选中行政区还能看到该区域内 7 个污染等级的占比分布。

整个站点是**纯静态**的：没有数据库、没有后端服务、没有服务器端渲染。光污染栅格在构建阶段就被预渲染成图片瓦片与两级查询栅格，浏览器只读取静态文件，因此可以直接托管在 GitHub Pages 上。

**在线站点**：<https://yourywind.github.io/Stargazing_LightPollution/>

## 功能

| 功能 | 说明 |
|---|---|
| 光污染图层 | 7 级波特尔分级着色，z0–z9 为预渲染瓦片，更高缩放从父瓦片裁剪平滑放大 |
| 热力图 | 只取 4 级以上像元并做强度归一化，突出城市光污染热点 |
| 单点查询 | 点击地图弹出信息窗：波特尔等级、辐射值、极限星等、SQM 值、银河/仙女座星系/黄道光可见度 |
| 区域统计 | 选择省/市/区县后按 0.2° 网格采样，用 ECharts 环形图统计 7 个等级占比 |
| 观星点 | 内置 7 个国内著名暗夜地点，可在地图上自定义添加，数据存 `localStorage` |
| 地名搜索 | 省/市/区县三级联动，以及观星点名称模糊搜索 |
| 底图切换 | 卫星图 / 路网 / 光污染图 / 热力图四种视图 |

## 目录结构

```
site/
├── index.html                    入口（自动跳转到 lightpollution.html）
├── lightpollution.html           主页面：结构 + 样式 + 第三方库引用
├── js/
│   ├── config.js                 光污染等级配置
│   ├── lightpollution-data.js    光污染数据层
│   ├── spots.js                  内置观星点清单
│   ├── state.js                  全局运行时状态
│   ├── storage.js                本地存储与轻提示
│   ├── markers.js                观星点标记与列表
│   ├── search.js                 搜索与区域定位
│   ├── map.js                    地图初始化、图层切换、选点
│   ├── chart.js                  区域统计环形图
│   ├── main.js                   启动入口与文献引用弹窗
│   ├── region.js                 省/市/区县数据与搜索控件
│   └── echarts.min.js            ECharts 5.4.3（本地内置，不依赖 CDN）
├── img/logo.png
├── tools/
│   └── build_data.py             构建脚本：GeoTIFF/zip → 瓦片 + 查询栅格
├── data/
│   ├── lp_level.png              0.02° 波特尔等级栅格（3200×1900，0=亮度恰为 0，1..7=等级）
│   ├── lp_value.png              0.10° 光污染数值栅格（640×380，对数量化）
│   ├── lp_overlay.png            整幅叠加图（父瓦片未就绪时的兜底取样源）
│   └── tile_stats.json           瓦片统计
└── tiles/{z}/{x}/{y}.png         预渲染 XYZ 瓦片，z0–z9（8794 张 / 9.41 MB）
```

站点合计 **8819 个文件 / 11.8 MB**。

## 前端模块划分

页面结构（HTML）与业务逻辑（JS）已经分离，`lightpollution.html` 只保留 DOM 结构、样式和第三方库引用，全部业务代码拆到 `js/` 下的 10 个模块。所有模块都是普通 `<script>`（非 ES Module），共享全局作用域，**必须按下面的顺序加载**：

| # | 文件 | 职责 | 主要导出 |
|---|---|---|---|
| 1 | `config.js` | 分级口径、配色、文案；无栅格覆盖时的城市距离衰减估算模型 | `MAJOR_CITIES`、`TIBET_REGIONS`、`getLightPollutionLevel`、`LEVEL_COLORS`、`lightPollutionInfo`、`getBortleLevel` |
| 2 | `lightpollution-data.js` | 数据层：加载瓦片与查询栅格、像素取值、瓦片 URL 生成、高缩放裁剪放大 | `LP_DATA`、`LP_MAX_TILE_ZOOM`、`getLevelAt`、`getValueAt`、`inLPRange`、`lpOverzoomTile`、`queryWMSFeatureInfo`、`buildHeatmapData` |
| 3 | `spots.js` | 内置观星点清单 | `defaultSpots` |
| 4 | `state.js` | 全局可变状态集中声明 | `map`、`markers`、`customSpots`、`wmsLayer`、`heatmapInstance`、`currentLayer` 等 16 个 |
| 5 | `storage.js` | `localStorage` 读写与 Toast | `loadCustomSpots`、`saveCustomSpots`、`showToast` |
| 6 | `markers.js` | 观星点标记、可见性、侧边列表渲染、新增点 | `createMarker`、`refreshMarkers`、`renderSpotList`、`addCustomSpot` |
| 7 | `search.js` | 观星点搜索、行政区定位与轮廓绘制、触发统计 | `window.performSpotSearch`、`window.performRegionSearch` |
| 8 | `map.js` | 地图实例创建、四种图层、图层切换、地图选点 | `initMap`、`createMap`、`switchLayer` |
| 9 | `chart.js` | 区域采样、等级统计、ECharts 环形图 | `calculateRegionPollutionFromWMS`、`updatePieChart`、`initPieChart` |
| 10 | `main.js` | 启动入口与文献引用弹窗事件 | 启动时调用 `loadCustomSpots()` / `loadLPData()` / `loadLPOverlay()` / `initMap()` |

依赖方向是单向的：`config` → `lightpollution-data` → `spots` → `state` → `storage` → `markers` → `search` → `map` → `chart` → `main`，前面的模块不引用后面的模块。

## 数据组织

| 文件 | 尺寸 | 用途 |
|---|---|---|
| `tiles/{z}/{x}/{y}.png` | 8794 张 / 9.41 MB | 光污染图层瓦片，z0–z9 |
| `data/lp_overlay.png` | 3200×1900 / 605 KB | 高缩放兜底取样源 |
| `data/lp_level.png` | 3200×1900 / 327 KB | 等级栅格，供单点查询与区域统计 |
| `data/lp_value.png` | 640×380 / 114 KB | 数值栅格（对数量化），供数值展示 |

瓦片由源数据**原生分辨率**（`1/120°` = 120 px/deg）生成：

- **z ≤ 9**：直接命中预渲染瓦片。z8 及以下逐像素还原源数据，z9 起用双线性插值平滑放大。
- **z > 9**：取 z9 父瓦片（364 px/deg）裁剪放大，`imageSmoothingEnabled = true` + `imageSmoothingQuality = 'high'`，放大倍数只有 2/4/8，不出现硬边马赛克。父瓦片尚未下载完成时退回 `lp_overlay.png` 兜底。

瓦片颜色用调色板 PNG（8 色 + 索引 0 全透明），因此单张瓦片只有几百到几千字节。

## 分级口径（波特尔 7 级）

阈值 `[0.0005, 0.001, 0.005, 0.01, 0.03, 0.06]`（单位：与 Falchi 等 2016 数据集一致的辐射亮度），页面 `getBortleLevel()` 与构建脚本 `BRK` 完全一致。

| 级 | 颜色 | 说明 | 典型场景 |
|---|---|---|---|
| 1 | `#12203a` | 极暗 | 青藏高原无人区、塔克拉玛干腹地 |
| 2 | `#1b4a7a` | 暗 | 冷湖、阿里 |
| 3 | `#1f7a6a` | 良好 | 偏远山区 |
| 4 | `#c9c93b` | 中等 | 城市远郊 |
| 5 | `#e08f26` | 轻度 | 县城周边 |
| 6 | `#d94f28` | 重度 | 中小城市 |
| 7 | `#ff2d55` | 极重度 | 大城市中心 |

> 等级 0 **不是「无数据」**，而是该像元辐射值恰好为 0（完全无人工光源），属有效观测值，等价波特尔 1 级「极暗」。因此单点查询遇到 0 会正常弹窗并显示「0（无人工光源）」，区域统计也会把 0 计入 1 级。只有坐标落在栅格覆盖矩形（72–136°E / 17–55°N）之外，才判定为「无数据」并回退到城市距离衰减模型。

## 本地预览

```bash
cd site
python -m http.server 8899
# 打开 http://127.0.0.1:8899/
```

必须通过 HTTP 访问，直接双击 `file://` 打开会因 canvas 跨域污染而取不到像素值。

> **本地可能看不到地图**：高德 JS API 的 key 绑定了域名白名单，`127.0.0.1` 不在名单内时 `AMap.DistrictSearch` 回调不会触发，页面会一直停在「获取中国边界失败」并退化为默认视图（地图容器 blank，观星点与瓦片都不加载）。这不是代码问题。解决办法：到 [高德控制台](https://console.amap.com/dev/key/app) 把 `127.0.0.1` 与 `localhost` 加入该 key 的域名白名单；或者临时换一个没有白名单的 key 做本地调试。

## 数据来源与许可

光污染数据来自 **Falchi et al., 2016, The new world atlas of artificial night sky brightness**。

- 数据集 DOI：<https://doi.org/10.5880/GFZ.1.4.2016.001>
- 论文 DOI：<https://doi.org/10.1126/sciadv.1600377>

原始数据集（`World_Atlas_2015.zip`，含约 3.0 GB GeoTIFF）**不在本仓库中**：其 `README.txt` 明确声明 *further distribution of these files and commercial use are both generally prohibited*，禁止再分发与商业使用。仓库内只保留由其派生的可视化瓦片与查询栅格，并按上述要求引用两项 DOI。

如需从原始数据重建，请自行向 GFZ 申请获取 GeoTIFF，再用 `tools/build_data.py` 生成，见下节。

## 重新生成数据

```bash
python tools/build_data.py --zip ../World_Atlas_2015.zip --out . --zmax 9
```

常用参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--zmax` | `9` | 预生成瓦片最深层级。10 → 25 MB，11 → 约 60 MB |
| `--step` | `1/120` | 网格步长 = 源数据原生分辨率。**不要调粗**，会引入马赛克 |
| `--level-step` | `0.02` | 查询用等级栅格步长 |
| `--value-step` | `0.1` | 查询用数值栅格步长 |
| `--overlay-step` | `0.02` | 叠加图取样步长（刻意比渲染分辨率粗，避免 canvas 超 30 MB） |
| `--grid-cache` | 无 | 指定 `.npy` 缓存全分辨率网格，二次构建可省去重读 3 GB TIF（首次约 156 秒，有缓存约 30 秒） |

初次构建建议先生成缓存：

```bash
python tools/build_data.py --zip ../World_Atlas_2015.zip --out . \
  --grid-cache "$TEMP/nat_grid.npy"

# 后续只改层级，无需重读 TIF
python tools/build_data.py --zip ../World_Atlas_2015.zip --out . --zmax 10 \
  --grid-cache "$TEMP/nat_grid.npy"
```

## 部署

见 `DEPLOY.md`。
