/* 桥接层：直接引用仓库根部的原生算法（algo.js / api.js）。
 * 两个文件一个字都不改——它们同时服务线上 v2 页面与跑批脚本，
 * React 版通过 import 共享同一份计算逻辑，保证口径一致。 */
import '@core/algo'
import api from '@core/api'

export { api }
export const algo = (typeof globalThis !== 'undefined' && globalThis.SunsetAlgo) || null

/* 六级霞光色阶（与 design-system MASTER.md / 算法六档一一对应） */
export const LV_COLORS = ['#6E6A80', '#8C7BB8', '#FF7E8B', '#FF9F45', '#FF5A1F', '#FFC36B']
export const lvColor = (level) => LV_COLORS[Math.max(0, Math.min(5, level ?? 0))]

/* 天空照片按「等级 × 场次」联动（真实摄影素材，v2/assets/img/sky 同源副本） */
export const skyImage = (level, kind /* 'dawn' | 'dusk' */) =>
  `/sky/H01_hero_sky_L${Math.max(0, Math.min(5, level ?? 0))}_${kind === 'dawn' ? 'dawn' : 'dusk'}_v01.jpg`

/* 事件类型 → 中文（与 v2 文案统一） */
export const KIND_LABEL = { sunset: '晚霞', sunrise: '朝霞' }

/* 加载本地数据（跑批产物副本，v3/public/data） */
export async function loadJSON(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  return r.json()
}
