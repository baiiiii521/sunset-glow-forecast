# 给 AI agent 的入口

**开工前先完整读 `docs/HANDOFF.md`**（架构 / 数据流 / 算法现状 / 该做什么 / 不能碰什么 / 验证命令 / 坑）。
运维信息（服务器地址、密钥、部署）不在仓库里：看仓库上一级目录的 `OPS.local.md`。

## 硬性约定

- 用中文沟通；结论要带 `文件:行号` 或可复现步骤。
- **不改 v1 条件分 `condScore` 的计算路径**：`node test/parity.js` 必须 PASS。算法改动放在 v2 层。
- **没有标注数据不要调权重、不要调六档切点**：`data/glow-labels.jsonl` 只有 1 条标注。
- **`SunsetAlgo.FLAGS` 影子开关默认全关**（gapV3 / windowAlign）：打开会改分数分布，
  必须先跑 `node scripts/replay-gap.js` 给所有者看对比，得到同意才能改默认值。
- 改了 css / js 之后，提交前跑 `node scripts/stamp-assets.js`。
- 改了 `algo.js` / `api.js` 之后，跑 `node test/parity.js`、`node test/glow-v2-regress.js` 与 `node scripts/test-rankings-schema.js test/fixtures/rankings.json`。
- 不把 `data/`、服务器地址、私钥、密码写进仓库（这是公开仓库）。
- 不推 `main`、不开 PR、不部署：改完把结论和 diff 说明交回，由所有者决定。

## 已经修过的（别重复报告）

- 幕布把中云 + 高云直接相加 → 已改随机重叠合成 `1−(1−m)(1−h)`
- 关键项 0 点的 37 分断崖 → 已改线性斜坡
- 降水取错小时（Open-Meteo 是「前一小时」口径） → 已对齐到事件那一格
- 置信度按个数算而分数按权重算 → 已统一为按权重，并与「把握」分开展示
- 等级按未取整分数算（64.6 显示 65 却标低一档） → 已改为按展示分数
- 缺云量被当晴空 → 已改为 `null` 退出加权 + 缺关键数据封顶 34
- 榜单写死 10 条、粗筛零余量 → 已跟 `--top` 走 + 粗筛放量 ×3
- 中国榜英文城市名、世界城市表里的日文写法 → 已清洗

2026-10-25 批次（详见 `docs/changelog-2026-10-25.md`）：

- 降水「事件那一格」修正没接进霞分（空气项和封顶仍读旧小时） → 已接线 `precipV2`
- 雨洗窗口偏一小时 → 已加 `washedV2`（i,i-1,i-2）
- 跨夏令时的时间标签差 1 小时 → 展示层改 `tzParts` 按时区名换算
- 上游点缺数据被 filter 后距离权重错位 → 已改 null 占位
- 榜单契约矛盾（models:null）+ 测试在写盘后 → 单模式拒收 + 写盘前内存校验（退出码 3）
- 部署文档与 HANDOFF 分工矛盾 → crontab.txt / deploy README 已按算力机口径重写
- 城市页 initSearch 重复绑定、朝/晚筛选不联动、快照方位角 0°、六档阈值双份定义 → 均已修
- 该做 #1/#2 已实现为影子开关（默认关），配套 capture/replay 回放脚本

详见 `docs/changelog-2026-10-24.md`、`docs/changelog-2026-10-25.md`、
`docs/algo-review-2026-10-24.md`、`docs/architecture-review-2026-10-24-codex.md`。

## 验证命令

```bash
node test/parity.js                    # 必须 PASS
node test/glow-v2-regress.js           # v2 金标回归，必须 PASS
node scripts/test-rankings-schema.js test/fixtures/rankings.json   # 榜单契约（入库样例）
node scripts/stamp-assets.js --check   # 资源版本号
node scripts/replay-gap.js             # 离线回放（打开 FLAGS 影子开关前必看）
```
