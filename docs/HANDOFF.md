# 交接文档 · 霞（全球火烧云预报）

> 写给接手继续优化的 agent / 开发者。读完这一份就能上手：项目是什么、代码怎么分层、为什么这样设计、怎么测试和发布、下一步该做什么。
> 截至 2026-10-19，`main` 为 PR #6 合并后的版本（霞分 v2）。线上：https://glow.nybbq.art

---

## 1. 一句话

纯静态网站（无后端、无构建），浏览器直接调用 Open-Meteo 免费 API，用文献启发式算法预测任意地点今明两天的四场朝霞 / 晚霞会不会「烧」，并用一整块会随评分变化的动态天空把结论「演」出来。服务器只做两件事：托管静态文件 + 每天算一次霞榜 JSON。

## 2. 目录与分层

```
index.html            页面骨架：SVG 云层滤镜定义 + 首屏 + 01 霞历 / 02 天色 / 03 霞榜 / 04 剖面 / 05 原理
styles.css            全部样式与动效（设计 token 在 :root）
algo.js               算法层 SunsetAlgo（UMD，浏览器和 Node 共用，纯函数，不发请求）
api.js                数据层 SunsetAPI（UMD，fetch Open-Meteo、时间工具、地点评估、霞榜批量计算）
app.js                界面层（IIFE，只在浏览器里跑；渲染、交互、定位、缓存）
scripts/
  build-rankings.js   服务器每天跑：用 algo.js + api.js 算霞榜 → data/rankings.json（原子写）
  stamp-assets.js     给 index.html 的 css/js 引用打内容哈希版本号（--check 只检查）
test/
  parity.js           v1 条件分与原 Python 实现 predict.py 逐项对照（fixture.json 由 gen_fixture.py 生成）
  search.js           地名搜索消歧（联网）
  smoke.js            用 DOM 桩在 Node 里跑完整页面初始化（联网）
docs/
  compare-2026-10-19.md  与「super朝霞晚霞预报」公众号的第一次交叉对比
  HANDOFF.md          本文
data/                 gitignore；本地可放一份 rankings.json 调试霞榜
```

依赖方向只有一条：`app.js → api.js → algo.js`。算法层不碰网络，数据层不碰 DOM，所以 `algo.js` / `api.js` 能原样在服务器 Node 22 上复用（霞榜就是这么算的）。

## 3. 算法（algo.js）

### 3.1 两层分数

| 层 | 字段 | 作用 |
|---|---|---|
| v1 条件分 | `condScore` / `condGrade` / `condConf` | 11 项加权平均，**与 predict.py 保持逐位一致**，parity 测试守着它。不要改它的行为；要改算法，改 v2 层。 |
| v2 霞分 | `score` / `level` / `grade` / `conf` / `clarity` | 页面展示的就是这一层。 |

11 个分项函数 `cCurtain / cLow / cGap / cPrecip / cWashed / cAod / cVis / cPm / cDew / cWind / cCape` 都返回 `[分数 0–100 或 null, 中文说明]`，null 表示缺数据（参与加权时排除，绝不编造）。

### 3.2 v2 霞分 `glow(comps)`

- **关键三项几何加权**：幕布 0.5 · 缺口 0.3 · 低云 0.2，`key = 100·exp(Σw·ln(s/100)/Σw)`。任何一项接近 0，霞分就接近 0。
- **空气调制**：降水 10、AOD 5、能见度 3、PM2.5 3、露点差 2、风 2、CAPE 2 的加权平均 `air`，`glow = key × (0.7 + 0.3·air/100)`。
- 雨后洗净 +0–5；霞时刻降水封顶 34（最高微烧）。
- **六档** `LEVELS`：≥80 大烧 · 65 中到大烧 · 50 小到中烧 · 35 小烧 · 20 微烧 · <20 无烧（`LEVEL_BOUNDS`）。
- **通透度** `clarityOf(aod, visM, pm, dewSpread)`：1–7 档（浑浊 → 极通透），和云况分开评、分开展示。
- 单模式置信度 `levelConf`：离最近档位边界 ≥6 高、≥3 中、否则低；缺数据最高为中。

### 3.3 多模式集合 `combine(members)`

- 每个成员 `{model, label, weight, res}`，霞分 = 加权平均（`best_match` 权重 3，其余 1；权重表在 api.js `MODEL_WEIGHT`）。
- 理由、分项、剖面沿用**最接近霞分的那个成员**，保证解释和数字一致（`repModel`）。
- 置信度看一致度：≥80% 成员在 ±1 档内且极差 ≤30 → 高；≥60% → 中；否则低。
- `ensemble = {n, good(霞分≥50 的成员数), near, spread, members[]}` 供界面显示「5 个预报模式中 3 个看好」。

