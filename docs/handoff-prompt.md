# 交接给其他 agent 的用法

本仓库根目录有 `AGENTS.md`（Codex / Cursor / 多数 agent 会自动读），`CLAUDE.md` 里只有一行 `@AGENTS.md`（Claude Code 会自动跟进）。
所以 agent 进来先看 AGENTS.md，再读 `docs/HANDOFF.md` 就能上手。

下面是可以直接复制给任何 agent 的指令。**按需选一段**，别一次给太多范围——范围越大，报告越水。

---

## A. 全面复审（找 bug + 优化方向）

```
你在 /Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast 做一轮只读复审。

先读 AGENTS.md 和 docs/HANDOFF.md，再读 docs/changelog-2026-10-24.md
（最近刚改过的东西，别重复报告已修项）。

项目：火烧云（朝霞/晚霞）预报站，纯静态前端 + Node 离线算榜，线上 https://glow.byb521.com/。

范围：v2 前端三页、algo.js 算法、api.js 取数、scripts 离线任务、deploy 配置。

输出：
## A 确定的 bug
每条：文件:行号 | 现象 | 复现步骤 | 为什么是 bug | 修法。按严重度排序。
## B 逻辑/架构问题
## C 优化方案（按投入产出排序，给预期收益和风险）
## D 如果只能做 3 件事，做哪 3 件

要求：
- 每条结论必须有文件:行号或可复现步骤，不要写「建议加测试」这类空话
- 不确定的写「需要验证」并说明怎么验证
- 不要改任何文件，不要部署
```

---

## B. 只审算法（最值得单独跑的一次）

```
你在 /Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast 只读复审霞分算法。

先读 docs/HANDOFF.md 第 4、5 节和 docs/algo-review-2026-10-24.md（上一轮的结论与已修项），
再读 algo.js、api.js 的打分与集合部分。

已知约束（不要重复建议）：
- data/glow-labels.jsonl 只有 1 条标注，权重和六档切点现在不能调
- v1 condScore 必须与 Python predict.py 保持一致（test/parity.js），不许改
- 只有 Open-Meteo 免费层可用（预报 + 空气质量 + ECMWF ENS-51）

请重点看：
1. 三项加权几何平均（幕布0.5/缺口0.3/低云0.2）这个形式合不合理，什么情况下失真
2. 上游缺口：现在按 1/(1+d/100) 给 50/150/300/400 km 加权，和光路几何是否一致
3. 15 分钟窗口取最大值、朝晚霞共用一套窗口，有什么系统性偏差
4. 降水硬封顶 34、缺数据封顶 34，会不会误杀
5. 空气项（AOD / PM2.5 / 能见度）是否共线或重复计算
6. 置信度与概率输出（scoreToProb、ENS-51）的口径

输出：A 底层逻辑问题（附数值算例）B 框架缺失 C 可落地优化（给公式和文件位置）
D 在只有几十条标注的前提下怎么科学验证。
```

---

## C. 只审前端 / UX

```
你在 /Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast 只读复审 v2 前端。

读 AGENTS.md、docs/HANDOFF.md 第 2/3 节，然后看 v2/ 下的 html 与 assets/js、assets/css。

线上 https://glow.byb521.com/ 可以直接开。三页：/ 、/city.html 、/board.html。

请检查：布局断点、移动端（390×844）溢出与触控目标、空态与错误态、加载态、
键盘可达性（⌘K、方向键、空格）、对比度、状态管理（切城市/切日期/返回时是否残留旧数据）、
请求数与首屏时间。

输出：每条给文件:行号或 DOM 选择器 + 复现步骤 + 期望 vs 实际。不要改文件。
```

---

## 怎么调起来

```bash
cd ~/Developer/sunset-glow-forecast/sunset-glow-forecast

# Claude Code（只读，不许写）
claude -p "$(cat /tmp/prompt.txt)" --allowedTools "Read,Grep,Glob" \
  --disallowedTools "Write,Edit,Bash,NotebookEdit" --max-turns 80 --output-format text

# Codex CLI（只读沙箱，高强度推理）
codex exec --sandbox read-only -c model_reasoning_effort="high" "$(cat /tmp/prompt.txt)"

# OpenCode / 其他 CLI：同样思路，关键是「只读 + 不限轮数 + 要求文件:行号」
```

把上面的指令存成 `/tmp/prompt.txt` 再传，比直接写一长串更稳（引号不会打架）。
跑完的结论建议存进 `docs/`，命名 `xxx-review-YYYY-MM-DD.md`——下次换 agent 时它能直接看到前一轮说了什么。

## 交接时最容易出问题的地方

1. **不告诉它「已经修过什么」** → 它会重复报告，浪费一轮。
   `docs/changelog-2026-10-24.md` 就是干这个用的。
2. **不给「不能做什么」** → 它会热情地帮你调权重、改 condScore、直接部署。
   `AGENTS.md` 里那几条硬性约定就是护栏。
3. **让它改文件又让它报告** → 报告会变成 diff 的复述。复审和执行分两次跑。
4. **一次给太大范围** → 报告泛泛而谈。按算法 / 前端 / 运维分开审。
