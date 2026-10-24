## 1 架构与数据流

```text
浏览器：首页 / 城市页 / 霞榜页
  ├─ v2 页面脚本 → 根目录 algo.js → api.js → Open-Meteo
  │                                      └─ 预报、空气质量走 /om/ 时由 nginx 代理与缓存
  ├─ 搜索 → Open-Meteo 地理编码（当前仍直连）
  └─ 读取 /data/rankings.json、/data/snapshots.json
                                      ↑
cron → build-rankings-v3.js / build-snapshots.js
     → score-batch.js 或 api.evaluateNextSunset()
     → .tmp 文件 → rename → JSON
```

- v2 三页加载顺序是共享算法、数据层，再加载页面脚本；三页都在加载 `api.js` 前设置了 `/om` 代理基址。[index.html](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/v2/index.html:345) [city.html](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/v2/city.html:150) [board.html](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/v2/board.html:147)
- `api.js` 依赖 `algo.js`；算法负责评分，数据层负责请求、时区换算和组合模式结果。[api.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/api.js:8) [algo.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/algo.js:292) [api.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/api.js:242)
- nginx 把 `/om/v1/` 和 `/om/air-quality/v1/` 分别转发到 Open-Meteo 预报和空气质量服务，并以请求 URI 作为缓存键。[nginx-glow-cache.conf](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/deploy/nginx-glow-cache.conf:21) [nginx-glow-cache.conf](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/deploy/nginx-glow-cache.conf:44)
- 霞榜脚本先用 `scoreCities()` 粗筛，再对入围城市调用 `evaluateNextSunset()` 精算，最后写 `rankings.json` 和 `rankings-all.json`。[build-rankings-v3.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-rankings-v3.js:150) [build-rankings-v3.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-rankings-v3.js:159) [build-rankings-v3.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-rankings-v3.js:205)
- 快照脚本也复用 `score-batch.js`，产出供前端降级展示的 `snapshots.json`。[build-snapshots.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-snapshots.js:12) [build-snapshots.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-snapshots.js:59)
- 定时任务配置每天跑霞榜、每小时跑快照。[crontab.txt](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/deploy/crontab.txt:4)

## 2 确认的缺陷

| 严重度 | 位置 | 问题 | 触发条件 | 修复建议 |
|---|---|---|---|---|
| 高 | [build-rankings-v3.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-rankings-v3.js:110) [build-rankings-v3.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-rankings-v3.js:118) | 轻量刷新按城市名合并结果，并无论刷新成功与否都更新整份榜单的 `computedAt`。失败的城市保留旧数据，却会被页面当成新榜单数据。 | `--refresh N` 中有请求失败，或只刷新榜单前 N 名时；榜单其余记录未重算但时间戳被重置。 | 以稳定城市 ID（国家码 + 坐标）匹配；为记录保存各自更新时间，或只在覆盖率满足条件时更新整榜时间。 |
| 中 | [city.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/v2/assets/js/city.js:10) | `parseFloat(...) || 默认值` 会把合法坐标 `0` 当成缺失值。 | 城市 URL 的纬度或经度恰为 `0`，例如赤道或本初子午线附近。 | 用 `Number.isFinite()` 判断参数是否有效，而不是按真值回退。 |
| 中 | [build-snapshots.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-snapshots.js:22) [build-snapshots.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-snapshots.js:63) [glow.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/v2/assets/js/glow.js:221) | 快照键仅用城市名和两位小数纬度，忽略经度；去重、写入和读取都沿用该键。不同地点同名且纬度落在同一舍入值时，可能被去重或互相覆盖，前端也可能取错地点快照。 | 数据集中存在同名地点，且纬度四舍五入到相同的 `0.01°`。 | 键中加入经度、国家码或城市 ID；读取时以经纬度距离匹配。 |
| 中（配置生效时） | [crontab.txt](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/deploy/crontab.txt:4) [OPS.local.md](/Users/bai/Developer/sunset-glow-forecast/OPS.local.md:11) | 配置注释写“北京时间 15:00”，cron 表达式却是 `0 15`。主服务器时区为 UTC+7，若在该机安装此配置，任务会在北京时间 16:00 执行。 | 将仓库这份 crontab 安装到 UTC+7 的主服务器，且 cron 使用系统本地时区。 | 明确设置 `CRON_TZ=Asia/Shanghai`，或按主机时区把任务设为 14:00；部署说明统一到实际配置。 |
| 低 | [api.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/api.js:12) [api.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/api.js:121) [nginx-glow-cache.conf](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/deploy/nginx-glow-cache.conf:64) | nginx 配置提供 `/om/geo/v1/` 地理编码代理，但 `api.js` 的 `GEO_URL` 固定为 Open-Meteo 域名，搜索不会使用该代理或其缓存。 | 按文档启用 `/om` 后执行地点搜索。 | 将地理编码 URL 也基于代理基址构造，或删去未接入的代理配置与相关承诺。 |

