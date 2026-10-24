# GLOW · Design System MASTER — TWILIGHT EDITORIAL（暮色编辑部）

> **LOGIC:** 页面级规则在 `pages/[page].md`，存在则覆盖本文件；不存在则严格遵守本文件。
> 生成工具：ui-ux-pro-max v2.15.0（`search.py --design-system`）+ 风格库验证（aurora-ui / dark editorial / Classic Elegant 字体对）+ 现网 tokens.css 品牌资产融合。2026-10-25。

**Project:** GLOW 霞 · 火烧云预报
**Category:** 大气科学 × 数据可视化 × 摄影审美
**一句话方向:** 把「预报」做成「一片可以读的天色」——深暮底上，衬线大字与六级霞光色阶构成编辑部式的信息层级，天空照片与 aurora 流动渐变提供沉浸层。

---

## 1. Color 色彩

### 表面（深暮，dark-first）
| Token | Hex | 用途 |
|---|---|---|
| `--color-ink-900` | `#06050E` | 页面最底 |
| `--color-ink-800` | `#0B0918` | 卡片/分层底 |
| `--color-ink-700` | `#120E26` | 浮层/hover 底 |
| `--color-twilight-600` | `#1B1140` | aurora 渐变中间站 |
| `--color-twilight-500` | `#2A1A55` | aurora 渐变亮端 |

### 墨色（文字）
| Token | 值 | 用途 |
|---|---|---|
| `--color-cream` | `#F6EFE6` | 主文字（对比度 15:1+） |
| `--color-mist` | `rgba(246,239,230,.74)` | 次要文字 |
| `--color-veil` | `rgba(246,239,230,.56)` | 弱化文字/说明 |
| `--color-line` | `rgba(246,239,230,.10)` | 1px 分隔线 |
| `--color-line-strong` | `rgba(246,239,230,.22)` | 强分隔/表头线 |

### 品牌色
`--color-ember #FF5A1F`（余烬橙，主 CTA/强调）· `--color-gold #FFC36B`（霞光金）· `--color-rose #FF7E8B`（暮玫红）· `--color-plasma #B14BFF`（高空紫，仅渐变层）

### 六级霞光色阶（数据编码唯一来源，与算法六档一一对应）
`--color-lv0 #6E6A80`（无烧）→ `--color-lv1 #8C7BB8`（微烧）→ `--color-lv2 #FF7E8B`（小烧）→ `--color-lv3 #FF9F45`（小到中烧）→ `--color-lv4 #FF5A1F`（中到大烧）→ `--color-lv5 #FFC36B`（大烧）

**规则:** 分数→颜色必须走六级色阶；不得发明第七种状态色。语义色：错误 `#FF5A5A`、成功沿用 lv5、链接 cream 下划线式。

## 2. Typography 字体

| 层 | 字体 | 用法 |
|---|---|---|
| Display | `Noto Serif SC`（本地栈 `Songti SC` 兜底） | 大标题/城市名/霞分数字，weight 600-900，`tracking-tight`，行高 0.95-1.1 |
| Body | `system-ui / PingFang SC / Noto Sans SC` | 正文 15-17px，行高 1.7 |
| Label | `JetBrains Mono`（ui-monospace 兜底） | 全大写小标签、数据单位、时间戳，`letter-spacing .18em`，10.5-11.5px |

字号：display `clamp(64px,9vw,116px)` · h1 `clamp(34px,4vw,52px)` · h2 26-34 · body 15-17 · label 11.5 · 数据特大 `clamp(96px,13vw,178px)`（霞分）。

## 3. Layout 布局

- 最大宽 1440，左右 gutter 56px（≤1023px:32px，≤720px:20px），内容与视口边留呼吸。
- Section 垂直节奏 `clamp(72px,9vh,130px)`；同一页相邻 section 不得用同一种网格结构。
- 卡片：**直角（radius 0）**，1px `--color-line` 边，底 `ink-800`；hover 升 `ink-700` + 边变 `line-strong`。唯一例外：pill 切换器与 chip 用 `999px`。
- 数据表（榜单/剖面）：mono 表头全大写 + `line-strong` 下边线，行间 1px line。
- 响应式断点：1440 / 1280 / 1024 / 768 / 390 / 375。移动端不是缩小版：hero 竖排、榜单单列、底部 tabbar（今晚/霞榜/城市）导航。

