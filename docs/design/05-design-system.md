# 05 · Design System（PHASE 04）

> 实现形式：CSS 自定义属性 + 原生 HTML/CSS（不引入框架）。所有数值可直接写成 `:root`。

---

## 1. 基础原则

1. **零圆角或药丸，二选一**。容器 `radius: 0`（直角）+ 标签/按钮 `radius: 999px`。禁止 4–16px 的「默认圆角」。
2. **层级只靠三样东西**：1px 线、背景明度差（`--ink-900/800/700`）、文字透明度。
3. **不用 box-shadow**（唯一例外：色阶 ≥ 65 的发光，用 `filter: drop-shadow` + 色相）。
4. **数字全部 tabular-nums**，右对齐。
5. **一个区块只允许一个强调色**。

---

## 2. Token 表

### 2.1 颜色

```css
:root{
  /* surface */
  --ink-900:#06050E; --ink-800:#0B0918; --ink-700:#120E26;
  --twilight-600:#1B1140; --twilight-500:#2A1A55;

  /* ink */
  --cream:#F6EFE6; --mist:rgba(246,239,230,.62); --veil:rgba(246,239,230,.38);
  --line:rgba(246,239,230,.10); --line-strong:rgba(246,239,230,.22);

  /* brand */
  --ember:#FF5A1F; --gold:#FFC36B; --rose:#FF7E8B; --plasma:#B14BFF;

  /* grade（六级） */
  --lv0:#6E6A80; --lv1:#8C7BB8; --lv2:#FF7E8B;
  --lv3:#FF9F45; --lv4:#FF5A1F; --lv5:#FFC36B;

  /* 功能色 */
  --ok:#4ED9A0; --warn:#FFB020; --err:#FF6B57;
}
```

### 2.2 排版

```css
--font-display:'Noto Serif SC',Songti SC,serif;
--font-editorial:'Instrument Serif',Georgia,serif;
--font-body:Inter,'PingFang SC','Noto Sans SC',system-ui,sans-serif;
--font-mono:'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;

--fs-display:clamp(72px,11vw,176px);
--fs-h1:clamp(40px,5.2vw,84px);
--fs-h2:clamp(28px,3vw,44px);
--fs-h3:clamp(20px,1.8vw,26px);
--fs-body:clamp(15px,1.05vw,17px);
--fs-small:14px; --fs-label:11px;
--fs-data-xl:clamp(96px,14vw,200px);
--fs-data-l:clamp(40px,4vw,64px);
--fs-data-m:clamp(24px,2vw,32px);

--lh-display:.92; --lh-h:1.08; --lh-body:1.72;
--ls-display:-.03em; --ls-h:-.015em; --ls-label:.14em;
```

### 2.3 间距与栅格

```css
--sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px;
--sp-6:32px; --sp-7:48px; --sp-8:64px; --sp-9:96px; --sp-10:128px;

--gutter:clamp(20px,4vw,64px);
--max-w:1560px;
--col:12;
--col-gap:clamp(16px,1.6vw,24px);
--section-y:clamp(72px,10vh,160px);

--radius:0; --radius-pill:999px;
```

### 2.4 层级与动效

```css
--z-sky:0; --z-content:10; --z-masthead:50; --z-drawer:80; --z-modal:90; --z-toast:100;

--ease-out:cubic-bezier(.16,1,.3,1);
--ease-in-out:cubic-bezier(.65,0,.35,1);
--dur-fast:120ms; --dur-base:240ms; --dur-slow:700ms; --dur-sky:900ms;
```

---

## 3. 栅格与版面

- 12 栏，`max-width: 1560px`，margin `--gutter`。
- 内容区常用三种跨栏：
  - **全幅**（100vw）：天幕、地图、时间轴舞台。
  - **8 栏**（内容主区）：标题、正文、表格。
  - **4 栏**（仪器轨）：分数、图例、元信息。
- 垂直节奏：section 之间 `--section-y`；section 内模块间距 `--sp-7`；模块内 `--sp-4`。
- 基线：8px 网格，所有 margin/padding 取 4 的倍数。

---

## 4. 组件规范

### 4.1 Masthead（顶栏）

