# GLOW v3 升级 · 功能保护基线（2026-10-25 升级前快照）

> 用途：v3 UI 升级前后对照。算法层保护 = 原文件零改动 + 指纹一致 + 回归测试 PASS。

## 算法指纹（不得变化）

| 文件 | md5（升级前） | 说明 |
|---|---|---|
| `algo.js` | `325fcfe9950fe485d01aec6344d860c3` | 霞分算法 v2（FLAGS gapV3+windowAlign 全开），与线上 v325fcfe9 同版 |
| `api.js` | `e29b5aa1d05ef03069a5a3f1904beff3` | 数据层（fetchJSON/zonedParts/evaluateNextSunset 等），与线上 ve29b5aa1 同版 |

## 回归测试基线（升级前全部 PASS）

- `node test/parity.js` → **PARITY PASS**（JS 与 Python 输出一致）
- `node test/glow-v2-regress.js` → **GLOW-V2-REGRESS PASS**
- `node scripts/test-rankings-schema.js test/fixtures/rankings.json` → 契约通过

## v3 对算法的引用方式

`v3/src/core/glow.js` 通过 `import '../../algo.js'` / `import api from '../../api.js'` **直接引用仓库根的原文件**（不复制、不修改、不包装重写）。v3 页面全部计算走 `api.evaluateNextSunset / evaluatePlace` 等原接口。

## 页面与功能清单（v2 现状 → v3 必须保留）

### 路由
- `index.html` → `/`（今晚）· `board.html` → `/board`（霞榜）· `city.html` → `/city`（城市七天）

### 全局
1. ⌘K / 搜索按钮 → 全屏搜索面板：中文名/拼音/英文/省份子串匹配；中国 2,850 城（points-china.json：id/name/path/lat/lon）+ 全球 2,024 城（world-cities.json：zh/en/cc/lat/lon/pop）；ESC 与遮罩点击关闭；「用我的位置」geolocation
2. 收藏（本地存储）与分享（clipboard 标题+链接）
3. 移动端底部 tabbar（今晚 / 霞榜 / 城市）
4. Open-Meteo 请求：浏览器直连（v2 走 /om 缓存代理；v3 dev 直连，api.js 两种都支持）

### Home（/）
1. Hero：地点行、场次词、霞分特大数字+等级+0-100 条、verdict+why、时间窗 / 日落时刻 / 方位角 / 把握、chips
2. 天空照片按「等级×朝晚」联动交叉淡化（12 张真实摄影）
3. SUN PATH 太阳轨迹 + 四模式（models 数组：综合/ECMWF/GFS/ICON）
4. 48 小时四场横排（role=tablist 可切换）
5. SKY TIMELINE：±2.5h 可拖时间轴，←→ 2 分钟步进、Shift 加速、空格播放；太阳高度 / 霞强度 / 阶段名实时读数
6. ATMOSPHERE PROFILE 大气剖面表（高度/因素/得分/权重/分值，合计=霞分）
7. #brief 算法简介锚点
8. 加载态 `--` / 失败态一句话 + 重试

### Board（/board）
1. 全球/中国 scope 切换（role=tablist）+ 更新时间 + 池规模 meta
2. TOP10 名次列表 + 世界/中国点阵地图（点位=六级色阶、hover tip、点按进城市页；中国地图含台湾岛、南海诸岛、九段线）
3. 双榜中国 TOP5 / 全球 TOP5 + 分布统计行
4. 六档等级分布条
5. 中国城市索引搜索
6. 数据过期 stale banner；单模式城市「单模式」标注
7. 数据字段：score/grade/level/conf/clarity{name,score}/models/epoch/offsetSec/tzName/day；stats.counts 六档计数；computedAt

### City（/city?lat&lon&name&country）
1. 城市头：回链接、城市名、meta、霞榜徽章、三 tab（总览/晚霞/朝霞）
2. 今天这一场（当前场次大卡 + 配对场次）
3. 七天矩阵（行=日期，列=晚霞/朝霞，格=等级色+分数，点击联动剖面）
4. 云层剖面 SVG（低云=墙 cream / 中云 gold / 高云 rose，时间窗高亮）
5. 模式分歧（四家 + 综合×3 权重说明）
6. 未在库城市按坐标直接计算

## 数据流（不变）

- 排行/快照：`/data/*.json`（跑批产物副本）
- 实时计算：浏览器 → Open-Meteo（forecast / air-quality / ensemble）
- 时区/DST：api.zonedParts / tzParts 按时区名换算展示

## 未验证即未通过

任何一项功能在 v3 中无法演示或验证，最终报告必须标记「未验证」，不得宣称全部通过。
