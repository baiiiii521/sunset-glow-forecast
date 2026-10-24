# 09 · Codex 开发交接（PHASE 07-C）

> 目标：让另一个 agent（Codex / Claude Code）在不问人的情况下，按这份文档把 5 个页面实现出来，并保持与参考图一致。

---

## 1. 开工前必读（顺序）

1. `02-product-brief.md` §5 能力真值表 —— 决定哪些 UI 可以点亮。
2. `05-design-system.md` —— 所有 token 直接抄。
3. `06-page-specs.md` —— 逐 section 的七项规格。
4. `07-image-index.md` —— 图片与 section 的对应关系。
5. `render/` 里的 HTML —— 这就是「布局的真相」，比文字描述更准。

**不要做的事**：不要引入 Tailwind/React 重写视觉；不要用图片代替可直接实现的布局；不要新增页面；不要给未实现的数据编造数值。

---

## 2. 实现顺序（按依赖，不按页码）

| 阶段 | 内容 | 产出 | 验收 |
|---|---|---|---|
| 0 | 设计 token 落地 | `src/styles/tokens.css` | 与 `05` 数值 1:1，`--lv0..lv5` 可用 |
| 1 | 字体自托管 | `public/fonts/*.woff2` + `fonts.css` | 断网仍显示宋体/等宽，无 Google 请求 |
| 2 | 天幕渲染器 | `src/sky/renderer.ts` | 输入 `{score, sunElev, clouds{aod}}`，输出天幕；切换 900ms |
| 3 | 壳层 | Masthead + 底部 tab（移动）+ ⌘K 面板 | 滚动 120px 转毛玻璃；⌘K 可搜中/英/拼音 |
| 4 | P01 今晚 | 8 个 section | 3 秒可读；时间轴可拖动；剖面 11 行 |
| 5 | P02 城市 | 6 个 section | URL 可分享；7 日矩阵可切日 |
| 6 | P03 霞榜 | 5 个 section | 地图点与榜单双向联动 |
| 7 | 收尾 | 分享卡 / OG / sitemap / 空态 / 错误态 | 见 §8 |

> 先把 P01 做到「能发给朋友看」，再做其余。不要并行铺 3 个页面。

---

## 3. 页面 ↔ 组件映射

```
components/
  shell/Masthead.ts            01-01
  shell/CommandPalette.ts      ⌘K（城市/拼音/坐标/收藏）
  shell/TabBar.ts              移动端 3 项

  sky/SkyRenderer.ts           天幕（全局，被 01-02 / 01-04 / 02-05 / 03-03 复用）
  sky/CloudDeck.ts             SVG 三层云 + 上游采样  02-03
  sky/Timeline.ts              01-04（含游标与键盘）

  data/ScoreBlock.ts           分数 + 单位 + 等级词（所有页面）
  data/LevelBar.ts             2px 等级色条
  data/FactorRow.ts            01-05 / 05-03
  data/Consensus.ts            02-04（点阵 + 分布）
  data/Sequence.ts             02-05（8 格天幕）

  board/Ranking.ts             03-03
  board/WorldMap.ts            03-02（含晨昏线）
  board/Inspector.ts           03-05（抽屉/sheet）

  brief/AlgorithmBrief.ts      01-07（三段话 + 数字 + 误判案例）
```

---

## 4. Token 注入（可直接粘贴）

```css
:root{
  --ink-900:#06050E; --ink-800:#0B0918; --ink-700:#120E26;
  --twilight-600:#1B1140; --twilight-500:#2A1A55;
  --cream:#F6EFE6; --mist:rgba(246,239,230,.62); --veil:rgba(246,239,230,.38);
  --line:rgba(246,239,230,.10); --line-strong:rgba(246,239,230,.22);
  --ember:#FF5A1F; --gold:#FFC36B; --rose:#FF7E8B; --plasma:#B14BFF;
  --lv0:#6E6A80; --lv1:#8C7BB8; --lv2:#FF7E8B; --lv3:#FF9F45; --lv4:#FF5A1F; --lv5:#FFC36B;
  --font-display:'Noto Serif CJK SC','Songti SC',serif;
  --font-body:Inter,'PingFang SC',system-ui,sans-serif;
  --font-mono:'JetBrains Mono',ui-monospace,monospace;
  --gutter:clamp(20px,4vw,64px); --max-w:1560px;
  --ease:cubic-bezier(.16,1,.3,1);
}
```

色阶函数（必须统一）：

```ts
export const levelColor = (score:number) =>
  score>=80?'var(--lv5)':score>=65?'var(--lv4)':score>=50?'var(--lv3)':
  score>=35?'var(--lv2)':score>=20?'var(--lv1)':'var(--lv0)';
```

---

## 5. 数据接口（与现有 algo.js / api.js 对齐）

