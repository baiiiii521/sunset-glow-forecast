# 交接文档 · 霞（全球火烧云预报）

> 写给接手继续优化的人 / agent。读完这一份就能上手：项目是什么、代码怎么分层、为什么这样设计、怎么验证、什么不能碰、下一步该做什么。
> 最后更新：**2026-10-24**，线上是 **v2**（三页），算法为**霞分 v2.3**。
> 线上：<https://glow.byb521.com/>（`/` 就是 v2，`/v2/` 是同一份内容）

---

## 1. 一句话

给任意地点预报**朝霞 / 晚霞**强度：0–100 分、6 档、四场（今早 / 今晚 / 明早 / 明晚）、七日、天色时间轴、大气剖面，外加一张「今天（或明天）哪里最可能烧」的霞榜。

纯静态站：没有后端、没有数据库、没有构建步骤。评分在浏览器里由 `algo.js` 完成，数据直连 Open-Meteo。

## 2. 目录与分层

```text
v2/                       线上版本（发布目录）
  index.html              今晚：四场 / 天幕 / 时间轴 / 剖面 / 七日 / 霞榜预告
  city.html               城市：七天矩阵 / 三层云剖面 / 四模式分数 / 榜单名次
  board.html              霞榜：世界图 + 中国图 / 双榜 / 六档分布 / 检索
  assets/css/             tokens / base / p01 / city / board / mobile / fonts
  assets/js/              glow(共享) / home / city / board / forecast(取数)
  assets/img/             world.svg / china.svg / sky/(6 档 × 朝晚，共 12 张)
  assets/fonts/           Noto Serif SC 子集 + JetBrains Mono

algo.js                   算法层 SunsetAlgo：纯函数，浏览器与 Node 共用，不碰网络
api.js                    数据层 SunsetAPI：Open-Meteo 请求、单点打分、批量取数，不碰 DOM
scripts/                  离线任务（榜单 / 快照 / 地图 / 字体 / 测试 / 推送）
deploy/                   nginx 缓存代理、crontab、双机说明
docs/                     设计参考图、复审记录、变更记录、交接文档
data/                     运行时数据，**gitignore，不入库**
```

依赖方向只有一条：`页面 js → glow.js → api.js → algo.js`。

## 3. 数据流（三条独立路径）

### 3.1 访客实时（每次评估 3 个请求）

1. **预报**：本地点 + 沿日出 / 日落方位角 50/100/200/300/400 km 共 5 个上游点（粗筛只取 50/150/300 三个省额度）；
2. **空气质量**：CAMS 的 AOD、PM2.5；
3. **集合预报**：ECMWF IFS ENS，用于模式一致度。

取数顺序是**直连优先**：先打 `api.open-meteo.com`（8 秒超时），429 或超时才回落 `window.GLOW_OM_BASE`（`/om/` 代理），并设 60 秒熔断窗口；代理失败会清窗口回头再试直连。

### 3.2 离线霞榜（`scripts/build-rankings-v3.js`）

两段式：

1. **粗筛**：30 个世界精选城市 + 约 500 个中国城市，跳过空气质量、只用单模式；
2. **精算**：对粗筛头部按 `--head-mult`（默认 3）放量的城市跑完整链路；
3. **出榜**：取前 N（`--top`，默认 60）写 `data/rankings.json`，全量写 `rankings-all.json`。

放量 ×3 有实测依据：`scripts/measure-coarse-recall.js` 抽样回放显示，粗筛只取「和名额一样多」时，
前 5 名只覆盖精算真实前 5 的 60%、前 10 覆盖 80%。**粗筛是过滤器，不是排名，必须留余量。**

`--refresh N` 只重算在榜城市；未重算到的条目标 `stale`，payload 带 `refresh {ok, total, at, partial}`，
页面写明「前 N 名刚重算，其余 M 条沿用 X 时全量」。

### 3.3 每小时快照（`scripts/build-snapshots.js`）

20 城，写 `data/snapshots.json`，用于首屏秒开与 429 兜底。

### 3.4 机器分工

| 机器 | 职责 | 定时 |
|---|---|---|
| **算力机**（额度独立） | **所有** Open-Meteo 取数、算榜、算快照；直连 429 时自动切华为云 relay 出口 | 04:00 全量 · 15:00 轻量刷新 · 每小时 :07 快照 |
| **华为云**（替补） | ① 备用取数出口（relay，算力机限额时流量走它的 IP）；② 看门狗：主站榜单 >26h / 快照 >3h 未更新时在本机补算直推（防算力机整机宕机） | 每 30 分钟自检 |
| **站点机** | 只发静态文件 + `/om/` 反向代理 | 无 |

