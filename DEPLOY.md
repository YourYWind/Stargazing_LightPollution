# 从 GeoServer 迁移到 GitHub Pages · 操作条目

> 结论：**可以实现**。项目本身是纯前端（高德 JS API + ECharts），唯一的服务端依赖是 GeoServer 提供 `World_Atlas_2015` 栅格图层与 `GetFeatureInfo` 查询。
> 本项目已经把这两项能力**离线预渲染**成静态文件，因此不需要任何服务器，GitHub Pages 免费托管即可。
>
> 已在 `site/` 副本上完整跑通并截图验证（z5/z8/z10 三个缩放级别、三种图层、点击查询、行政区统计饼图）。

---

## 零、为什么必须换掉 GeoServer（先看这个，决定方案）

| 限制 | 数值 | 对方案的影响 |
|---|---|---|
| GitHub 单文件硬上限 | 100 MB | `World_Atlas_2015.tif` 3.01 GB、`.tpk` 387 MB 都**不可能**入库 |
| Pages 已发布站点上限 | 1 GB | 原始数据即使能传也会直接超限 |
| Pages 部署超时 | 10 分钟 | 每次 push 都要重新构建 3 GB 栅格会超时 |
| Pages 带宽软限 | 100 GB/月 | WMS 风格的高频瓦片请求会打爆额度 |
| 原页面协议 | 全站 `http://` | Pages 强制 HTTPS，`http://` 请求会被浏览器按混合内容拦截 |
| 数据许可 | `README.txt` 明示禁止再分发 | 原始 TIF **不能**放进公开仓库 |

→ 唯一可行路线：**构建期把栅格转成小体积静态瓦片 + 低分辨率查询栅格，运行期零后端**。

---

## 一、代码改造（已在 `site/` 完成，可直接复用）

### 1. 数据层：TIF → 静态瓦片 + 查询栅格

| 产出 | 尺寸/大小 | 作用 |
|---|---|---|
| `tiles/{z}/{x}/{y}.png` | 8794 张 / **9.41 MB**（z0–z9） | 替代 `AMap.TileLayer.WMS` 的底图瓦片 |
| `data/lp_overlay.png` | 3200×1900 / **605 KB** | z10+ 父瓦片未就绪时的兜底纹理 |
| `data/lp_level.png` | 3200×1900 / **327 KB** | 0.02° 波特尔等级栅格，供点击查询与区域统计 |
| `data/lp_value.png` | 640×380 / **114 KB** | 0.10° 数值栅格（对数量化），供数值展示 |
| **站点合计** | 8809 文件 / **11.64 MB** | 远低于 1 GB 上限 |

生成脚本：`site/tools/build_data.py`（需自行准备原始 TIF，见 README）。

```bash
python tools/build_data.py --zip World_Atlas_2015.zip --out . --zmax 9
# 或
python tools/build_data.py --tif World_Atlas_2015.tif --out . --zmax 9
```

> `--step` 默认 `1/120`（= 源 TIF 原生分辨率 0.008333°）。**不要**再改回旧的 0.02，那只有 50 px/deg，比源数据粗 2.4 倍，是放大后马赛克的主因。

### 2. 图层层：WMS 图层 → 自定义 XYZ 瓦片

```js
wmsLayer = new AMap.TileLayer({
    getTileUrl: function (x, y, z) {
        if (z <= LP_MAX_TILE_ZOOM) {            // z0–z9：直接用预渲染瓦片
            return LP_TILE_ROOT + z + '/' + x + '/' + y + '.png';
        }
        return lpOverzoomTile(x, y, z);          // z10+：从 z9 瓦片裁剪放大
    },
    zIndex: 10, zooms: [0, 18], opacity: 0.85, visible: false
});
```

> 踩过的坑：`AMap.TileLayer` 的 `zooms` 是**硬截止**，超出后图层直接消失（不会拉伸保留），所以必须自己实现 `lpOverzoomTile`。
> 另一个坑：叠加图未就绪时返回的空白瓦片**绝对不能写入缓存**，否则叠加图加载完成后这些瓦片仍会一直是空白。

放大源的选择很关键：`lpOverzoomTile` ��先取 `LP_MAX_TILE_ZOOM`（z9，364 px/deg）的父瓦片做 `drawImage` 裁剪，放大倍数只有 2/4/8；只有父瓦片还没下载完时才退回整幅 `lp_overlay.png`（0.02°，仅 50 px/deg，z10 就是 14 倍放大）。早期版本只用了叠加图，所以 z10 全是硬边色块。两处都用 `imageSmoothingEnabled = true` + `imageSmoothingQuality = 'high'`，让放大呈渐变而不是马赛克。