| 属性 | 规格 |
|---|---|
| 高度 | 72px（移动 56px） |
| 状态 | 顶部：透明；滚动 >120px：`background:rgba(6,5,14,.72); backdrop-filter:blur(18px) saturate(1.2)` + 1px bottom line |
| 品牌 | 32px 印章（`--ember` 底，cream 字，radius 0）+ 字标（13px mono 字距 .14em） |
| 导航 | 11px mono，编号 + 中文；active 时下方 1px ember 短线（宽 16px） |
| 右侧动作 | 搜索（240px，点击展开为 ⌘K 面板）、收藏、分享；图标 20px，1.5px stroke |
| 焦点 | `outline:1px solid var(--gold); outline-offset:3px` |

### 4.2 按钮

| 变体 | 样式 | 用途 |
|---|---|---|
| Primary | `--ember` 底 + `--ink-900` 字，高 48px，padding 0 28px，radius 999 | 每页最多 1 个（进入城市页 / 查看观景点） |
| Ghost | 透明 + 1px `--line-strong` + cream 字 | 次级动作（分享、切换） |
| Text | 无边框，下划线 1px 在 hover 时从 0→100% 展开 | 行内跳转 |
| Icon | 40×40，无底，hover 时 `background:rgba(246,239,230,.06)` | 顶栏动作 |

状态：hover 亮度 +8%，active 缩放 `scale(.98)`，disabled `opacity:.35` + `cursor:not-allowed`。

### 4.3 Chip / Tag

- 高度 28px，padding 0 12px，radius 999，1px `--line`，11px mono 大写。
- 有数值时：`把握 高` / `通透 22` / `51 成员` —— 标签用 `--veil`，数值用 `--cream`。
- 语义色仅用于等级：`--lv{n}` 作为左侧 2px 竖条，不改变底色。

### 4.4 Score Block（分数块）

```
┌ 分数 120–200px，mono 600，tabular-nums，色 = --lv{n}
├ 单位 /100（14px mono，--veil，与数字基线下沉 12px）
├ 等级词（display serif 900，28px，cream）
└ 色阶环（可选）：3px 弧线，总长 100%，已得分部分用等级色
```

规则：分数与等级词必须在同一视觉组内（间距 ≤ 8px），不得被装饰字分隔。

### 4.5 Level Bar（等级色条）

- 高 2px，宽 100%，底 `--line`，前景=等级色，前景宽度 = 分数%。
- 用于事件卡、榜单行、地图图例。
- 大烧（≥80）时：前景额外 `filter:drop-shadow(0 0 8px rgba(255,195,107,.45))`。

### 4.6 Event Card（四场卡）

- 尺寸：桌面 4 等分（每张 ≈ 340×220），移动 78vw 横滑。
- 结构：`时段编号+名称` → `时刻` → `分数` → `等级色条` → `一句理由`。
- 选中：顶部 2px ember 线 + 背景 `--ink-800` + 分数放大 1.06。
- 未选中：背景透明 + 1px line。

### 4.7 Timeline Scrubber（时间轴）

- 轨道高 56px，150 格（每格 1px 空隙）。
- 每格：`2px` 宽竖条，高度按该时刻霞强度（8–48px），颜色按强度映射色阶。
- 三段底色（蓝调/火烧/金色）：在轨道后铺 24px 高的半透明色带，标签在带内左对齐。
- 游标：2px ember 竖线 + 顶部 8px 三角。
- 焦点：整条轨道 `tabindex=0`，`←→` 移动 1 格，`shift+←→` 移动 10 格。

### 4.8 Profile Row（十一项因素行）

| 列 | 宽 | 内容 |
|---|---|---|
| 高度徽标 | 96px | `8.6 km` mono 11px，右对齐 |
| 因素名 | 180px | 中文 + 英文小标 |
| 得分条 | 1fr | 0–100，宽度=得分 |
| 权重 | 72px | `×0.5`，`--veil` |
| 状态 | 96px | `无数据` / `已退出加权` |

门控三项（幕布/缺口/低云）得分条用 ember，其余用 `--mist`。

### 4.9 Data Table

- 表头：11px mono 大写，`--veil`，下边框 1px `--line-strong`。
- 行高 52px，行间 1px `--line`；hover 行背景 `rgba(246,239,230,.03)`。
- 数字列右对齐；单位在表头里，不在单元格里。
- 移动端：转为 2 列 label/value 堆叠，不横向滚动。

### 4.10 Map Dot（城市点）

- 直径：`10 + score/12` px（10–18px）。
- 填充：等级色，透明度 `.9`；≥65 加 `drop-shadow(0 0 12px color)`。
- 标签：11px mono，仅在 hover / TOP5 常显。
- 命中态：外圈 1px 白色 + 直径 +4px。

### 4.11 Drawer / Sheet