## 3 疑似问题与风险

- **两段式分数不可直接视为同口径。** 粗筛默认跳过 AQ，`A.evaluate()` 因而把缺失空气指标从权重中排除，且 `glow()` 在空气指标全缺时用 70 作默认值；精算则使用实测 AQ/AOD，连幕布受光修正也会变化。[score-batch.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/lib/score-batch.js:116) [algo.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/algo.js:497) [algo.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/algo.js:512) 因此粗筛头部可能漏掉完整评分后应入围的城市，尤其是 AQ 差异大的地点。建议用历史样本量化粗筛与精算排名的偏差，并给粗筛多留候选余量。
- **卫星城规则会静默误删。** 距离严格小于 60 km 才触发；人口严格低于母城 90% 才删除，等于 90% 会保留。但人口未匹配到时 `popOf()` 返回 0，附近任何已匹配母城都可能让它被删；人口表又仅按归一化名称建索引，没有国家或地区维度。[build-rankings-v3.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-rankings-v3.js:55) [build-rankings-v3.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-rankings-v3.js:65) [build-rankings-v3.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-rankings-v3.js:74) 建议对人口缺失采取保留策略，并给合并结果记录原因，便于审计。
- **轻量刷新有城市名碰撞风险。** `byName` 仅以 `city.name` 为键；若全球榜与中国榜或同榜出现同名异地，最后写入的结果可能套到另一城市。[build-rankings-v3.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-rankings-v3.js:100) [build-rankings-v3.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-rankings-v3.js:110)
- **快照过期时缺少明确年龄提示。** 快照生成失败会保留旧文件，而 `snapshotFor()` 不检查 `computedAt`；页面会标“快照”并展示时分，但不展示日期或过期状态。若连续任务失败，旧快照可能仍被当作当前兜底结果；其中“今天/明天”也是生成时的 `day` 字段。[build-snapshots.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-snapshots.js:72) [glow.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/v2/assets/js/glow.js:216) [city.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/v2/assets/js/city.js:209)
- **榜单页与首页会提示榜单过期，城市页徽标仍可能称“今日”。** 首页和榜单页用 36 小时阈值标注陈旧榜单；城市页匹配到榜单记录时直接显示“今日霞榜在榜”，只附生成时间。[home.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/v2/assets/js/home.js:366) [board.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/v2/assets/js/board.js:133) [city.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/v2/assets/js/city.js:183)
- **时区处理主体正确，但任务调度依赖系统时区。** 预报时间通过 Open-Meteo 返回的 `utc_offset_seconds` 转 epoch，展示也显式传 offset，服务器 +07 或第二台 CST(+08) 不会直接改变事件时间换算。[algo.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/algo.js:126) [api.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/api.js:303) 但 cron 按主机本地时间运行，前述 15:00 配置存在一小时偏差；另外时间戳展示使用浏览器本地时区且未标注时区，跨区用户可能误读为城市当地时间。[board.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/v2/assets/js/board.js:133)
- **`--refresh` 没有当前字段丢失或排序错乱的直接证据。** 当前轻刷替换字段与全量输出的 `slim()` 字段一致，并对榜单重新排序、重算等级统计。[build-rankings-v3.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-rankings-v3.js:111) [build-rankings-v3.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/build-rankings-v3.js:183) 主要问题是未刷记录的时间戳和同名城市匹配。
- **nginx 缓存键没有发现坐标串位问题。** `$request_uri` 包含路径与查询参数，预报和空气质量路径不同；主要风险是参数顺序不同导致缓存碎片，而不是把不同坐标命中到同一缓存项。[nginx-glow-cache.conf](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/deploy/nginx-glow-cache.conf:15) [nginx-glow-cache.conf](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/deploy/nginx-glow-cache.conf:28)
- **429 的 stale 策略需要线上验证。** 配置允许在 429 时用 stale，但同时也配置缓存 429 响应 30 秒；没有证据证明缓存未命中时能提供旧数据，也没有 `Retry-After` 相关处理。[nginx-glow-cache.conf](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/deploy/nginx-glow-cache.conf:30) [nginx-glow-cache.conf](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/deploy/nginx-glow-cache.conf:33)
- **反向隧道单点无法从仓库确认。** 部署说明列出 +07 生产机和 CST 备用机，但仓库未见隧道建立、健康检查或自动切换配置；Node 代理只监听本机回环地址。[deploy/README.md](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/deploy/README.md:89) [cache-proxy.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/deploy/cache-proxy.js:93) 因此若流量依赖手工 SSH 隧道，断线就是单点故障；是否实际如此需核对服务器配置。
- **移动端 CSS 外链不是桌面漏样式。** `mobile.css` 只在 767px 以下载入，而桌面及平板布局由常驻 CSS 和其中的响应式断点覆盖。[index.html](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/v2/index.html:13) [base.css](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/v2/assets/css/base.css:100) 未发现桌面端必须依赖 `mobile.css` 的证据。

