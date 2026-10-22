# 算法升级版 PRO — 2026-10-23 总结

> 从 v2（霞分几何门控）升级到 **v2.2（霞分 + 物理受光 + 光谱 + 概率标定）**，
> 并接入集合预报、真值管道、外部开源项目 Skyglow 的物理模型。
> 线上已同步（glow.nybbq.art + 每日推送）。

---

## 一、今天升级了什么（v2 → v2.2）

| 模块 | v2（升级前） | v2.2（升级后） | 来源 |
|---|---|---|---|
| 幕布 | 中高云量 `cCurtain(mid, high)` 纯云量 | 加「受光亮度」因子：高云(8.6km)比中云(5.2km)光路更干净更亮，AOD 越高越暗 | Skyglow spectrum.py |
| 概率 | 无，只有 0–100 分 | `scoreToProb`：sigmoid 标定，分数→历史烧率 | Skyglow 标定层 |
| 颜色 | 无 | 光谱积分→RGB→金黄/橘黄/橘红/绯红/玫瑰红 | Skyglow spectrum.py |
| 最红时刻 | 只有金色/蓝调时刻 | 云底受光几何：高云受光到太阳 −3° | Skyglow solar.py |
| 集合 | 4 模式加权平均 | ECMWF ENS 51 成员逐点跑 v2 → 概率分布 | Open-Meteo Ensemble |

## 二、Skyglow（couletian/Skyglow）研究结论

它是一个比我们更完整、且有真实标定的项目，值得吸收四点：

1. **光谱模型**：瑞利 τ∝λ^-4.1 + 米 τ∝λ^-1.3（AOD），61 波长 400–700nm 积分出亮度 + sRGB。
   直接回答「什么颜色」，我们原来没有这一层。
2. **云底受光几何**：`illumination_limit = -deg(√(2h/R))`，云底越高日落后亮得越久
   （高云 8.6km → −2.9°、中云 5.2km → −2.3°、低云 → ~0°）。
3. **概率标定层**：7 个 log-odds 物理特征 → 岭回归/MLP → sigmoid → 概率。
   在上海 1109 条 sunsetbot 标签上 test AUC 0.79、Brier 0.17、±1 档命中 0.83。
4. **它有留出测试集**（data/validation.json + nn_metrics.json），是可证伪的，不是拍脑袋。

## 三、本轮移植进打分系统的物理（已上线）

### 1. 幕布受光亮度（algo.js `curtainLight`）
- 只影响 v2 霞分，不动 v1 条件分（`parity.js` 仍 PASS）。
- 原理：同一云量下，高云为主比中云为主亮 → 乘 0.75–1.0 亮度因子。
- 实现：`comps.curtainV2 = curtain × (0.75 + 0.25 × lightNorm)`，lightNorm 由
  `deckLum(高云) / deckLum(中云)` 归一化，AOD 越高越暗。

### 2. 概率标定（algo.js `scoreToProb`）
- `P = sigmoid(0.0375 × (score − 77.9))`。
- 锚定 Skyglow 拟合的等级概率档位：小到中烧(50)→26%、中到大烧(65)→38%、大烧(80)→52%。
- 基准烧率 ~17%（与 Skyglow 实测一致）。
- 推送里显示「标定概率：X%（历史同类分数烧率）」，与「集合预报 P(小烧以上)」区分
  （前者是历史校准，后者是今日天气情景的不确定性）。

### 3. 光谱颜色 + 最红时刻（daily-push.js）
- 完整移植 `deckLight`：CIE 1931（Wyman 2013 拟合）+ 61 波长积分 → 亮度 + sRGB。
- `colorNameRgb` 按 Skyglow 的阈值给颜色名。
- 用 `findAltTime` 二分求太阳到 −1°（峰值）与高云受光极限 −3° 的时刻 → 「最红窗口」。

## 四、两个重要实测修正（避免被误导）

1. **「122 成员」不成立**：Open-Meteo Ensemble API 只有 ECMWF IFS ENS 提供逐成员分层云量
   （51 成员）；GFS ENS(31) / ICON EPS(40) 的 `cloud_cover_low/mid/high_memberXX` 全是 null
   （只有总云量有值），且是 3 小时步长。集合概率目前只接 ECMWF 51 成员。
2. **METAR 漏报高云**：高云真值 r=0.30 不可信；低云 r=0.81 可用。

## 五、真值 / 校准管道（已建，等数据）

- `scripts/eval.py`：云量 MAE/偏差/r + 霞分命中率/AUC（标注 ≥10 条才硬算）。
- `scripts/verify_vs_metar.py`：19 城 ICAO，预报 vs METAR 实测。
- `scripts/obs_himawari.py`：NASA GIBS 定性云判别。
- `scripts/daily_snapshot.py`：每天 23:55 写 JSONL 快照（cron f73cf20cd672）。
- `scripts/label.py`：人工拍照标注。
- **下一步**：攒到 50+ 标签后，照 Skyglow 的岭回归结构 fit 我们自己的系数
  （当前 scoreToProb 是先验参数，fit 后替换），目标 AUC 0.7+。

## 六、部署状态（2026-10-23）

- 线上：algo.js?v=f44d43ac、api.js?v=296f3466 已更新。
- 霞榜脚本副本与站点 md5 一致；霞榜已用新算法重算（全球 10 / 中国 10，63.5s）。
- nybbq.art 302、passport.nybbq.art 200，未受影响。
- 备份：/var/www/glow.bak-20261023-*、~/glow-rankings-bak-20261023-*。

## 七、下一步（按收益排序）

1. **fit 自己的标定系数**（P0）：标签 50+ 后替换 scoreToProb 的先验参数。
2. **气压层湿度「薄卷云 vs 厚灰盖」**（P1）：已做诊断（RH300 能区分，但每天仅 2–3 城
   落在极端桶），等标签确认后接进幕布项。
3. **临近订正**（P1）：晚霞日 15:30/16:45 拉 Himawari 核查上游缺口。
4. **模式技能滚动权重**（P2）：30 天滚动评估各模式真实技能，动态调权。
