# 07 · 视觉参考图索引与提示词（PHASE 05 · 修订版）

> 目录：`docs/design/references/` · 18 张界面图 · 2560×1440 PNG（16:9）
> 另有 `references/sky/` 12 张天幕分级预览（6 档 × 朝/晚），见 `10-sky-system.md`
> 修订 2026-10-23：删除观景点（5 张）、方法页（5 张）、城市成绩单（1 张）；新增算法概述 1 张。

---

## 1. 两层做法

| 层 | 手段 | 解决什么 |
|---|---|---|
| UI 参考图 | Codex 写 HTML/CSS，逐 section 截图 | 栅格真实、字体真实、数据真实、18 张完全一致 |
| 天空底图 | `codex-image` 生成**无 UI 的纯天空照片** | 电影质感；UI 全部代码叠加，不靠模型画字 |

第一轮试过让图像模型直接出「带 UI 的 hero 效果图」：氛围可以，但栅格、字号、中文语义不可控，
时间轴和搜索框是装饰性假 UI，无法交给前端。证据留在 `references/_alt/_test-01-02-hero.png`。
Barry 认可那张图的**视觉方向**，所以这轮的做法是：把它当摄影底图，UI 用代码重画。

---

## 2. 图片与 Section 对应表（18 张）

### P01 · 今晚 `/`

| 编号 | 文件 | 内容 | 源 |
|---|---|---|---|
| 01-01 | `p01-01_masthead.png` | 顶栏两种状态（透明 / 毛玻璃）+ 规格标注 | `p01.html#p01-01` |
| 01-02 | `p01-02_hero-verdict.png` | Hero：摄影天幕 + 今晚 68 + 窗口 + 色阶环 + 仪器轨 | `p01.html#p01-02` |
| 01-03 | `p01-03_forecast-rail.png` | 四场轨道 + 为什么今晚更高 | `p01.html#p01-03` |
| 01-04 | `p01-04_sky-timeline.png` | 天色时间轴（舞台 + 150 格刻度 + 游标） | `p01.html#p01-04` |
| 01-05 | `p01-05_atmosphere-profile.png` | 11 项因素分组 + 权重 + 无数据态 | `p01.html#p01-05` |
| 01-06 | `p01-06_board-teaser.png` | 霞榜预告 TOP5 + 晨昏线带 | `p01.html#p01-06` |
| 01-07 | `p01-07_algorithm-brief.png` | 算法概述：三个旋钮 + 4 模式 51 成员 + 已知误判 | `p01.html#p01-07` |
| 01-08 | `p01-08_footer.png` | 页脚三列 | `p01.html#p01-08` |

### P02 · 城市 `/c/:slug`

| 编号 | 文件 | 内容 | 源 |
|---|---|---|---|
| 02-01 | `p02-01_city-header.png` | 城市页头 + sticky 结论栏 + 底部缩影 | `p02.html#p02-01` |
| 02-02 | `p02-02_seven-day-matrix.png` | 七日矩阵（晚/朝/日落） | `p02.html#p02-02` |
| 02-03 | `p02-03_cloud-deck.png` | 云层剖面：三层云 + 光线 + 上游 5 点 | `p02.html#p02-03` |
| 02-04 | `p02-04_model-consensus.png` | 四模式点阵 + 51 成员分布 | `p02.html#p02-04` |
| 02-05 | `p02-05_sunset-sequence.png` | 日落时序 8 格 + 最红窗口 | `p02.html#p02-05` |

### P03 · 霞榜 `/board`

| 编号 | 文件 | 内容 | 源 |
|---|---|---|---|
| 03-01 | `p03-01_board-header.png` | 榜单页头 + scope/日期 + TOP4 | `p03.html#p03-01` |
| 03-02 | `p03-02_map-ranking.png` | 地图（中国放大）+ 左侧 TOP10 榜单 + 色阶图例 | `p03.html#p03-02` |
| 03-03 | `p03-03_dual-board.png` | 世界地图 + 中国/全球双榜 + 两个 #1 气泡 | `p03.html#p03-03` |
| 03-04 | `p03-04_distribution.png` | 六档分布直方 + 大盘读数 | `p03.html#p03-04` |
| 03-05 | `p03-05_city-inspector.png` | 城市检视抽屉 | `p03.html#p03-05` |

---

## 3. 摄影素材与提示词

| 文件 | 用途 | 提示词要点 |
|---|---|---|
| `photos/sky-dusk-L4.jpg` | **01-02 首屏天幕（68 分 → L4）** | 纯天空、无陆地/无月/无星/无文字；左 1/3 深靛蓝留白，右 2/3 层积云被下方夕照点亮；自然曝光、轻微降饱和、胶片颗粒、不要 HDR |
| `photos/spot-river.jpg` | 备用（观景点已砍，仅留档） | 河岸日落，4:5 |
| `photos/spot-rooftop.jpg` | 备用 | 天台日落，4:5 |
| `photos/spot-coast.jpg` | 备用 | 海边防波堤，4:5 |
| `photos/obs-hcm-1023.jpg` | 真实样本留档（原 05-04 用图） | 真实照片，iPhone 17 Pro Max，10.8013/106.7750，17:44 |

> 观景点模块砍掉后，三张 4:5 摄影暂时没有落位。保留在 `render/photos/`，未来做分享卡底图可复用。

**使用规则**
1. 摄影只做天幕底图，**UI 永远代码渲染**，不把文字交给图像模型。
2. 生成素材压饱和（CSS `saturate(.86)`），避免 HDR 感。
3. 真实照片保留原始 EXIF 信息，标注时间与坐标。

---

## 4. 复现命令

```bash
open docs/design/render/p01.html     # 每页一个文件，内含多个 .stage

# 截图：viewport 1440×810
#   Page.captureScreenshot clip={x:0,y:0,width:1440,height:810,scale:1.7778}
# 切 stage：window.show('p01-02')；03 页需再调 drawDots()
```

---

## 5. 已知取舍

| 取舍 | 原因 |
|---|---|
| section 视口切片，不是整页长图 | 便于逐模块验收与交接 |
| 地图为等距圆柱 + Natural Earth 110m | 参考图不需要瓦片精度；生产用 MapLibre |
| 03-02 用 32 城（中国榜 + 全球榜） | 只有中国 34 城铺满世界地图会太空 |
| 首屏用摄影底图 + 代码 UI | 兼顾 Barry 认可的质感与可实现性 |
