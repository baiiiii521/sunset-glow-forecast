# Codex CLI 复审（2026-10-24 22:30）

范围：v2 前端 / algo.js / api.js / scripts / deploy。只读审查，83k tokens。

## 结论速览

| # | codex 提出 | 我的核实 | 处理 |
|---|---|---|---|
| 1 | 关键项为 0 仍产生非零分；缺数据被跳过反而抬分 | 属实，已复现：幕布=0 → 7.9 分，幕布缺失 → 34 分（缺数据比坏数据分还高） | 已修 |
| 2 | 缺云量字段默认 0，被当成晴空 | 属实（`hv(...,0)` → 低云缺失 = 无墙 = 利好） | 已修 |
| 3 | 轻量刷新新旧分数混排、时间语义错 | 属实，且比 codex 说的更严重：56 条里只有 30 条重算，26 条是旧分 | 已修 |
| 4 | 四场固定用 days[0]/days[1] 当今天/明天 | 理论风险，Open-Meteo 用 timezone=auto 时通常成立；跨零点会错 | 已加固 |
| 5 | 缓存键 lat.toFixed(2) 会合并相邻地点 | 不成立：0.05° 网格下 toFixed(2) 更细，只会重复请求，不会串数据 | 不改 |
| 6 | 极端纬度方位角被钳制 | 属实但影响面小（极昼极夜场次本身会被跳过） | 记入待办 |
| 7 | 置信度按模型个数算，分数按 best_match 加权 | 属实，是口径不一致 | 记入待办 |
| 8 | 契约测试覆盖不足 | 属实（没校验 grade 与 level 匹配、没校验 rankings-all.json） | 记入待办 |

## 已落地的修改

### 1. algo.js `glow()`：关键项为 0 硬归零，缺数据不再当利好

```js
if (s <= 0) keyZero = true;              // 任一关键项为 0 → key = 0
if (s == null) { keyMissing = true; }    // 缺数据单独标记
...
if (keyMissing) g = Math.min(g, 34);     // 缺关键数据最多「微烧」，不推荐出门
comps.__incomplete = keyMissing;
```

实测（同一组空气项）：

| 输入 | 修前 | 修后 |
|---|---|---|
| 幕布 0 / 缺口 100 / 低云 100 | 7.9 | 0.0 |
| 幕布缺失 / 缺口 100 / 低云 100 | 34.0 | 34.0（且标 incomplete） |
| 低云缺失 / 幕布 100 / 缺口 100 | 34.0 | 34.0（且标 incomplete） |
| 三项都好 | 84.9 | 84.9（不变） |

### 2. algo.js `evaluate()`：缺云量与「真的晴」分开

```js
var midRaw = hv(h, 'cloud_cover_mid', i, null);   // 原来默认 0
var cloudMissing = (midRaw == null || highRaw == null || lowRaw == null);
var mid = cloudMissing ? 0 : midRaw;
...
curtain: cloudMissing ? [null, '缺云量数据'] : cCurtain(mid, high),
low:     cloudMissing ? [null, '缺云量数据'] : cLow(low),
gapV2:   cloudMissing ? [null, '缺云量数据'] : cGap2(upLowAvg, upMidAvg),
```

`inputs.mid/high/low` 保持原值，不影响剖面展示与 v1 condScore（parity 测试仍通过）。

### 3. build-rankings-v3.js：刷新不再把新旧分数混成一份

- 没重算到的条目加 `stale: true`
- payload 增 `refresh: {ok, total, at, partial}`
- 页面时间口径：显示 `refreshedAt`，并加副行「前 N 名刚重算，其余 M 条沿用 X 时全量」

实测：`刷新 10-24 22:44` / `前 30 名刚重算，其余 26 条沿用 10-24 21:15`。

### 4. forecast.js `fourEvents()`：按地点本地日期找今天/明天

原来无条件取 `days[0]`/`days[1]`，现在用 `zonedParts(Date.now(), offsetSec).dateStr` 比对 `d.date`，
找不到就退化成前两个可用日，但 day 标签仍按真实日期。

## 待办（未做，按价值排序）

1. **置信度口径**（algo.js:548-559）：分数按 best_match 权重 3 加权，`near/n` 与 conf 按成员个数算。
   建议输出「加权一致度」并单独展示，别把两个口径混成一个「把握」。
2. **极端纬度方位角**（algo.js:61-70）：极昼/极夜时 `cosA` 被钳制仍算出方位，
   应先判断该日是否存在日出/日落，不存在就不生成上游方位与评分。
3. **契约测试补强**（scripts/test-rankings-schema.js）：加 grade↔level↔score 一致性、
   城市坐标重复、stats 总数与参评集合一致、以及 rankings-all.json。
4. **粗筛与精算可比性**（scripts/lib/score-batch.js）：粗筛不取空气质量、不用 15 分钟窗口，
   头部候选漏选会直接漏掉城市。可用历史样本回放，量一下粗排前 K 对精算真实前 K 的覆盖率。
