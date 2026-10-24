# 2026-10-25 · 全局审计修复 + 影子开关

前一天的审计（含本机 Claude Code 两轮审查意见）发现一批问题，本日集中修复。
分两类：**行为修复**（默认生效，恢复既有语义或纠正明确 bug）与**影子开关**（默认关，
改变分数分布、无标注数据不允直接打开，先用回放看效果再由所有者决定）。

## 一、行为修复（默认生效）

| # | 问题 | 修法 | 位置 |
|---|---|---|---|
| 1 | **降水「i+1 小时」修正只算未接线**：`precipV2` 算好了，但 `glow()` 的空气项和「霞时刻降水封顶 34」都还读旧小时——事件时刻真下雨照样报大烧（离线复现：92 分） | AIR_W 改 `precipV2`；封顶改读 `precipV2`；回归测试锁定「事件格有雨 → 34」 | `algo.js` glow()；`test/glow-v2-regress.js` |
| 2 | 雨洗窗口偏一小时：旧 `pre3` 取 i-1..i-3，按前一小时口径漏掉紧贴事件的小时 | 新增 `washedV2`（pre3V2 取 i,i-1,i-2，正好覆盖霞前 3 小时；「停没停」由 ip 格单独判断，同一小时的雨不重复计） | `algo.js` evaluate/glow |
| 3 | v2 理由与分数口径脱节（reasonsV2 还在引用 v1 幕布/降水/雨洗） | reasonsV2 全部换 v2 分项，幕布头条用 curtainV2 | `algo.js`；home.js 两处展示改用 reasonsV2 |
| 4 | **DST 跨界标签错 1 小时**（API 实测：Open-Meteo 的 `utc_offset_seconds` 是起报时刻固定偏移；欧洲 10-25、美国 11-01 正踩中。epoch 数学自洽，纯展示问题） | 新增 `tzParts()`（缓存 `Intl.DateTimeFormat` + `formatToParts`，`hourCycle:'h23'`，失败回落固定偏移），`fmtTime/fmtDate/viewingWindow` 增加 tzName 参数，三页 + 推送全量透传 | `api.js`、`glow.js`、home/city/board、`daily-push.js` |
| 5 | **上游点部分失败后距离权重错位**（filter 掉空点，`upDist[idxUp]` 整体错一位） | api.js 与 score-batch 都改为保留 null 占位（evaluate 本来就会跳过空点） | `api.js` scoreEvent、`scripts/lib/score-batch.js` |
| 6 | `memberHourly` 按字符串对齐，两张响应跨 DST 起报时会整列错位/落空 | 改按 epoch 对齐（各自响应的 offset 换算，最近邻 ±30 分钟） | `api.js` memberHourly |
| 7 | **榜单契约自相矛盾**：build 写 `models:null`（单模式回退不剔除），契约测试却要求非空，且测试在写盘之后才跑 | refine/refresh 拒收单模式回退（不入榜/不刷新）；契约校验抽成纯函数 `scripts/lib/validate-rankings.js`；**写盘前内存校验**，违约不落盘、退出码 3（额度用尽是 2）；落盘顺序固定先 all 后 rankings | `build-rankings-v3.js`、`test-rankings-schema.js`、`lib/validate-rankings.js` |
| 8 | 部署文档三处矛盾（crontab.txt / deploy README 把取数任务放在站点机，与 HANDOFF「迁算力机」相反；OPS.local.md 更旧） | 按 HANDOFF 重写 crontab.txt 与 README §七/§八：取数全在算力机（flock 串行、scp 原子替换），站点机无取数任务 | `deploy/` |
| 9 | 城市页 `initSearch` 重复绑定（每次输入触发两遍搜索） | 删除第二个 | `city.js` |
| 10 | 筛选「朝霞」后剖面/模式区仍显示晚霞那场；切换不重绘 | renderDeck/renderModels 与「这一天」卡片同口径，ctab 切换全量重绘 | `city.js` |
| 11 | `--from-rankings` 快照 `bearing:null` 被显示成 0° | 快照现场算方位角（`sunsetBearing`，零额度）；仍缺时前端显示 — | `build-snapshots.js`、home/city |
| 12 | 六档阈值/名称两份硬编码（glow.js band/GRADE vs algo.js LEVELS） | glow.js 全部委托 `levelOf`/`LEVELS` | `glow.js` |
| 13 | HANDOFF 上游距离写错（50/150/300/400，代码是 50/100/200/300/400 五点；粗筛三点） | 文档修正 | `docs/HANDOFF.md` §3.1 |
| 14 | 误入库的 `scripts/__pycache__` | 移出并加 .gitignore | `.gitignore` |

## 二、影子开关（代码就绪，默认关）

`SunsetAlgo.FLAGS = { gapV3: false, windowAlign: false }`（`algo.js` 顶部，一处开关）。
**无标注数据不调参**——这两个开关会改变分数分布，必须先看回放、由所有者决定：