站点机 IP 跑榜单会被限流（实测「轻量刷新全部失败」），所以取数全在算力机，跑完 `scp` 到站点机。
服务器地址、密钥、部署命令**不在仓库**，见仓库上一级的 `OPS.local.md`。

## 4. 算法现状（`algo.js`，霞分 v2.3）

### 4.1 两层分数，别搞混

| 层 | 字段 | 说明 |
|---|---|---|
| v1 条件分 | `condScore / condGrade / condConf` | 11 项加权平均，**与 Python `predict.py` 逐位一致**，`test/parity.js` 守着它。**不许改行为。** |
| v2 霞分 | `score / level / grade / conf / clarity` | 页面和榜单用的就是这一层。 |

11 个分项函数（`cCurtain / cLow / cGap / cPrecip / cWashed / cAod / cVis / cPm / cDew / cWind / cCape`）
都返回 `[分数 0–100 或 null, 中文说明]`；`null` = 缺数据，参与加权时排除，绝不编造。

### 4.2 v2 公式

```text
key  = 幕布^0.50 × 缺口^0.30 × 低云^0.20          # 加权几何平均
air  = 降水 / AOD / 能见度 / PM2.5 / 露点差 / 风 / CAPE 的加权平均
霞分 = key × (0.7 + 0.3 × air/100) + 雨后洗净（0–5）
```

约束：

- 霞时刻有降水 → 封顶 34（最高微烧）；
- 关键项缺数据 → 封顶 34（**不拿未知当利好**）；
- 关键项 `<10` 时按 `s/10` 线性衰减（消除 99%→100% 的断崖）。

### 4.3 2026-10-24 改过的四处（**不要改回去**）

| 改动 | 原因 |
|---|---|
| 幕布改随机重叠合成 `1−(1−m)(1−h)`（`cCurtainV2`） | 中云 + 高云直接相加会把重叠算两遍：60% + 40% 被当成 100%，再按「太厚」罚到 70 分 |
| 关键项 0 点改线性斜坡 | 原来 99% → 37 分、100% → 0 分，37 分断崖 |
| 降水取「覆盖事件的那一小时」（i+1） | Open-Meteo 的 `precipitation` 是**前一小时**累计，17:44 的日落取到的是 16–17 点 |
| 置信度按**权重**算，并与「把握」分开展示 | 分数按权重（best_match ×3）加权，一致度却按成员个数算，会出现「分数被高权重模式拉走、把握却显示高」 |

另外：等级必须由**四舍五入后的展示分数**决定（曾出现 64.6 显示成 65 却标「小到中烧」）。

### 4.4 六档

`≥80 大烧 · ≥65 中到大烧 · ≥50 小到中烧 · ≥35 小烧 · ≥20 微烧 · 其余 无烧`

**这四个切点没有标定过**，是等距手拍值。

### 4.5 2026-10-25 补充（详见 docs/changelog-2026-10-25.md）

- **降水接线**：v2 空气项与封顶已改用 `precipV2`（覆盖事件那一格）；雨洗加成用 `washedV2`
  （霞前 3 小时窗口 i,i-1,i-2，判 0 时不回退 v1 加成）。v1 字段未动。
- **影子开关 `SunsetAlgo.FLAGS`：2026-10-25 所有者确认全部打开**（gapV3 + windowAlign，
  新口径正式生效）。旧口径每天由 `capture-replay.js` + `replay-gap.js` 在算力机并行对比
  （logs/replay.log），回滚只需把 FLAGS 改回 false。
  金标测试（`test/glow-v2-regress.js`）保证：默认值与所有者决定不符会 FAIL；
  全关时 evaluate 层（干燥场景）与 scoreEvent 层（入库回放样例）的分数都与
  2026-10-24 版逐位一致（回滚能力）。
- 展示层时间已按时区名（`tzParts`）换算，跨夏令时的预报窗口不再差 1 小时；epoch 数学未动。
- 榜单 build 写盘前过契约校验（`scripts/lib/validate-rankings.js`），违约不落盘、退出码 3
  （额度用尽 2）；单模式回退不再入榜；轻量刷新的分档计数按差量调整。

## 5. 现在该做什么 / 绝对不要做什么

### 该做（按价值排序）

1. **上游缺口的几何权重**：代码已就绪——`cGap3`（`algo.js`，FLAGS.gapV3 影子输出，默认关）：
   按 α∈{1°,2°,2.9°} 光路高度 + 云层软隶属度 + 去相关连乘（L=200km）。旧 `1/(1+d/100)`
   近处权重最高、方向相反的问题已在影子实现里纠正。**打开前连续数天跑
   `capture-replay.js` ≥30 城，用 `replay-gap.js` 看四口径对比**（首跑 6 城：几何口径平均 +1.7 分）。
