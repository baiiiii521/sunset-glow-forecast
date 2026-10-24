# GLOW · Home（/ 今晚）页面规范 — 继承 MASTER.md

## Section 编排（从上到下）

1. **HERO（第一屏，全出血）**
   - 背景：等级联动天空照片（交叉淡化 900ms）+ 底部 75% ink-900 渐变；aurora 只在照片暗角
   - 地点行：mono 小字「此地 + 地名 / 国家」+ 收藏 + 分享 icon 按钮
   - 场次词：Display 特大（「今晚」「明晨」按最近场次），右上角 mono 标注场次英文（TONIGHT / DAWN）
   - 霞分：数据特大衬线数字 + 等级色 + 「GLOW」mono 单位 + 2px 0-100 条
   - verdict：一句话结论 + why 弱化从句
   - 数据排（横排 3-4 格，mono label + 衬线数值）：时间窗 / 日落时刻 / 方位角 / 把握
   - chips：把握 / 通透度 / 降水概率 / 单模式警示（等级色描边 pill）
   - CTA：分享卡片（ghost）+ 看霞榜（primary ember）
2. **SUN PATH + MODELS**：太阳高度轨迹 SVG（当前场次高亮点）+ 四模式小卡（分数色点）
3. **48H RAIL**：四场横排卡（今晚/明晨/明晚/后晨），等级色左边条 + 分数 + 时间窗；选中态 ink-700 底 + line-strong 边；键盘方向键可切
4. **SKY TIMELINE**：可拖时间轴 ±2.5h；拖动时天色（照片透明度+色温遮罩）、太阳高度、霞强度、阶段名实时变；←→ 2 分钟步进、Shift ×10、空格播放/暂停；mono 读数行
5. **ATMOSPHERE PROFILE**：大气剖面表——每行：高度（mono）/ 因素名 / 得分条（等级色）/ 权重 / 分值；底部合计 = 霞分；左侧 12km→0m 纵轴刻度
6. **BRIEF（算法简介锚点 #brief）**：编辑部式两栏——左 Display 大字理念，右三段说明 + 数据来源 mono 行
7. **Footer**（全局共享）

## 特殊规则

- Hero 数据未加载时：数字位显示 `--`，verdict「正在拉取预报…」，不显示照片闪烁（先 ink-900 底）
- 失败态：verdict 显示错误一句话 + 重试按钮；不白屏
- 移动端：数据排改 2×2；rail 横向滚动（scroll-snap）；timeline 拖动区高 64px
- 锚点 #brief 平滑滚动（prefers-reduced-motion 时跳变）