- **gapV3（该做 #1）**：上游缺口改光路几何口径。太阳压到地平线下 α 度时，射向本地
  云底(高 8.6km / 中 5.2km)的光在距离 d 处离地 `z = h − d·tanα + d²/2R`；按
  α∈{1°,2°,2.9°}（照亮极限内）分阶段、每点挡光量按光线高度对云层的软隶属度
  （低云 0–3.5km、中云 3–6.5km，无硬阈值）、沿光路 `T = Π(1−cᵢ)^(Δdᵢ/L)`
  （去相关长度 L=200km）合成，再按幕布构成加权两条光路。
  旧口径 `1/(1+d/100)` 给近处最高权重，方向恰好相反。
- **windowAlign（该做 #2）**：所有模式成员的云量对齐到同一时刻（事件时刻）线性插值
  （`blendCloudAt`），去掉「只给综合模式在 [-30,-15,0,+15] 里挑最大值」的系统性加分
  （综合模式权重 3，占总权重一半）。粗筛同口径（score-batch 同步改）。

配套工具：
- `scripts/capture-replay.js --n 8 [--trim 2]`：采集原始预报/空气/集合数据落盘
  （`data/replay/`，gitignore；`--trim` 另存样例入库供离线复演）。
- `scripts/replay-gap.js [目录]`：离线对比四口径（A 旧 / B 时间对齐 / C 缺口几何 / D 两者）。
  首跑 6 城：B 平均 −0.5、C +1.7、D +0.2 分，方向符合预期、幅度温和。
  **正式打开前建议连续数天、≥30 城采样**（每天约 100 次调用）。

金标保障：`test/glow-v2-regress.js` 锁定「FLAGS 全关 + 干燥场景，v2 分数与改动前
逐位一致」（改动前基准值已固化在测试里），任何误伤 v2 路径的改动会立刻报警。

## 三、CI

`.github/workflows/ci.yml`：语法检查、parity、v2 回归、榜单契约（fixture）、
回放样例复演、资源版本号、Python 编译。全部离线，不耗 Open-Meteo 额度。

## 四、验证记录（本机，2026-10-25）

```
node test/parity.js                  PASS
node test/glow-v2-regress.js         31/31 PASS（金标/集合金标/B5/M1 反例/默认开关断言）
node scripts/test-rankings-schema.js test/fixtures/rankings.json   PASS
node scripts/replay-gap.js test/fixtures/replay                    OK（失败即 exit 1）
node scripts/stamp-assets.js         改 js 后已重新打号，--check OK
```

本地 `data/rankings.json` 仍是 10-24 两批不同时间的陈旧数据（契约不过属预期），
下次全量跑批后自然恢复；按约定未擅自跑全量。

## 五、第二轮审查修正（同日，Claude Code diff 审查意见）

第一轮实现经 Claude Code 逐行复审，又修了 8 处：

| # | 问题 | 修法 |
|---|---|---|
| M1 | 雨洗加成 `washedV2[0]===0` 是「判没洗」，但 0 是假值会走 else 回退 v1 的 +5，B2 修正等于没生效 | `var washedComp = comps.washedV2 || comps.washed;` 判空不判假；补反例测试（雨只在 i-3 格：v1 判 100、v2 判 0、分数=无雨对照） |
| M2 | 轻量刷新沿用全量 `stats`，而新加的写盘前校验要求每档 counts ≥ 榜内条数——某城刷新后升档会被整轮拦下不落盘 | 刷新时按差量调整：旧档 −1 / 新档 +1；`okN` 改按真正入榜数（全被拒时不写盘） |
| M3 | 金标测试先强制 FLAGS=false 再跑，抓不到「默认开关被打开」 | 测试开头断言默认值全关 |
| S1 | cGap3 中云隶属度只设上界，光线从中云底下方穿过也被当全挡 | 改梯形（z≤2km 为 0，2–3km 过渡） |
| S2 | 粗筛 3 点与精算 5 点的光路代表总长不同（325 vs 425km），同样云况粗筛透射偏乐观 | spans 归一到固定 450km |
| S3 | 首页「闸门」和剖面在开关切换后展示的分项与实际计算脱节 | renderGates / renderProfile 与 glow() 同规则回落 gapV2 |
| S4 | tzName 漏传多处（移动端事实条 / aria / 城市页徽标 / 推送最佳观赏与七日表） | 全部补齐 |
| S5 | 被拒收的单模式条目还参与卫星城合并，会把邻城一起挤掉 | 先 `.filter(!coarseOnly)` 再 `mergeSatellites` |
| S6 | crontab 三把锁互不串行，README「串行」名不副实 | 共用 `/tmp/glow-om.lock`（全量 -n、刷新/快照 -w 600） |
| S7 | 集合路径（scoreEvent）无金标、回放脚本吞错 exit 0、B5 无测试、回滚断言太弱 | 回放样例锁进集合金标；replay-gap 失败 exit 1；B5 权重错位用例；回滚断言改为「开≠关、关=金标」 |
| S8 | memberHourly 每变量重复 O(n²) 对齐 | 下标映射只算一遍，去掉死代码 |

小项：tzParts `hour % 24` 兜底（个别引擎忽略 hourCycle 会输出 24 点）、
快照方位角用 `isFinite` 显式判、HANDOFF §4.5 位置与「该做 #4 已完成」标记、回放表头对齐。
