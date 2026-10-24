# 给 AI agent 的入口

**开工前先完整读 `docs/HANDOFF.md`**（架构 / 数据流 / 算法现状 / 该做什么 / 不能碰什么 / 验证命令 / 坑）。
运维信息（服务器地址、密钥、部署）不在仓库里：看仓库上一级目录的 `OPS.local.md`。

## 硬性约定

- 用中文沟通；结论要带 `文件:行号` 或可复现步骤。
- **不改 v1 条件分 `condScore` 的计算路径**：`node test/parity.js` 必须 PASS。算法改动放在 v2 层。
- **没有标注数据不要调权重、不要调六档切点**：`data/glow-labels.jsonl` 只有 1 条标注。
- 改了 css / js 之后，提交前跑 `node scripts/stamp-assets.js`。
- 改了 `algo.js` / `api.js` 之后，跑 `node test/parity.js` 与 `node scripts/test-rankings-schema.js`。
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

详见 `docs/changelog-2026-10-24.md`、`docs/algo-review-2026-10-24.md`、
`docs/architecture-review-2026-10-24-codex.md`。

## 验证命令

```bash
node test/parity.js                    # 必须 PASS
node scripts/test-rankings-schema.js   # 榜单契约
node scripts/stamp-assets.js --check   # 资源版本号
```
