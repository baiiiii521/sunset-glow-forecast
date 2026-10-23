<div align="center">

# 霞 · 全球火烧云预报

**基于大气光学文献与实时数值天气预报，预测全球任意地点的朝霞与晚霞。**

[![Live Demo](https://img.shields.io/badge/live%20demo-glow.nybbq.art-FF6A2C?style=flat-square)](https://glow.nybbq.art/) [![License: MIT](https://img.shields.io/badge/license-MIT-2EA44F?style=flat-square)](LICENSE) [![Vanilla JS](https://img.shields.io/badge/stack-vanilla%20JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript) [![No build](https://img.shields.io/badge/build-none-3FA66A?style=flat-square)](#快速开始) [![Data](https://img.shields.io/badge/data-Open--Meteo%20%2B%20CAMS-4C8BF5?style=flat-square)](https://open-meteo.com/)

[简体中文](README.md) · [English](README.en.md)

<a href="https://glow.nybbq.art/"><img src="docs/assets/hero.jpg" alt="霞 · 全球火烧云预报" width="100%"></a>

<sub>墨西哥城 · 今晚晚霞 87 / 100（大烧）· 截图来自线上版本</sub>

</div>

---

「霞」是一个打开即用的火烧云预报站。搜索任意城市，它会给出今明两天四场——今日朝霞、今晚晚霞、明日朝霞、明日晚霞——的六档等级、0–100 霞分、通透度、多模式一致度、置信度、最佳观测窗，以及一句「为什么」。

大多数天气应用只告诉你云量。但晚霞能不能烧起来，取决于三件事是否同时成立：

1. **幕布**：中高云够不够。没有云，再好的光也没有东西可照。
2. **缺口**：太阳方向的上游有没有低云，挡住贴着地平线射来的光。
3. **低云**：视野里的低云不能太厚，否则地平面被糊住。

「霞」把这三项做成**几何平均**：任何一项接近 0，霞分就接近 0。降水、气溶胶、能见度、PM2.5、露点差、风和对流只做 ×0.7–1.0 的调制。这是它和「加权平均型」指数最大的区别——万里无云不会被算成中烧。

站点本身是纯静态的：没有后端、没有数据库、没有构建步骤，所有计算在浏览器里完成。服务器只做两件事：托管静态文件，以及每天生成一次霞榜 JSON。

## 功能

### 预报

| 能力 | 说明 |
|---|---|
| **四场同屏** | 今明两天的朝霞与晚霞并排展示；点哪一场，天幕、时间轴与剖面一起切换 |
| **结论优先** | 先给一句话结论（「基本没有」/「有一点·小烧」/「有·大烧」）和行动建议，再给分数 |
| **多模式集合** | 云量同时取 best_match、ECMWF IFS、GFS、ICON 四套预报，各算一遍霞分后加权平均（综合模式 ×3） |
| **置信度** | 按各模式是否落在同一档附近给出高 / 中 / 低，而不是只看分数离边界多远 |
| **通透度 1–7** | AOD、能见度、PM2.5、露点差单独评分，与云况分开呈现 |
| **可核对** | 11 项因子、权重、模式分歧与科学原理全部折叠在「为什么这样判断？」中 |

### 界面

- **天幕即界面**：首屏天空、云底光照、太阳与水面倒影都由当前场次的评分驱动。云层用 SVG 分形噪声与自下而上的漫射光生成，铺在透视平面上。
- **天色时间轴**：以选中场次为中心前后 2.5 小时，可拖动或自动播放；按真实太阳高度角划分白昼、金色时刻、火烧云、蓝调时刻、浅黑、黑六段。
- **大气剖面**：11 项因子按它们在大气中的高度排成层，缺数据的层明确标注「无数据」。
- **首屏留白**：首次访问不预设城市；点击页面或「定位」后按 GPS → IP 的顺序定位一次，之后不再覆盖手动选择。
- **收藏与缓存**：收藏地点、榜单缓存只写入浏览器 localStorage。

### 霞榜

每天北京时间 15:00，服务器运行 `scripts/build-rankings.js`，用与网页完全相同的算法批量计算全球 36 座、中国 34 座大城市的下一场晚霞，输出 `data/rankings.json`。页面直接读取这份静态文件：

- 访客不再各自发起约 350 次 API 请求；
- 文件缺失或超过 36 小时，才回退到浏览器实时计算；
- 按霞分排序，同分看置信度，并给出六档城市分布与全球坐标带。

### 命令行与自动化

| 脚本 | 用途 |
|---|---|
| `scripts/daily-push.js` | 与网页同源的文字版预报：7 天、标定概率、光谱颜色、最红时刻、ECMWF ENS-51 分布 |
| `scripts/build-rankings.js` | 生成每日霞榜 JSON（先写临时文件再原子改名） |
| `scripts/verify-rankings.js` | 用独立模型逐城复核霞榜，写回 verified 标记 |
| `scripts/daily_snapshot.py` | 日落后把预报云量、霞分与机场 METAR 实测追加到 JSONL 数据集 |
| `scripts/verify_vs_metar.py` | 预报云量 vs METAR 实测云量 |
| `scripts/label.py` / `scripts/eval.py` | 人工真值标注与命中率 / AUC 评估 |

## 工作原理

### 数据流

每个地点一次完整评估只发 **3 个请求**（搜索时另有 1 次地理编码）：

1. **预报**：本地 + 沿日出 / 日落方位角 50–400 km 的上游点，四套模式一次取回；
2. **空气质量**：CAMS 的 AOD（550 nm）、PM2.5、PM10；
3. **集合预报**：多点、多模式的云量，用于计算模式一致度。

今明两天的同类事件方位角只差不到 0.5°，因此上游点共用一次请求。

### 霞分 v2.2

```text
key  = 幕布^0.50 × 缺口^0.30 × 低云^0.20          # 加权几何平均，0–100
air  = 降水 / 气溶胶 / 能见度 / PM2.5 / 露点差 / 风 / CAPE 的加权平均
霞分 = key × (0.7 + 0.3 × air / 100) + 雨后洗净（0–5）
```

- 霞时刻有降水：霞分封顶 34（最高微烧）。
- 幕布额外乘 0.75–1.0 的「受光亮度」：同样云量下高云比中云更亮，AOD 越高越暗。
- **缺口 v2** 只把上游低云 + 0.5 × 中云计算为挡光。照亮云底的光贴着地平线射来，高云（卷云）挡不住它。

### 六档与置信度

| 霞分 | 等级 | 含义 |
|---:|---|---|
| 80–100 | 大烧 | 漫天霞色，值得专门出门 |
| 65–79 | 中到大烧 | 大面积火烧云 |
| 50–64 | 小到中烧 | 出现火烧云的机会较大 |
| 35–49 | 小烧 | 有机会出现小片霞色 |
| 20–34 | 微烧 | 云边可能泛一点淡色 |
| 0–19 | 无烧 | 云况不足，基本看不到 |

置信度由四套模式的一致度决定：≥80% 的模式落在 ±1 档且极差 ≤30 为「高」，≥60% 为「中」，否则为「低」。

### 物理增强（v2.2，推送管线）

以下四层目前用于每日推送与命令行，网页仍以 v2 几何模型为主：

- **概率标定**：`P = sigmoid(0.0375 × (霞分 − 77.9))`，锚定历史同类分数的烧率（50 分 ≈ 26%、65 分 ≈ 38%、80 分 ≈ 52%，基准烧率约 17%）。
- **光谱颜色**：CIE 1931 拟合 + 61 个波长（400–700 nm）积分，瑞利散射 τ ∝ λ⁻⁴·¹、气溶胶 τ ∝ λ⁻¹·³，输出金黄 / 橘黄 / 橘红 / 绯红 / 玫瑰红。
- **最红时刻**：按云底高度计算受光极限（高云约 −2.9°、中云约 −2.3°），二分求太阳高度角，给出「最红窗口」。
- **ENS-51**：ECMWF 51 个集合成员逐点跑霞分，输出概率分布。

## 快速开始

要求：现代浏览器。JavaScript 与 Python 脚本需要 Node.js 18+ / Python 3.9+，均为可选。

```bash
git clone https://github.com/baiiiii521/sunset-glow-forecast.git
cd sunset-glow-forecast

# 任选其一
open index.html                  # 直接打开
python3 -m http.server 8000      # 或起一个静态服务器（推荐）
```

然后访问 <http://localhost:8000>。没有 `npm install`，也没有构建步骤。

> 页面直连 Open-Meteo。若同一网络频繁刷新触发 429，等一分钟再试。

## 项目结构

```text
.
├── index.html              页面骨架与 SVG 云层滤镜
├── styles.css              样式、设计 token 与动效
├── algo.js                 算法层：纯函数，浏览器与 Node 共用
├── api.js                  数据层：Open-Meteo 请求、地点评估、批量计算
├── app.js                  界面层：渲染、交互、定位、本地缓存
├── scripts/
│   ├── build-rankings.js   每日霞榜 → data/rankings.json
│   ├── stamp-assets.js     给 css/js 引用打内容哈希版本号
│   ├── daily-push.js       文字版预报与推送载荷
│   ├── jev.js              独立模型复核客户端
│   ├── verify-rankings.js  霞榜逐城复核
│   ├── daily_snapshot.py   预报 + METAR 实测数据集
│   ├── verify_vs_metar.py  云量观测对照
│   └── label.py / eval.py  人工标注与评估
├── test/
│   ├── parity.js           JS 与 Python 实现的逐项对照（离线）
│   ├── search.js           地名搜索与同名消歧（联网）
│   └── smoke.js            完整页面初始化（联网）
├── docs/                   算法对比、交接文档与截图
└── data/                   运行时数据，不入库
```

依赖方向只有一条：`app.js → api.js → algo.js`。算法层不碰网络，数据层不碰 DOM，所以同一份 `algo.js` / `api.js` 可以直接在服务器上复用于霞榜。

## 开发与测试

```bash
node test/parity.js                  # 离线，必须 PASS
node test/search.js                  # 联网
node test/smoke.js                   # 联网，跑完整页面初始化
node scripts/stamp-assets.js --check # 检查静态资源版本号是否过期
node scripts/build-rankings.js data/rankings.json
```

改过 `styles.css`、`app.js`、`algo.js` 或 `api.js` 之后，提交前必须运行 `node scripts/stamp-assets.js`，把内容哈希写回 `index.html`。

## 部署

| 平台 | 步骤 |
|---|---|
| **GitHub Pages** | Settings → Pages → Deploy from a branch → `main` / `(root)` |
| **Vercel** | 导入仓库，Framework Preset 选 `Other`，无需构建命令 |
| **Netlify** | Publish directory 填 `.`，Build command 留空 |
| **自有服务器** | 任意静态服务器托管仓库根目录；加一条 cron 每天生成 `data/rankings.json` |

## 数据来源

| 来源 | 用途 | 费用 |
|---|---|---|
| [Open-Meteo Forecast](https://open-meteo.com/) | 分层云量、降水、能见度、风、CAPE、日出日落 | 免费，无需 Key |
| [Open-Meteo Air Quality](https://open-meteo.com/en/docs/air-quality-api) | CAMS AOD（550 nm）、PM2.5、PM10 | 免费，无需 Key |
| [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api) | 中文地名搜索 | 免费，无需 Key |
| [Open-Meteo Ensemble](https://open-meteo.com/en/docs/ensemble-api) | ECMWF ENS-51（推送管线） | 免费，无需 Key |

免费层额度为 600 次/分钟、10,000 次/天，以官方最新政策为准。

## 准确性与局限

- 这是一套**基于已发表文献的启发式模型**，不是官方气象预报。学界目前没有经过同行评审的「晚霞颜色指数」。
- 六档阈值与几何权重只用 1 天、39 个点做过交叉对比（今晚场 AUC 0.79）。AUC 衡量的是与外部榜单的排序一致性，不等于准确率。
- 真值数据仍在积累：`data/glow-dataset.jsonl` 记录每日预报与 METAR 实测，`data/glow-labels.jsonl` 记录人工标注。样本足够后会重新标定阈值与权重。
- 缺数据时页面明确显示「无数据」，不做插值或猜测。
- CAMS 为全球域（约 45 km、3 小时），局地精度有限。
- 时间轴上的霞强度曲线是「评分 × 钟形时间窗」的示意，不是物理输出。
- 霞榜覆盖 70 座大城市，尚不及区县级精度。
- 所有查询在浏览器端发出，不收集、不上传个人数据；收藏与缓存只存在本地。

## 后续方向

- 用实况标注校准阈值、几何权重与模式权重，并补一个自动输出 AUC / 命中率的评估脚本。
- 在服务器侧缓存代理 Open-Meteo，改善国内访问速度与额度。
- 霞榜扩容到区县，增加朝霞榜与全国热力格点。
- 把 ENS-51 概率分布与物理受光曲线接入网页，替换当前的示意时间曲线。
- CI 增加 `parity` 与 `stamp-assets --check`。

## 致谢

- Stephen Corfidi, *The Science of Sunsets*（NOAA/NWS）
- SOLA 2013 辐射传输模拟
- SkyCandy、SunsetWx、Skyfire 的公开启发式规则
- [Skyglow](https://github.com/couletian/Skyglow)：光谱、受光几何与概率标定
- [Open-Meteo](https://open-meteo.com/) 与 CAMS 提供的免费数据
- 公众号「super朝霞晚霞预报」的公开榜单，用于交叉对比

## License

[MIT](LICENSE)。本项目与任何官方气象机构无隶属关系，预报仅供观测参考。