| UI | 字段 | 来源 |
|---|---|---|
| 分数 / 等级 / 把握 | `score` `grade` `conf` | `algo.evaluate()` |
| 最佳窗口 | `sunsetEpoch ± 30min`，峰值由 `peakOffsetMin` 修正 | `api.scoreEvent()` |
| 方位 | `bearing` | `algo.sunsetBearing()` |
| 六档 | `LEVELS`（20/35/50/65/80） | `algo.LEVELS` |
| 剖面 11 项 | `inputs.*` + `comps.*` | `evaluate()` |
| 四模式 | `ensemble.members[]` | `combine()` |
| 51 成员 | `ensemble51.{p10,p50,p90,p_burn}` | `fetchEnsemble()` |
| 通透度 | `clarity.{level,name,score}` | `clarityOf()` |
| 最红时刻 | `illuminationLimit()` → `+1..9 min` | `algo` |
| 颜色名 | `colorNameRgb()` | `algo` |
| 榜单 | `rankings.{china,global}` `stats` | `data/rankings.json` |
| 观景点 / 成绩单 | ⛔ 已砍掉 | 不实现，不要在 UI 里出现入口 |

**禁止**：前端自己重算霞分。一律走 `algo.js`，保证与推送同源。

---

## 6. 动效实现要点

```js
// 天幕切换：只改渐变 stop，不重建噪声（性能关键）
sky.transition({ a, b, c, cov }, { duration: 900, easing: 'cubic-bezier(.16,1,.3,1)' });

// 时间轴拖动：requestAnimationFrame 节流到 30fps
scrub.on('input', () => rafThrottle(() => sky.setSunElev(degFromSlider(v))));

// 滚动入场：IntersectionObserver，一次性
io.observe(el) → el.animate([{opacity:0, transform:'translateY(24px)'},{opacity:1,transform:'none'}],
  {duration:700, easing:'cubic-bezier(.16,1,.3,1)', fill:'both', delay:i*60});

// 视差：最大 8%
sky.style.transform = `translate3d(0,${scrollY*0.08}px,0)`;

// 减弱动效
if (matchMedia('(prefers-reduced-motion: reduce)').matches) { /* 关视差、关 stagger、天幕 200ms 淡入 */ }
```

**页面切换**用 View Transitions API，天幕做共享元素（`view-transition-name: sky`）。

---

## 7. 重新生成参考图（如需改设计）

```bash
# 渲染源在 docs/design/render/，每个页面一个 HTML，内含多个 .stage
# 用 Chrome + CDP 逐 stage 截图：
#   1) 打开 file://.../render/p01.html
#   2) window.show('p01-02')
#   3) Page.captureScreenshot clip={x:0,y:0,width:1440,height:810,scale:1.7778}
#   4) 存到 docs/design/references/p01-02_hero-verdict.png
```

注意：
- 每页 HTML 里的 `window.show(id)` 是唯一的切换入口。
- 03 页的地图点是 JS 计算定位的，切换后必须再调 `drawDots()`。
- 字体在渲染时走 Google Fonts + 本机 Noto Serif CJK SC；“Noto Serif SC” 的 `document.fonts.check` 可能返回 false，属正常（回退到本机 Black）。

---

## 8. 交付前检查清单

- [ ] 5 个页面可直达、可分享、可刷新（URL 即状态）
- [ ] 中文 / 英文 / 拼音 / 经纬度 四种搜索都能命中
- [ ] 首屏 3 秒读到：分数、等级、最佳窗口、方位、把握
- [ ] 六档颜色与 `LEVELS` 完全一致（含边界 20/35/50/65/80）
- [ ] 所有 ⛔ 功能在 UI 上有「待实现/示意」标记
- [ ] `prefers-reduced-motion` 生效
- [ ] 键盘可完成：切城市、拖时间轴、开关抽屉
- [ ] 对比度：正文 ≥4.5:1，照片上文字有遮罩
- [ ] 首屏无 Google Fonts 请求；LCP < 2.5s（4G 模拟）
- [ ] **地图底图必须换成合规数据**：含台湾岛、南海诸岛、九段线，带审图号；参考图用的 Natural Earth 110m 仅供内部设计，**不可上线**
- [ ] og:image 1200×630 自动生成；sitemap 含全部城市页
- [ ] 失败案例页用的是真实照片与真实数字（`data/obs/2026-10-23_hcm_1744.jpg`）

---

## 9. 与现状代码的关系

| 现状 | 处理 |
|---|---|
| `index.html` 单页 | 拆成 5 个路由页；P01 保留现有 section 顺序，但重构 DOM |
| `styles.css`（28 KB 单文件） | 拆为 `tokens.css` / `base.css` / `components/*.css` |
| `app.js`（49 KB 单文件） | 拆为 `sky/` `data/` `board/` `spots/` `shell/` |
| `algo.js` / `api.js` | **不动**，作为唯一算法源被 import |
| `data/rankings.json` | 不动，构建时预取 |
| `scripts/daily-push.js` | 不动；改的是前端展示层 |

**一句话**：算法与数据不动，只重做「怎么让人看懂这一片天色」。
