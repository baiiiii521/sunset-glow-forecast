# GLOW v3 · React 版（预览）

暮色编辑部（TWILIGHT EDITORIAL）设计方向的 React + Tailwind 重构版。
**算法零复制零修改**：`src/core/glow.js` 直接 import 仓库根的 `algo.js` / `api.js`（Vite 预打包桥接）。

## 启动

```bash
# 1) 同步素材（data 为跑批产物副本、sky 为等级联动天空照片，均不入库）
mkdir -p public/data public/sky
cp ../data/rankings.json ../data/rankings-all.json ../data/snapshots.json ../data/world-cities.json ../data/points-china.json public/data/
cp ../v2/assets/img/sky/*.jpg public/sky/

# 2) 安装依赖并启动（端口 5180）
npm install
npm run dev        # http://127.0.0.1:5180
npm run build      # 生产构建到 dist/
```

## 结构

- `src/core/glow.js` — 算法桥接（@core/algo、@core/api 别名见 vite.config.js）+ 六级色阶 + 天空图映射
- `src/core/useWeekly.js` — v2 forecast.js 的等价移植（7 天 × 朝晚完整集合评分，只调 api 公开接口）
- `src/pages/` — Home（Hero/太阳轨迹/48h/时间轴/剖面/简介）、Board（点阵地图/双榜/分布/索引）、City（今天/七天矩阵/云层/模式）
- 设计规范：`../design-system/xaguang/`（MASTER.md + pages/ + BASELINE.md 功能基线）

## 与 v2 的关系

v3 是平行预览版，不替换线上 v2 页面；上线需所有者决定（静态托管 dist/ 即可，无需服务器改动）。
