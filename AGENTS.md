# 给 AI agent 的入口

开工前先完整读 `docs/HANDOFF.md`（架构、设计理念、算法、发布流程、优化方向）。
服务器与运维信息不在仓库里：看仓库上一级目录的 `OPS.local.md`（如果存在）。

硬性约定：
- 用中文沟通；推送、开 PR、合并、部署前先得到所有者同意。
- 不改 v1 条件分（`condScore`）的行为，`node test/parity.js` 必须 PASS；算法改动放在 v2 层。
- 改了 css / js 后提交前跑 `node scripts/stamp-assets.js`。
- 改了 `algo.js` / `api.js` 并部署时，同步服务器霞榜脚本的副本。
- 不把服务器地址、私钥、密码写进仓库（仓库是公开的）。