## 4 优化方向（立刻/值得/先别）

### 立刻该做

- 修复轻刷的更新时间语义和城市匹配键；收益是避免将旧分数伪装成新榜单，代价是需给记录定义稳定 ID 或逐条更新时间。
- 修复快照键，加入经度或稳定 ID；收益是防止同名地点误用快照，代价是需要同步调整生成器与前端查找逻辑。
- 对过期快照和城市页旧榜徽标显示日期与“非今日”；收益是兜底状态更诚实，代价是少量 UI 逻辑。
- 对 cron 明确时区，并统一 `deploy/crontab.txt`、`deploy/README.md` 和运维记录；收益是执行时间可预测，代价是部署时需确认 cron 的时区环境。

### 值得做

- 对粗筛与精算做回放评估，量出候选召回率，再决定是否增加候选数或引入粗筛空气指标；收益是减少霞榜漏项，代价是会增加 API 调用和脚本时间。
- 卫星城人口缺失时不自动合并，并把距离、人口比、命中母城写入日志；收益是减少误杀且可解释，代价是榜单可能出现更多近邻城市。
- 将地理编码接入代理，统一 Open-Meteo 请求入口；收益是减少直连、统一缓存，代价是需处理查询语言和代理缓存策略。
- 为 `score-batch`、刷新合并、快照键和时区换算提供固定 fixture 测试；收益是回归更容易发现，代价是维护样本与预期结果。

### 先别做

- 先别扩大城市池或提高 cron 并发；收益有限，粗筛排序偏差、限流与时区调度尚未形成可靠基线，扩量会放大这些问题。
- 先别重写 nginx 缓存键或增加多层缓存；当前键已含完整 URI，优先验证 429 stale 和命中率，再决定是否需要更多复杂度。

## 5 代码质量

- **边界职责总体清楚：** `algo.js` 纯评分，`api.js` 处理网络和模型组合，页面脚本负责 UI；批量脚本也复用算法和数据层。[HANDOFF.md](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/docs/HANDOFF.md:29) [score-batch.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/lib/score-batch.js:7)
- **共享根文件有传播效应。** 旧首页也直接加载根 `algo.js` 和 `api.js`，因此算法和数据层的行为变化会影响旧站；`GLOW_OM_BASE` 仅在全局变量存在时才启用，旧首页没有设置它，故不会因为 v2 页面设置代理而自动改走 `/om`。[index.html](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/index.html:282) [api.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/api.js:14) 另外，根 `api.js` 的 429 重试逻辑对旧站同样生效。[api.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/api.js:25)
- **有可清理的死代码与过时注释：** `UP_FULL` 未使用，`ov` 被写成恒为 `null` 的条件表达式；批量限流注释同时提到 420 和 70，部署说明仍写默认 420，而代码默认 70。[score-batch.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/lib/score-batch.js:11) [score-batch.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/lib/score-batch.js:16) [score-batch.js](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/scripts/lib/score-batch.js:140) [deploy/README.md](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/deploy/README.md:86)
- **部署文档与配置漂移明显：** crontab 写粗筛 500 城、精算 60 城，实际参数是 `300 + 200`、`top 30`；README 又列出另一套任务和城市数。[crontab.txt](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/deploy/crontab.txt:4) [deploy/README.md](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/deploy/README.md:100)
- **算法守护范围有限：** parity 约束的是 v1 条件分；v2 霞分、批量粗筛、卫星合并和快照逻辑没有看到对应的离线回归样本。HANDOFF 也说明分档尚未用实况校准。[HANDOFF.md](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/docs/HANDOFF.md:45) [HANDOFF.md](/Users/bai/Developer/sunset-glow-forecast/sunset-glow-forecast/docs/HANDOFF.md:119)

如果只做三件事：**修正 `--refresh` 的更新时间与城市 ID 匹配；修正快照键并标明快照过期；统一 cron 时区和部署文档。**

---

## 复核记录（Hermes 逐条验证，2026-10-24）

