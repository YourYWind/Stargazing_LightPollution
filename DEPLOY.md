# 部署与验证

本站点是纯静态站点（HTML + CSS + JS + 图片），无需编译、无需后端，任何静态文件服务器都能托管。下面以 GitHub Pages 为例。

## 一、部署到 GitHub Pages

### 1. 准备仓库

仓库根目录就是 `site/` 目录的**内容**（不是把 `site` 文件夹本身放进去）。

```bash
cd site
git init
git add .
git commit -m "观星地图：光污染可视化静态站点"
git branch -M main
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main
```

`push` 时 GitHub 已不接受账号密码，需用 PAT（个人访问令牌）：`Settings` → `Developer settings` → `Personal access tokens` → `Tokens (classic)` → `Generate new token`，勾 `repo` 权限，生成后复制一次，粘贴到密码位置。

装了 GitHub CLI 的话更省事：

```bash
gh auth login
gh repo create <仓库名> --public --source=. --push
```

### 2. 开启 Pages

1. 仓库 → `Settings` → 左侧 `Pages`
2. `Source` 选 **Deploy from a branch**
3. `Branch` 选 **main**，目录选 **/ (root)**
4. `Save`，等 1–3 分钟

访问 `https://<用户名>.github.io/<仓库名>/`。`index.html` 会自动跳转到 `lightpollution.html`。

### 3. 三个容易踩的点

- **`.nojekyll` 必须在根目录**。否则 Jekyll 会跳过以下划线开头的路径，构建也更慢。
- **资源必须用相对路径**（`js/...`、`data/...`、`tiles/...`）。写成 `/js/...` 时，站点部署在 `/<仓库名>/` 子路径下会全部 404。
- **`index.html` 必须在根目录**，这是 Pages 的默认入口。

### 4. 高德 Key 的域名白名单

高德 JS API 的 key 绑定域名。到 [高德控制台](https://console.amap.com/dev/key/app) 给页面里用的 key 添加：

```
<用户名>.github.io
```

不加的表现是：页面能打开，但地图不显示，控制台报 `INVALID_USER_DOMAIN`（`infocode: 10006`），`AMap.DistrictSearch` 的回调永远不触发。

> 同一条规则也影响本地调试：`127.0.0.1` / `localhost` 不在白名单时本地同样看不到地图。要本地预览就把这两个也加进去，或临时换一个无白名单的 key。

> 安全提示：key 与 `securityJsCode` 以明文写在 `lightpollution.html` 里，查看源码即可获得。公开仓库尤其要配域名白名单，避免配额被盗用，并在高德控制台开启配额告警。

### 5. 可选：用 GitHub Actions 自动部署

若希望 push 后自动发布，加 `.github/workflows/pages.yml`：

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

然后把 `Settings` → `Pages` → `Source` 改为 **GitHub Actions**。自定义 workflow 不受「每小时 10 次构建」软限约束。

## 二、部署后验证清单

- [ ] 打开 `https://<用户名>.github.io/<仓库名>/` 能进主页面
- [ ] 卫星图正常，中国国界金色描边显示
- [ ] 切「光污染图」→ 华北平原、长三角、珠三角呈红色高亮，青藏高原/塔克拉玛干为深蓝或透明
- [ ] 图例 7 档颜色与地图配色一致
- [ ] 放大到 z8/z9，能看到城市内部的路网纹理
- [ ] 放大到 z10/z12，光污染图层**不消失**、**无硬边马赛克**
- [ ] 点击地图任意位置 → 弹出波特尔等级信息窗，含光污染值/极限星等/SQM/银河/M31/黄道光
- [ ] **点击青藏高原西侧、塔克拉玛干腹地等纯黑区域同样弹窗**，数值显示「0（无人工光源）」
- [ ] 选省份 → 定位到所选区域 → 右下角饼图按 7 级统计
- [ ] **选西藏/青海，饼图 1 级「极佳」占比接近 100%**
- [ ] 自定义观星点后刷新页面，点位仍在（`localStorage` 生效）
- [ ] 浏览器控制台无 CORS / 混合内容 / 404 报错
- [ ] 手机端访问布局不崩

## 三、体积与配额

| 项 | 数值 |
|---|---|
| 文件数 | 8819 |
| 仓库体积 | 11.8 MB |
| 瓦片 | 8794 张 / 9.41 MB（z0–z9） |
| 最大单文件 | `js/echarts.min.js` 约 1.0 MB |

GitHub 的限制是单文件 100 MB、仓库建议 1 GB、Pages 已发布站点 1 GB、带宽软限 100 GB/月。本站点体积只占 1.2%，瓦片总量也不大，正常访问不会触碰带宽额度。

## 四、其他静态托管平台

同一份文件也能直接放到 Cloudflare Pages、Netlify、Vercel、Nginx、对象存储 + CDN 上，不需要改任何代码——只要满足「支持相对路径 + 自定义 404 不干扰」即可。注意把新域名同步加进高德 key 的域名白名单。

## 五、更新数据

改了阈值、配色或想提高瓦片层级后，用 `tools/build_data.py` 重新生成，参数说明见 `README.md` 的「重新生成数据」一节。生成完 `git add -A && git commit && git push` 即可，Pages 会在 1–2 分钟内更新。

## 六、已知限制

| 项 | 现状 | 可能的改进 |
|---|---|---|
| 高缩放画质 | z10+ 从 z9 瓦片裁剪 + 双线性放大 | 把 `--zmax` 提到 10（体积 25 MB） |
| 数据精度 | 已用源数据原生 `0.008333°`（120 px/deg） | 受源数据限制，无法再提高 |
| 观星点数据 | 存 `localStorage` | 换设备会丢失，可后续接 Gist 或轻量后端 |
| 瓦片文件数 | 8794 个 | 可合并成 MBTiles / PMTiles 单文件，但需引入解析库 |
| 高德 key | 明文在前端 | 域名白名单 + 配额告警；彻底隐藏需自建代理 |