- 桌面：右侧 420px 宽，全高，`--ink-800`，左侧 1px line，滑入 320ms。
- 移动：底部上滑，高度 78vh，顶部 4px 拖拽条（`--line-strong`）。
- 遮罩：`rgba(6,5,14,.6)` + `backdrop-filter: blur(2px)`。

### 4.12 Skeleton

- 底色 `--ink-700`，扫光 `linear-gradient(90deg, transparent, rgba(246,239,230,.06), transparent)`，1.4s 循环。
- 数字占位用 `--` 而非骨架块（保留版面尺寸）。

---

## 5. 数据可视化规范

全站图表共享一套「刻度语法」：

1. **轴**：1px `--line`，刻度线长 4px，标签 10px mono `--veil`。
2. **网格**：仅在需要读数时出现（如剖面图），`rgba(246,239,230,.06)` 虚线 1px。
3. **数值标注**：一律在图形外侧、右对齐，不与图形重叠。
4. **零基线**：柱状图必须有零基线；折线图不必。
5. **色阶唯一来源**：分数的颜色永远来自 `--lv0..lv5`，不允许自定义。
6. **空数据**：空心 1px 虚线 + 「无数据」，不用灰色实心块（会被误读为 0 分）。
7. **动画**：图表首次入场从 0 生长（600ms），此后不再动画。

---

## 6. 图标系统

- 24×24 viewBox，stroke 1.5px，`stroke-linecap:round`，无填充（除 logo）。
- 必备集合（14 个）：search、locate、star、share、arrow-right、arrow-left、chevron-down、play、pause、sun、sunrise、sunset、cloud、clock。
- 禁止混用不同来源的图标库（线性风格必须统一）。

---

## 7. 无障碍基线

| 项 | 要求 |
|---|---|
| 正文对比度 | ≥ 4.5:1；大字号（≥24px/900）≥ 3:1。在照片上必须加遮罩保证 |
| 焦点可见 | 所有可交互元素 `:focus-visible` 有 1px gold 描边 + 3px offset |
| 键盘 | 时间轴、地图点、榜单行全部可 Tab 到达；`Esc` 关闭抽屉 |
| 语义 | 图表必须有 `<figcaption>` 或 `aria-label` 描述结论（不只是「图表」） |
| 动效 | 尊重 `prefers-reduced-motion` |
| 触控 | 可点区域 ≥ 44×44px |
| skip link | 保留现有 |

---

## 8. 响应式规则

| 断点 | 变化 |
|---|---|
| < 480 | 单栏、底 tab bar、分数 96px、天幕 60vh、图表转列表 |
| 480–767 | 单栏 + 卡片横滑 |
| 768–1023 | 6 栏；hero 4/2 分栏；城市页取消 sticky |
| 1024–1439 | 12 栏；启用 sticky 左栏 |
| ≥1440 | 12 栏 + 1560 上限 + 仪器轨 |
| ≥1920 | 天幕与地图出血 100vw |

移动端专属：
- masthead 收为 56px，「霞」+ 当前页名 + 搜索图标。
- 底部 tab bar 3 项（今晚 / 霞榜 / 方法），高度 64px + `env(safe-area-inset-bottom)`。
- 地图支持双指缩放，榜单与地图通过分段控件切换（不并排）。

---

## 9. 技术实现建议（给 Codex）

| 主题 | 建议 |
|---|---|
| 框架 | 纯静态 HTML/CSS/JS 起步；若需路由与状态，用 **Vite + 原生 TS + 轻量路由**（不引 React，减少包体）。若要组件化，用 **Web Components** 或 **Preact（3 KB）** |
| 天幕 | 保留 SVG 滤镜方案，抽成 `SkyRenderer(overrides)`；用 `requestAnimationFrame` 节流到 30fps |
| 图表 | 手写 SVG（数据量小，无需 D3）；坐标映射封装 `scaleLinear` |
| 字体 | 自托管 woff2 子集（`pyftsubset` 按页面字符集切分） |
| 状态 | URL 即状态：`/c/:slug?d=YYYY-MM-DD`、`/board?scope=global` |
| 缓存 | `localStorage` 存最近 5 个城市 + 榜单 JSON（TTL 30min） |
| 性能预算 | 首屏 JS ≤ 90 KB gzip，字体 ≤ 220 KB，LCP < 2.5s（4G） |
| 降级 | 无 JS：静态渲染最近城市的天幕 + 分数（SSG 生成 top 500 城市页） |

---

*下一份：`06-page-specs.md`（逐页逐 Section 规格）*