## 4. 数据层（api.js）

- **一个地点 = 3 个请求**：
  1. `forecastURL`：best_match 全量逐小时变量 + 日出日落，3 天；
  2. `aqURL`：CAMS 空气质量（AOD、PM2.5…）；
  3. `ensembleURL`：**一次多点多模式请求**——本地点 + 朝霞方位 3 个上游点 + 晚霞方位 3 个上游点（50/150/300 km），4 个模式（best_match / ecmwf_ifs025 / gfs_seamless / icon_seamless）的四层云量。CMA 已于 10-21 移出（见 docs/compare-2026-10-21.md）。
- `scoreEvent`：每个模式把云量替换进主预报（按时间轴对齐 `memberHourly`），各跑一遍 `A.evaluate`，再 `A.combine`。多模式请求失败（重试 1 次）就退回单模式、无上游，置信度最高为中。
- 时间一律用真实 epoch 比较（`toEpoch` + `utc_offset_seconds`），不要用本地 `Date` 解析预报时间串。
- `evaluatePlace(lat, lon)` → 今朝 / 今晚 / 明朝 / 明晚四场；`evaluateNextSunset(city)` → 霞榜用的下一场晚霞；`loadRankings()` → 全球 36 城 + 中国 34 城，并发 6，输出 TOP 10 + 全部城市的六档计数 `stats`。
- Open-Meteo 免费层按「调用」计费：多点、超 10 个变量会折算成多次。一个地点约 16 次调用；霞榜全量约 700 次。

## 5. 界面层（app.js）与设计理念

### 5.1 设计理念

- **天空就是界面**：首屏不是卡片堆数据，而是一块被评分驱动的天空——云底光色、天空渐变、太阳、水面倒影都由 `palette(score)` 给出（按六档分四套配色）。用户先「看到」今晚大概什么样，再读数字。
- **结论先行，细节可查**：先给一句话结论（`verdictOf`：大烧 / 中到大烧 / 小到中烧 / 有一点·小烧 / 微烧 / 基本没有）+ 行动建议（值得专门去看 / 顺便看看 / 不用等了）+ 一句主因；置信度翻成白话并说清方向（「可能比这更好 / 更差」）。分项、模式分歧、原始输入放在 04 剖面里。
- **诚实**：缺数据写「无数据」并从加权中排除；时间轴上的霞强度曲线明确标注「示意」；模式分歧大就直说没把握。这是启发式预报，不假装是官方。
- **克制的动效**：云层是 SVG `feTurbulence` + `feDiffuseLighting` 的分形噪声，铺在 CSS 3D 透视平面上（rotateX(-48deg)，perspective 1200px）；太阳缓慢下沉、光束摆动、水面闪烁。`prefers-reduced-motion` 时停闪烁、放慢漂移。云滤镜重绘很贵，时间轴拖动时每走 4 分钟才重绘一次，更新用 rAF 合并。
- **视觉 token**（styles.css `:root`）：墨色 `--ink #0B0918`、奶油 `--cream #F4EDE4`、余烬 `--ember #FF5A1F`、金 `--gold #FFC36B`；字体 Noto Serif SC（标题）/ JetBrains Mono（数据）/ Instrument Serif（斜体点缀）。章节用「01 / 霞历」这类编号 kicker + 大号衬线 display。
- 原始设计稿：Design 画布 https://claude.ai/artifact/Cn81GyvCxCzEDwSJo4uLuD（含真实感云层与时间轴的探索）。

### 5.2 模块

| 区块 | 函数 | 要点 |
|---|---|---|
| 首屏 | `renderHero / paintHero / renderEmptyHero` | 首次访问不显示默认城市（留白，等定位或搜索）；显示霞分、六档、置信度、模式一致度 `modelsText`、通透度 |
| 01 霞历 | `renderEvents / selectEvent` | 四场并排，点哪场全页联动 |
| 02 天色 | `buildTimeline / updateTimeline / setT / bindScrub` | 选中场次前后 2.5 h；按真实太阳高度角 `sunElevation` 分 白昼 / 金色时刻 / 火烧云 / 蓝调 / 浅黑 / 黑；pointer 事件 + `touch-action: pan-y`，手机横滑拖动、竖滑滚页 |
| 03 霞榜 | `loadDailyBoard / loadBoard / renderBoard / summaryHTML` | 优先读服务器每日 `data/rankings.json`（要求 `version ≥ 2`，36 h 内有效）；拿不到才出「手动实时计算」按钮；世界/中国坐标带 + 此刻日落线 + 六档分布条 |
| 04 剖面 | `renderProfile` | 11 项按大气高度排层；列出各模式霞分、条件分、原始输入 |
| 定位 | `bindAutoLocate / locate / browserPosition / reverseGeocode` | 第一次点击页面定位一次；HTTPS 下用浏览器定位，失败退回 BigDataCloud IP 定位；用户手动选过地点后不再自动覆盖（place source：manual / geo / default） |
| 收藏、搜索 | `toggleFav / doSearch` | localStorage：`sg_favorites_v1`、`sg_last_place_v1`、`sg_rankings_v2` |