2. **时间窗口取物理峰值**：代码已就绪——`FLAGS.windowAlign`（默认关）：所有成员对齐到
   事件时刻线性插值，去掉综合模式挑最大值的加分。回放口径见同一脚本
   （首跑 6 城：对齐口径平均 −0.5 分，符合「去掉系统性偏高」的预期）。
3. **幂平均 vs 几何平均**：几何平均对单项太宽容（低云 85% 仍可给 60 分）。是否换 p≈−1~−2 需数据支撑。
4. ~~**CI**：`parity` + `test-rankings-schema` + `stamp-assets --check` 可以挂进 GitHub Actions。~~ 已完成（`.github/workflows/ci.yml`，2026-10-25）。
5. **概率分布**：4 个确定性模式 + 51 个 ENS 成员的超阈值占比，再做可靠性标定；现在 `scoreToProb` 是把别人的刻度硬套过来，未验证。（推送端已接 ECMWF ENS 51 成员，见 `scripts/daily-push.js` 的集合分布段；网页端与标定仍未做。）

### 绝对不要做

- ❌ 改 `condScore` 的计算路径（parity 会挂；v1 是历史对照基准）
- ❌ **没有标注数据就调权重 / 调切点**：`data/glow-labels.jsonl` 只有 **1 条**。按自然频率估算，标定「大烧」这一档约需 250 条标注。现在调参 = 过拟合一条样本。
- ❌ 把 `data/` 提交进仓库；把服务器地址 / 密钥写进仓库（**公开仓库**）
- ❌ 直接部署、推 `main`、开 PR —— 改动先本地验证，由所有者决定
- ❌ 拿「和某公众号 / 竞品吻合」当准确率证据 —— 吻合只说明更像，不说明更准

## 6. 验证（改完必须跑）

```bash
node test/parity.js                      # 必须 PASS（v1 条件分 JS vs Python）
node test/glow-v2-regress.js             # 必须 PASS（v2 金标 / 降水封顶 / cGap3 / 插值 / DST 展示）
node scripts/test-rankings-schema.js     # 榜单契约：字段 / grade-level-score 自洽 / 排序 / 坐标重复 / rankings-all
node scripts/test-rankings-schema.js test/fixtures/rankings.json   # 本地 data 陈旧时用入库样例
node scripts/stamp-assets.js --check     # v2 三页资源版本号是否过期
node scripts/stamp-assets.js             # 改过 css/js 后必须重新打版本号
node scripts/capture-replay.js --n 8     # 采集回放数据（联网，约 24 次调用）
node scripts/replay-gap.js               # 离线对比新旧口径（打开 FLAGS 前必看）
node scripts/measure-coarse-recall.js --scope china --n 60 --k 5,10,20   # 粗筛召回率（联网，约 2 分钟）
node test/search.js / node test/smoke.js # 联网
```

页面自测：`cd v2 && python3 -m http.server 8000`，检查三页、空态、搜索（中文/拼音/英文）、切城市、
七日联动、霞榜全球/中国切换、移动端 390×844（底部 tabbar、矩阵横滚、无横向溢出）。

## 7. 坑（都踩过）

| 现象 | 原因 / 处理 |
|---|---|
| 整轮榜单全是 429 | 额度按 IP 算，日/小时都有上限。脚本开头有预检，429 会直接 `exit 2`。别在额度耗尽时反复重跑 |
| `window.API` undefined | 全局实际叫 `window.SunsetAPI`（算法是 `SunsetAlgo`） |
| 改了 js 页面没变 | 资源带 `?v=hash`，必须跑 `stamp-assets.js` |
| `<svg>` 的 `el.hidden=false` 无效 | SVG 没有 hidden IDL 属性，要用 `removeAttribute('hidden')` |
| 站点机 SSH 22 端口拒绝 | fail2ban 封了。从算力机执行 `fail2ban-client set sshd unbanip <IP>` |
| 服务器 `git clone github.com` 失败 | 走 `gh-proxy.com` 的 tarball，别直连 |
| 时区 | 站点机 UTC+7、算力机 UTC+8、所有者常驻 UTC+7；cron 用主机本地时间 |
| `tar` 解包报 `._v2` 权限错 | macOS 的扩展属性，加 `--no-xattrs` 或忽略 |

## 8. 汇报格式（所有者要求）

- 每条结论必须带**文件:行号**或**可复现步骤**；不要写「建议加测试」这类空话
- 区分「已核实」与「需要验证」，并写清怎么验证
- 不要复述已知的改动清单，只报告其中的问题
- 中文沟通

## 9. 协作约定（来自所有者）

- 服务器：不擅自改 SSH / 防火墙 / 安全组；不删现有数据；系统级改动、删数据前先说方案
- 不把私钥、密码、令牌写进代码或公开仓库
- 推送、开 PR、合并、部署都要先得到所有者明确同意
- 沟通用中文