### 3. 查询层：GetFeatureInfo → 浏览器内读像素

- 单点查询：把 `lp_value.png` 画到离屏 canvas，`getImageData` 按经纬度索引像素，再反量化 `v = 10^((code-1)/254*7.5-6)`。
- 区域统计：`calculateRegionPollutionFromWMS` 改为 0.2° 采样 + `isPointInPolygon` 过滤 + 内存查 `lp_level.png`，**零网络请求**（原方案是每 20 个点一批打 GetFeatureInfo，一次查询几百个请求）。

### 4. 分级与配色：5 级 → 7 级波特尔统一

原代码存在两套并存的分级：`getLightPollutionLevel()` 是 5 级城市距离衰减模型，`lightPollutionInfo` 是 7 级波特尔。已统一为 7 级，图例、饼图、InfoWindow 全部对齐。

> 踩过的坑：分级函数必须与生成脚本完全一致。`classify()` 写成 `cls[a >= th] = i + 1` 只会产出 0..6，会导致**整体配色掉一档**（7 级被画成 6 级色、1 级被画成透明）。正确写法是先 `cls[a > 0] = 1`，再 `cls[a >= th] = i + 2`。

### 5. 第三方依赖本地化

- ECharts 从 `cdn.jsdelivr.net` 改为 `js/echarts.min.js`（**必须**：CDN 不可达时饼图整条链路静默失败）。
- 高德 JS API 仍需联网（`webapi.amap.com`），这是地图底图的必要依赖，无法离线。

---

## 二、GitHub 仓库与 Pages 配置

### 1. 建仓库

1. 注册/登录 GitHub → 右上角 `+` → `New repository`
2. 填写：
   - `Repository name`：`stargazing-map`（示例）
   - `Description`：可选，如「中国光污染与观星地图」
   - **`Public`**（必须公开，Pages 免费额度只对公开仓库开放）
   - **不要**勾选 `Add a README file` / `.gitignore` / `license`（本地已有，勾了会冲突）
3. `Create repository`

### 2. 准备本地目录

把 `site/` 目录**内容**作为仓库根（不是把 `site` 文件夹本身放进去）。

`.gitignore`（放在 `site/` 里，内容如下）——只防止误提交大文件：

```gitignore
World_Atlas_2015.zip
World_Atlas_2015.tif
*.tpk
*.docx
```

> 因为原始数据本来就不在 `site/` 里，这个 `.gitignore` 主要是给「从上级目录 `git init`」的情况兜底。**强烈建议直接在 `site/` 内 `git init`**，从根上避免 684 MB 的 zip 被加入暂存区。

### 3. 上传（两种方式择一）

**方式 A：网页上传（无需装 Git，但慢）**

1. 仓库页 → `Add file` → `Upload files`
2. 打开 `D:\文档（副本）\web前端\JS大作业\site`，全选 **里面的内容**（`index.html`、`lightpollution.html`、`.nojekyll`、`README.md`、`DEPLOY.md`、`js/`、`data/`、`tiles/`、`img/`、`tools/`）拖进浏览器
3. `Commit changes`

> ⚠️ 现在有 **8809 个文件**，其中 `tiles/` 占 8794 个。网页上传会反复超时和漏文件，**不推荐**。如果一定要用网页上传，先把 `--zmax` 降到 7（只有 432 张瓦片）。

**方式 B：Git 命令行（推荐）**

先确认已装 Git：`git --version`。没装的话去 https://git-scm.com/download/win 装，或 `winget install Git.Git`。

```bash
cd "D:/文档（副本）/web前端/JS大作业/site"

git init
git add .
git commit -m "迁移为纯静态站：预渲染瓦片 + 本地栅格查询"
git branch -M main
git remote add origin https://github.com/<你的用户名>/stargazing-map.git
git push -u origin main
```

首次 `push` 会要求登录。**推荐用 PAT（个人访问令牌）**，GitHub 已不接受账号密码：

1. GitHub → `Settings` → `Developer settings` → `Personal access tokens` → `Tokens (classic)` → `Generate new token`
2. 勾选 `repo` 权限，生成后**复制一次**（页面关掉就看不到了）
3. `push` 时用户名填 GitHub 用户名，密码处粘贴这个 token

或者用 GitHub CLI 更省事：`winget install GitHub.cli` → `gh auth login` → `gh repo create stargazing-map --public --source=. --push`。