改动 localStorage 里存的数据结构时，**升级键名版本号**（如 `sg_rankings_v1 → v2`），避免读到旧格式。

## 6. 开发、测试、发布

```bash
python3 -m http.server 8765          # 本地预览 http://localhost:8765
node test/parity.js                  # 离线，必须 PASS
node test/search.js                  # 联网
node test/smoke.js                   # 联网，跑完整页面初始化
node scripts/build-rankings.js data/rankings.json   # 本地生成霞榜调试
node scripts/stamp-assets.js         # 改了 css/js 后、提交前必跑
```

- 分支流程：功能分支 → PR → 合并到 `main` → 部署。提交信息用中文。
- 改了 `algo.js` / `api.js` 必须同时更新服务器上霞榜脚本用的那两份副本，否则霞榜和页面算法不一致。
- 部署后验证：首页 css/js 版本号是新的；`/data/rankings.json` 是 `version 2`；首屏、霞榜在浏览器里能正常渲染。
- Open-Meteo 有每分钟限流（按访客 IP）。批量跑对比脚本后立刻测页面会遇到 429，等一分钟再测。
- 服务器地址、登录方式、目录、定时任务、备份位置等运维信息**不在公开仓库里**，见项目文件夹里的 `OPS.local.md`（本地文件，不入库）。

## 7. 已知问题与坑

- `cGap` 在上游总云 30% 处有跳变（predict.py 原样），v1 为了 parity 保留。
- 霞强度时间曲线是 `score × 以 −2° 为峰的高斯`，**示意**，不是物理模型。
- smoke / search 测试依赖网络和 Open-Meteo 的实时数据，偶尔因限流失败，重跑即可。
- 霞榜只有 70 座大城市，覆盖远不如对方的 493 个区县。
- 分档阈值、模式权重只用 1 天、39 点做过交叉对比，**没有用实况校准过**。

## 8. 建议的优化方向（按优先级）

1. **用实况校准（最重要）**：每天对照公众号「super朝霞晚霞预报」——它的「今日朝霞回顾」是实况，可以检验我们前一天的「明早」预报（流程见项目文件夹 `compare/README.md`）。把每天的预报快照和实况落成数据集，攒 2–4 周后调六档阈值、几何权重（0.5/0.3/0.2）、模式权重；写一个 `scripts/eval.js` 自动出 AUC / 命中率。长期可加「今天你看到霞了吗」用户反馈（需要一个极小的后端或表单）。
2. **服务器缓存代理**：在服务器上用 nginx `proxy_cache` 代理 Open-Meteo（按网格取整坐标、缓存 15–30 分钟）。国内访客直连 Open-Meteo 慢且会 429，代理能同时解决速度和额度。
3. **霞榜扩容 + 朝霞榜**：中国城市扩到区县级（几百点，服务器每天算一次，多点请求可以批量），加「明早朝霞榜」，按省份汇总，做一张全国热力格点图——对方最受欢迎的就是这种全国一图看懂。
4. **概率化**：接 Open-Meteo Ensemble API（ECMWF ENS 51 成员 / GFS ENS），把「多模式投票」升级成「烧起来的概率 xx%」，置信度更有依据。
5. **物理化时间曲线**：用云层高度（中云约 3–6 km、高云 6–12 km）和太阳俯角算云底被照亮的起止时刻，替换现在的示意高斯曲线，告诉用户「最红在日落后第几分钟」。
6. **工程**：GitHub Actions 跑 `parity` + `stamp-assets --check`；写一个部署脚本（服务器上 `git pull` 或 rsync + 版本校验）；把 smoke 测试改成可离线（录制 fixture）。
7. **表达**：分享卡片（生成一张带天空和结论的图）、订阅提醒（中到大烧以上推送）、微信小程序版本。

## 9. 协作约定（来自项目所有者）

- 服务器：不擅自改 SSH 配置、防火墙、安全组；不删除现有数据；系统级改动、删数据、安全配置变更前先说明方案并征得同意；控制资源占用（2 核 2 GB 级别机器）。
- 不把私钥、密码、令牌写进代码或公开仓库。
- 推送、开 PR、合并、部署都要先得到所有者明确同意。
- 沟通用中文。