## 4. 沉浸层（品牌独有）

- **天空照片层:** `sky/H01_hero_sky_{L0-L5}_{dawn|dusk}.jpg` 12 张真实摄影，按「当前霞分等级 × 场次」联动切换，交叉淡化 900ms（`--dur-sky`）。照片永远在最底层，上面压 60-75% ink 渐变保证文字对比。
- **Aurora 流动层:** twilight-500 → plasma → twilight-600 的多重 radial/conic 渐变，`background-size 200%`，10s 循环缓动，`mix-blend-mode: screen`，透明度 ≤ .35；`prefers-reduced-motion` 时静止。
- 照片与 aurora 不得同时出现在同一视觉焦点区（照片做主角时 aurora 只留边角）。

## 5. Motion 动效

| Token | 值 | 用途 |
|---|---|---|
| `--ease-glow` | `cubic-bezier(.16,1,.3,1)` | 全局唯一缓动 |
| fast 120ms | hover/按压反馈 |
| base 240ms | 展开/收起/切换 |
| sky 900ms | 天空照片交叉淡化 |
| 入场 | stagger 60ms/项，y:24→0 + opacity，仅首次 |
| 滚动 | 逐 section reveal（IntersectionObserver / framer `whileInView`） |

**规则:** 所有交互元素 150-300ms 过渡 + `cursor-pointer` + 可见 focus；无布局位移式 hover；`prefers-reduced-motion` 全局降级为淡入。禁止装饰性无限动画（aurora 背景除外）。

## 6. Components 规范

- **Button:** primary = ember 底 + ink-900 字，直角；ghost = 1px line-strong 边 + cream 字；hover 均为 base 过渡 + 轻微亮度变化，无 scale 位移。
- **Score（霞分）:** Display 衬线特大数字 + mono 单位「GLOW」，颜色 = 等级色阶，旁配 0-100 细条（高 2px，底 line，填充等级色）。
- **Chip:** pill、mono 小字、`line` 边；数据 chip 用等级色描边。
- **SearchPanel（⌘K）:** 全屏遮罩（ink-900/85 + blur 8px）+ 居中框（ink-800、1px line-strong、直角），结果行 hover ink-700；ESC/遮罩点击关闭，焦点陷阱。
- **Map（霞榜）:** 点阵世界/中国地图，点位 = 六级色阶，半径 3-6px 按 top 名次放大；hover 出 tip（城市名+分数）。
- **Navbar:** 透明起步，滚动 >40px 加 ink-900/80 + blur + 底部 1px line；桌面 01/02/03 编号导航 + ⌘K 搜索；移动 tabbar。

## 7. 反模式（禁止）

- ❌ emoji 当图标（一律 Lucide SVG）
- ❌ 圆角卡片矩阵 / SaaS 模板感 / 玻璃拟态大渐变按钮
- ❌ 七种以上的状态色、与六级色阶冲突的强调色
- ❌ 布局位移式 hover、瞬时状态切换、看不见的 focus
- ❌ 装饰动画干扰阅读（aurora 之外的无限循环）
- ❌ 低对比（正文 <4.5:1）；照片上文字必须压 ink 渐变
- ❌ 中文界面用全英文字体渲染正文

## 8. 交付前检查单

- [ ] 六级色阶是唯一数据编码；照片层与分数联动正确
- [ ] 所有交互 150-300ms + cursor:pointer + focus 可见
- [ ] `prefers-reduced-motion` 生效（aurora 静止、入场改淡入）
- [ ] 375/390/768/1280/1440 无横向溢出、无裁字
- [ ] mono 标签全大写 + .18em 字距；衬线只用于 Display
- [ ] 图片懒加载、无布局偏移（占位比例固定）
- [ ] 控制台无错误；路由/锚点/⌘K/ESC 行为完整
