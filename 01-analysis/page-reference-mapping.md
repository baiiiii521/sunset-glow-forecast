# 参考图 ↔ 页面 ↔ 文档 映射（page-reference-mapping）

> 用途：开发时「照哪张图写哪段代码」的唯一索引。
> 代码落点以 `09-codex-handoff.md §3 组件映射` 为准。

---

## 1. 图片 → 页面 / Section / 组件 / 文档

### P01 · 今晚 `/`

| 参考图 | Section | 锚点 | 组件 | 规格文档 | 素材 |
|---|---|---|---|---|---|
| `p01-01_masthead.png` | 01-01 | `header.mast` | `shell/Masthead` | 06 §01-01 · 05 §4.1 | — |
| `p01-02_hero-verdict.png` | 01-02 | `#top` | `Sky Plate` + `data/ScoreBlock` | 06 §01-02 · 10 天幕系统 | `sky-dusk-L4.jpg` |
| `p01-03_forecast-rail.png` | 01-03 | `#rail` | `ForecastRail` | 06 §01-03 | — |
| `p01-04_sky-timeline.png` | 01-04 | `#timeline` | `sky/Timeline` | 06 §01-04 | — |
| `p01-05_atmosphere-profile.png` | 01-05 | `#profile` | `data/FactorRow` | 06 §01-05 | — |
| `p01-06_board-teaser.png` | 01-06 | `#board` | `BoardTeaser` | 06 §01-06 | — |
| `p01-07_algorithm-brief.png` | 01-07 | `#brief` | `brief/AlgorithmBrief` | 06 §01-07 | — |
| `p01-08_footer.png` | 01-08 | `footer` | `Footer` | 06 §01-08 | — |

### P02 · 城市 `/c/:slug`

| 参考图 | Section | 组件 | 规格 | 素材 |
|---|---|---|---|---|
| `p02-01_city-header.png` | 02-01 | `CityHeader` + `VerdictRail` | 06 §02-01 | `sky-*`（该城市档位） |
| `p02-02_seven-day-matrix.png` | 02-02 | `SevenDayMatrix` | 06 §02-02 | — |
| `p02-03_cloud-deck.png` | 02-03 | `sky/CloudDeck` | 06 §02-03 | — |
| `p02-04_model-consensus.png` | 02-04 | `data/Consensus` | 06 §02-04 | — |
| `p02-05_sunset-sequence.png` | 02-05 | `data/Sequence` | 06 §02-05 | — |

### P03 · 霞榜 `/board`

| 参考图 | Section | 组件 | 规格 | 素材 |
|---|---|---|---|---|
| `p03-01_board-header.png` | 03-01 | `BoardHeader` | 06 §03-01 | — |
| `p03-02_map-ranking.png` | 03-02 | `board/WorldMap` + `Ranking` | 06 §03-02 | 合规地图（矢量） |
| `p03-03_dual-board.png` | 03-03 | `DualBoard` | 06 §03-03 | 同上 |
| `p03-04_distribution.png` | 03-04 | `Distribution` | 06 §03-04 | — |
| `p03-05_city-inspector.png` | 03-05 | `Inspector`（抽屉） | 06 §03-05 | — |

### 天幕分级

| 参考图 | 用途 | 文档 |
|---|---|---|
| `sky/dusk-L0…L5.png` | 晚霞六档首屏态 | `10-sky-system.md` |
| `sky/dawn-L0…L5.png` | 朝霞六档首屏态 | 同上 |
| `sky/00_天幕分级总览.png` | 评审用拼版 | — |

---

## 2. 反向映射：Section → 图 → 数据

| Section | 数据来源 | 关键字段 |
|---|---|---|
| 01-02 | `algo.evaluate()` | `score/grade/conf/bearing/peakOffsetMin` |
| 01-03 | `daily-push.js` 四场 | `days[0..1].{sunrise,sunset}.score` |
| 01-04 | 时间曲线 | `sunsetEpoch ± 150min` |
| 01-05 | `comps/inputs` | 11 项 + 权重 |
| 01-07 | 静态 + `LEVELS` | 权重 0.5/0.3/0.2 |
| 02-02 | 7 天 | `days[0..6]` |
| 02-04 | `ensemble.members` `ensemble51` | P10/P50/P90 |
| 03-02/03 | `data/rankings.json` | `china/global/stats` |

---

## 3. 缺口清单（开发前需补）

| # | 缺什么 | 影响 | 归属 |
|---|---|---|---|
| 1 | 移动端参考图（390×844 × 3 页关键屏） | 移动端无验收标准 | Hermes 出图 |
| 2 | 天幕底图生产规格（2400×1350 / WebP） | 2x 屏清晰度 | Codex CLI 重出/升采样 |
| 3 | 合规模板地图（审图号） | 上线合规 | 采购/官方数据 |
| 4 | 交互态参考（hover / drag / drawer 中间帧） | 动效无基准 | 以 05 规范为准，不补图 |
| 5 | OG 分享卡模板 | 传播 | Canvas 生成，不需 AI 图 |

---

## 4. 使用规则

1. **一张图 = 一个 Section**，不得跨 Section 复用参考图。
2. 开发完成一个 Section，立即用它对应的图做像素对比（见 `08-quality-assurance`）。
3. 若参考图与 `06-page-specs.md` 冲突，**以参考图为准**，并回写文档。