> `git add .` 前先 `git status` 看一眼，确认**没有** `World_Atlas_2015.zip`。文件多的话 `git add` 要跑十几秒，属正常。

### 4. 开启 Pages

1. 仓库 → `Settings` → 左侧 `Pages`
2. `Source` 选 **Deploy from a branch**
3. `Branch` 选 **main**，目录选 **/ (root)**
4. `Save`，等 1–3 分钟（到 `Actions` 页能看到 `pages build and deployment` 跑完）
5. 访问 `https://<你的用户名>.github.io/stargazing-map/`

> 若放在 `site/` 子目录，分支目录要选 `/docs`（把 `site` 改名 `docs`）或把内容提到仓库根。**推荐直接放根目录**，路径最简单。

### 5. 必须确认的三件事

- [ ] `.nojekyll` 已提交（否则 Jekyll 会忽略以 `_` 开头的路径，某些情况下还会拖慢构建）
- [ ] `index.html` 在根目录（Pages 默认入口）
- [ ] 所有资源用**相对路径**（`js/...`、`data/...`、`tiles/...`），不要写成 `/js/...`，否则部署到 `/<仓库名>/` 子路径下会 404

### 5. 高德 Key 的域名白名单

高德 JS API 的 key 绑定域名。必须到 [高德控制台](https://console.amap.com/dev/key/app) 给 `48e76c355245a44e1fd0437b9b323797` 添加：

```
<你的用户名>.github.io
```

否则线上会报 `INVALID_USER_DOMAIN`，地图不显示。

> 安全提示：当前 key 与 `securityJsCode` 以明文写在页面里，任何人查看源码都能拿到。建议在高德控制台为该 key 设置**域名白名单**（只允许你的 Pages 域名），并开启配额告警。

---

## 三、可选：用 GitHub Actions 自动部署

如果希望「push 后自动构建发布」，加 `.github/workflows/pages.yml`：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - id: deployment
        uses: actions/deploy-pages@v4
```

配置：`Settings` → `Pages` → `Source` 改为 **GitHub Actions**。

> 用自定义 Actions workflow 不受「每小时 10 次构建」软限约束，更适合频繁更新。

---

## 四、验证清单

部署后逐项确认：

- [ ] 打开 `https://<用户名>.github.io/<仓库>/` 能进主页面
- [ ] 卫星图正常，中国国界金色描边显示
- [ ] 切「光污染图」→ 华北平原、长三角、珠三角呈红色高亮，青藏高原/塔克拉玛干为深蓝或透明
- [ ] 图例 7 档颜色与地图配色一致
- [ ] 放大到 z8/z9，能看到城市内部的路网纹理（原生分辨率生效）
- [ ] 放大到 z10/z12，光污染图层**不消失**、**无硬边马赛克**（走 z9 瓦片裁剪 + 双线性）
- [ ] 点击地图任意位置 → 弹出波特尔等级 InfoWindow，含光污染值/极限星等/SQM/银河/M31/黄道光
- [ ] **点击青藏高原西侧、塔克拉玛干腹地等纯黑区域同样弹出 InfoWindow**，数值显示「0（无人工光源）」
- [ ] 选省份 → 定位到所选区域 → 右下角饼图按 7 级统计
- [ ] **选西藏/青海，饼图 1 级「极佳」占比接近 100%**（0 值像元被计入 1 级，不是被当成无数据丢掉）
- [ ] 浏览器控制台无 CORS / 混合内容 / 404 报错
- [ ] 手机端访问布局不崩

---

## 五、关于「原始 TIF 能不能放进去」与马赛克

### 1. 先把因果关系说清楚

马赛克的真正原因**不是** TIF 没放进仓库，而是旧站点图层精度只有源数据的 **1/2.4**：

| 项目 | 每度像素数 | 折算瓦片层级 |
|---|---|---|
| 源 TIF（`0.008333°`） | **120 px/deg** | ≈ z7.4 |
| 旧站点叠加图（`0.02°`） | 50 px/deg | ≈ z5.9 |
| 新站点（`1/120°`，已重建） | **120 px/deg** | ≈ z7.4 |

也就是说：**即使把 3 GB 的 TIF 原封不动放进仓库，旧版前端也不会变清晰** —— 瓶颈在生成端而非存储端。

现已用原生分辨率重建：`tiles/` 的 z0–z9 全部由 120 px/deg 的网格生成，z8 以下逐像素还原源数据，z9 起用双线性插值平滑放大。站点体积从 4.43 MB → **11.64 MB**，仍然远低于 1 GB。

### 2. 原始 TIF 为什么确实放不进去（三重硬限制）

| 限制 | 数值 | 结论 |
|---|---|---|
| GitHub 单文件上限 | 100 MB | `World_Atlas_2015.tif` = **3.01 GB**，超 30 倍，`push` 直接被拒 |
| Git LFS 免费额度 | 1 GB 存储 / 1 GB 月流量 | 3.01 GB 单文件就超额；超了会被封 LFS 或要求付费 |
| Pages 已发布站点 | ≤ 1 GB | 即使上传成功也无法发布 |
| **数据许可** | `README.txt` 原文：`further distribution of these files and commercial use are both generally prohibited` | **禁止再分发**，公开仓库放原始 TIF 属违约 |

前三条是技术问题，第四条是**法律问题**，无法绕过。所以「把 TIF 塞进仓库」这条路不存在。

### 3. 替代方案（按性价比排序）

| 方案 | 体积 | 清晰度上限 | 改动量 | 评价 |
|---|---|---|---|---|
| **A. 已实施：原生分辨率预渲染瓦片到 z9** | 11.64 MB | 源数据 100%（z≤8），z9+ 平滑放大 | 已完成 | ✅ 当前状态，推荐 |
| **B. zmax 提到 10** | 25.14 MB | z10 也是原生像素 | 改一个参数重跑（80 秒） | 可选，仍在限内 |
| **C. zmax 提到 11** | 约 60 MB | z11 原生 | 同上（约 4 分钟） | 体积可接受，但请求数暴增（z11 单层约 10 万张瓦片） |
| **D. 客户端加载全分辨率数值栅格** | uint8+gzip = **8.07 MB**（4560×7680） | 理论无限放大（客户端实时着色） | 需改前端：`fflate` 解压 + 生成瓦片 | ⚠️ 8 MB 首屏下载，且需引入解压库 |
| E. 降采样数值栅格 | 1/2 = 2.91 MB；1/3 = 0.98 MB | 60 / 40 px/deg | 同 D | 不如 A |
| F. 原始 TIF 托管在别处（Release / S3 / Zenodo） | 3 GB | 需服务端切片 | 要重新引入后端 | ❌ 与「不再跑阿里云」冲突 |

**建议：保持 A，若觉得 z9 以上还不够，把 `--zmax` 改 10（方案 B）。** 理由：

- 源数据本身只有 120 px/deg，z9 以上**并没有更多真实信息**，只是插值方式不同。方案 B 的 z10 是「用双线性插值把原像素放得更大」，视觉比现在略平滑，但不会出现新细节。
- 方案 D 虽然理论上能做到实时着色、放大无级，但 8 MB 的压缩数据要全量下载 + 解压 + 逐瓦片上色，首屏体验反而更差，对手机不友好。
- 要想**真正**更清晰，唯一办法是换更高分辨率的数据源（如 VIIRS 750 m ≈ 54 px/deg 反而不如现有；或 World Atlas 2015 的高分辨率版本），而不是改变部署方式。

### 4. 遗留事项

| 项 | 现状 | 建议 |
|---|---|---|
| 高缩放画质 | z10+ 从 z9 瓦片裁剪 + 双线性放大，无硬边马赛克 | 想更平滑就 `--zmax 10`（25 MB） |
| 数据精度 | 已用源数据原生 `0.008333°` | 无法再提高，受源数据限制 |
| 原始数据分发 | 未入库（许可禁止） | README 已给出两项 DOI 引用与 GFZ 官方获取方式 |
| 高德 key 安全 | 明文在前端 | 配置域名白名单 + 配额告警；如需彻底隐藏需自建代理（与"无后端"目标冲突） |
| 观星点数据 | 存 `localStorage` | 用户换设备会丢失，可后续接 GitHub Gist 或轻量后端 |
| 瓦片文件数 | 8794 个 | 若嫌多，可合并成 MBTiles/PMTiles 单文件（需额外解析库） |

---

## 六、需要你决定/提供的事项

1. **GitHub 用户名与仓库名** —— 决定最终访问地址 `https://<用户名>.github.io/<仓库名>/`，也决定高德 key 白名单要填的域名。
2. **仓库是否公开** —— Pages 免费额度只对**公开**仓库开放。若必须私有，需要 GitHub Pro，或改用 Cloudflare Pages（私有仓库也免费）。
3. **瓦片层级** —— 默认 z9（11.64 MB）。要不要提到 z10（25 MB）？