| 结论 | 验证方式 | 结果 |
|---|---|---|
| city.js 坐标 0 被当缺失 | 读 `v2/assets/js/city.js:13-14` | ✅ 属实：`parseFloat(q.get('lat')) \|\| 10.79` |
| `--refresh` 无条件刷新 computedAt | 读 `scripts/build-rankings-v3.js:118-121` | ✅ 属实 |
| 快照键缺经度 | 读 `build-snapshots.js:38,65` 与 `glow.js:224` | ✅ 属实：`name + '\|' + lat` |
| UP_FULL 死代码 / ov 恒 null | `score-batch.js:11,140` | ✅ 属实 |
| crontab 注释与表达式时区不符 | `deploy/crontab.txt:4-5` | ✅ 属实：注释「北京时间 15:00」，表达式 `0 15` 在 +07 主机上等于北京 16:00 |
| 地理编码未走代理 | `api.js` GEO_URL 固定域名 | ✅ 属实 |
| 旧站是否受 api.js 改动影响 | 旧 `index.html` 未设 `GLOW_OM_BASE` | ✅ 不受影响（开关默认空） |

审查工具：Codex CLI 0.163（本机 Claude Code 2.1.309 未登录，`claude -p` 返回 `Not logged in`）。

---

## Claude 审查（2026-10-24，Claude Code 2.1.309，只读）

完整报告见文末附录要点；以下为**已当场修复并线上验证**与**待办**。

### 已修复（每条都线上复验）

| 问题 | 严重度 | 修复 | 验证 |
|---|---|---|---|
| `stats.global` 写成数组，两个前端按 `.counts` 读 → v2 分布全 0、旧站 `st.counts.reduce` 抛错 | 高 | v3 / dedupe 都改写成 `{counts:[...]}`，并重建线上榜单 | 线上分布柱 `8,7,6,3,4,1`，`cnStat 25 城 · 25 城有霞` |
| 精算失败回退粗分混进排名（粗分系统性偏高） | 高 | 粗分条目标 `coarseOnly`，不参与排序；dedupe 直接剔除无 `models` 的记录 | 线上 TOP5 全部带 4 模式 |
| `--refresh` 不管成功与否都改 `computedAt` | 高 | 0 城成功则不写文件；成功只更新 `refreshedAt` | 代码级 |
| 首页 `?c=` 注入 DOM XSS | 高 | `placeLine` 走 `esc()` | 注入 `<img onerror>` 渲染为纯文本，`window.__xss` 未触发 |
| 「只看晚霞」矩阵为空（`'sun'` vs `'sunset'`） | 中 | 统一 `sunset` | 代码级 |
| 全球榜城市名次被加上中国榜长度 | 中 | 按所在榜单分别算名次 | 代码级 |
| 明天晚霞标题显示「明早」 | 中 | `tomorrow ? (sunrise?'明早':'明晚')` | 代码级 |
| 桌面端露出无样式 tabbar | 中 | `base.css` 加 `.tabbar{display:none}` | 线上 `display:none` |
| README 泄露两台服务器公网 IP | 合规 | 改为角色描述，IP 移出仓库 | 仓库内仅剩 127.0.0.1 |

### 待办（按收益排序，尚未动）

1. **请求竞态**：`applyPlace` 无请求 token，后到的旧响应会覆盖新地点（`home.js`）。
2. **快照按坐标匹配**：现在按名字精确匹配，`海口` 与 `海口市` 几乎命中不了；cron 只给前 20 个中国城市做快照。
3. **去重分桶**：`toFixed(1)` 会把成都算成两条（30.6 / 30.7），同名同人口导致卫星城合并也合不掉。
4. **时间轴色带方向**：日落时「蓝调｜火烧｜金色」顺序是反的。
5. **门控数字口径**：首页三个门控值是临时公式，和剖面、算法都不一致，应直接用 `ev.comps`。
6. **请求量减半**：`evaluatePlace` 并入 `weekly`，每次访问 6 个请求降到 3 个。
7. **`/om` 单点**：代理失败不回退直连，任一环节断掉 v2 全站取数失败。
8. **nginx**：`proxy_cache_path` 等要写在 http 段；429 不应缓存 30s（前端 4s/12s 重试必然命中）；错误响应不该带 `max-age=300`。
9. **文案与事实不符**：「4 模式 · 51 成员」「更新每小时」「每天 15:00 预计算」。
10. **crontab.txt 与实际不一致**：文件写 15:00 全量，线上是 04:00 全量 + 15:00 刷新。

### 只做三件事的话

1. 霞榜数据契约（stats 形状、粗分不混排、refresh 时间戳）——已修，建议补一条 schema 测试防回归。
2. 首页安全与正确性（XSS、竞态、明早/明晚、矩阵 key、名次）——除竞态外已修。
3. 降请求、去单点（weekly 合并、坐标取整、`/om` 回落直连、nginx 修正）——未动，这是访客量上来后最先出问题的地方。
