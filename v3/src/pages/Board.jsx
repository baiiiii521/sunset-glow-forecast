import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { api, lvColor, loadJSON } from '../core/glow.js'
import Reveal from '../components/Reveal.jsx'

const LV_NAMES = ['无烧', '微烧', '小烧', '小到中烧', '中到大烧', '大烧']

/* ---------------- 点阵地图（等距圆柱投影，无轮廓依赖） ---------------- */
function DotMap({ items, scope }) {
  const navigate = useNavigate()
  const [tip, setTip] = useState(null)
  const isCN = scope === 'china'
  const box = isCN ? { lat0: 18, lat1: 54, lon0: 73, lon1: 135, w: 1000, h: 880 } : { lat0: -60, lat1: 84, lon0: -180, lon1: 180, w: 1000, h: 470 }
  const px = (lon) => ((lon - box.lon0) / (box.lon1 - box.lon0)) * box.w
  const py = (lat) => ((box.lat1 - lat) / (box.lat1 - box.lat0)) * box.h

  const grid = useMemo(() => {
    const pts = []
    const stepLon = isCN ? 2 : 10
    const stepLat = isCN ? 2 : 10
    for (let lat = box.lat0; lat <= box.lat1; lat += stepLat)
      for (let lon = box.lon0; lon <= box.lon1; lon += stepLon) pts.push([px(lon), py(lat)])
    return pts
  }, [isCN])

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${box.w} ${box.h}`} className="w-full" role="img"
        aria-label={isCN ? '中国城市霞分点阵图' : '世界城市霞分点阵图'}>
        {grid.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.6" fill="rgba(246,239,230,.09)" />
        ))}
        {items.map((r, i) => (
          <circle
            key={r.city.name + i}
            cx={px(r.city.lon)}
            cy={px(r.city.lat)}
            r={i < 3 ? 7 : i < 10 ? 5 : 3.5}
            fill={lvColor(r.level)}
            fillOpacity=".92"
            stroke={lvColor(r.level)}
            strokeOpacity=".35"
            strokeWidth={i < 3 ? 4 : 2}
            className="cursor-pointer transition-[fill-opacity] duration-200 hover:fill-opacity-100"
            onMouseEnter={() => setTip({ x: px(r.city.lon) / box.w, y: py(r.city.lat) / box.h, r })}
            onMouseLeave={() => setTip(null)}
            onClick={() =>
              navigate(`/city?lat=${r.city.lat}&lon=${r.city.lon}&name=${encodeURIComponent(r.city.name)}&country=${encodeURIComponent(r.city.country || '')}`)
            }
          />
        ))}
      </svg>
      {tip && (
        <div
          className="label pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[130%] whitespace-nowrap border border-line-strong bg-ink-900/95 px-3 py-1.5 !text-cream"
          style={{ left: `${tip.x * 100}%`, top: `${tip.y * 100}%` }}
        >
          {tip.r.city.name} · <span style={{ color: lvColor(tip.r.level) }}>{Math.round(tip.r.score)}</span>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-4">
        {LV_NAMES.map((n, i) => (
          <span key={n} className="label flex items-center gap-2">
            <i className="inline-block h-2 w-2 rounded-full" style={{ background: lvColor(i) }} /> {n}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ---------------- 榜单行 ---------------- */
function RankRow({ r, rank }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="data-row w-full cursor-pointer text-left transition-colors duration-150 hover:bg-ink-700/50"
      onClick={() =>
        navigate(`/city?lat=${r.city.lat}&lon=${r.city.lon}&name=${encodeURIComponent(r.city.name)}&country=${encodeURIComponent(r.city.country || '')}`)
      }
    >
      <span className="label w-8 shrink-0">{String(rank).padStart(2, '0')}</span>
      <span className="min-w-0 flex-1 truncate text-[15px] text-cream">
        {r.city.name}
        <i className="label ml-2 hidden !text-[10px] not-italic sm:inline">{r.city.country}</i>
      </span>
      {r.models && r.models.length < 4 && <span className="label !text-ember">单模式</span>}
      <span className="text-xs text-veil">{r.grade}</span>
      <span className="serif-num w-10 text-right text-xl" style={{ color: lvColor(r.level) }}>
        {Math.round(r.score)}
      </span>
    </button>
  )
}

/* ---------------- 页面 ---------------- */
export default function Board() {
  const [data, setData] = useState(null)
  const [all, setAll] = useState(null)
  const [scope, setScope] = useState('global')
  const [q, setQ] = useState('')
  const [error, setError] = useState(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    loadJSON('/data/rankings.json').then(setData).catch((e) => setError(String(e?.message || e)))
    loadJSON('/data/rankings-all.json').then(setAll).catch(() => setAll(null))
  }, [])

  if (error)
    return (
      <div className="mx-auto max-w-[560px] px-5 py-32 text-center text-sm text-mist">
        榜单数据加载失败：{error}
      </div>
    )
  if (!data)
    return <div className="label flex items-center justify-center py-32">正在读取今日霞榜…</div>

  const stale = Date.now() - data.computedAt > 26 * 3600 * 1000
  const list = data[scope] || []
  const meta = data.universe ? `${data.universe.refined} 城精算` : ''
  const cn = data.china || []
  const gl = data.global || []
  const counts = data.stats?.[scope]?.counts || [0, 0, 0, 0, 0, 0]
  const maxCount = Math.max(1, ...counts)
  const idx = (all?.china || all || [])
  const idxHits = q.trim()
    ? idx.filter((r) => {
        const s = q.trim()
        return r.city?.name?.includes(s) || r.city?.country?.includes(s) || String(r.city?.name || '').toLowerCase().includes(s.toLowerCase())
      }).slice(0, 12)
    : []

  return (
    <div className="pt-16">
      {stale && (
        <div className="flex items-center justify-center gap-2 border-b border-line bg-twilight-600/40 px-4 py-2.5 text-xs text-gold">
          <AlertTriangle size={13} /> 榜单数据已超过一天未更新，以下为最近一次成功跑批的结果
        </div>
      )}

      {/* head */}
      <section className="mx-auto max-w-[1440px] px-5 pb-4 pt-14 md:px-14 md:pt-20">
        <div className="label">BOARD / 霞榜</div>
        <h1 className="font-display mt-4 text-[clamp(38px,5.5vw,72px)] font-black leading-[1.05] tracking-tight text-cream">
          今天，哪里最可能烧。
        </h1>
        <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
          <div className="flex" role="tablist" aria-label="榜单范围">
            {[
              ['global', '全球'],
              ['china', '中国'],
            ].map(([k, lab]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={scope === k}
                onClick={() => setScope(k)}
                className={
                  'label cursor-pointer rounded-full border px-6 py-2.5 transition-all duration-200 ' +
                  (scope === k ? 'border-gold !text-gold' : 'border-line !text-veil hover:border-line-strong hover:!text-cream')
                }
              >
                {lab}
              </button>
            ))}
          </div>
          <div className="text-right">
            <div className="label">{new Date(data.computedAt).toLocaleString('zh-CN', { hour12: false })} 更新</div>
            <div className="label mt-1 !text-[10px]">{meta} · 每城按本地日落计算</div>
          </div>
        </div>
      </section>

      {/* map + top10 */}
      <section className="mx-auto max-w-[1440px] px-5 py-[clamp(48px,6vh,90px)] md:px-14">
        <Reveal>
          <div className="grid gap-10 lg:grid-cols-[minmax(280px,420px)_1fr]">
            <div>
              <div className="label mb-4 border-b border-line-strong pb-3">TOP 10 · {scope === 'china' ? '中国' : '全球'}</div>
              {list.map((r, i) => (
                <RankRow key={r.city.name + i} r={r} rank={i + 1} />
              ))}
            </div>
            <div className="card p-5 md:p-8">
              <DotMap items={list} scope={scope} />
              <div className="label mt-4 !text-[10px]">点按城市进入七天预报 · 位置为等距圆柱投影</div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* dual */}
      <section className="mx-auto max-w-[1440px] px-5 py-[clamp(48px,6vh,90px)] md:px-14">
        <Reveal>
          <div className="mb-10 max-w-[520px]">
            <div className="label">02 — DUAL / 双榜</div>
            <h2 className="font-display mt-3 text-[clamp(28px,3.4vw,42px)] font-bold leading-tight text-cream">
              同一时刻，两个尺度。
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-veil">
              左边看自己国家，右边看世界。分数不可跨榜直接比——每城都按本地日落算。
            </p>
          </div>
          <div className="grid gap-10 md:grid-cols-2">
            {[
              ['中国 TOP 5', cn, data.stats?.china?.counts],
              ['全球 TOP 5', gl, data.stats?.global?.counts],
            ].map(([title, arr]) => (
              <div key={title}>
                <div className="mb-2 flex items-center justify-between border-b border-line-strong pb-3">
                  <span className="label">{title}</span>
                  <span className="label !text-[10px]">{arr.length} 城在榜</span>
                </div>
                {arr.slice(0, 5).map((r, i) => (
                  <RankRow key={r.city.name + i} r={r} rank={i + 1} />
                ))}
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* distribution */}
      <section className="mx-auto max-w-[1440px] px-5 py-[clamp(48px,6vh,90px)] md:px-14">
        <Reveal>
          <div className="mb-10 max-w-[520px]">
            <div className="label">03 — DISTRIBUTION / 分布</div>
            <h2 className="font-display mt-3 text-[clamp(28px,3.4vw,42px)] font-bold leading-tight text-cream">
              今天有多少城市有戏。
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-veil">按等级统计计入榜单的城市数。大多数日子，无烧才是常态。</p>
          </div>
          <div className="card p-6 md:p-10">
            {counts.map((c, i) => (
              <div key={i} className="mb-5 grid grid-cols-[110px_1fr_48px] items-center gap-4 last:mb-0">
                <span className="label flex items-center gap-2">
                  <i className="inline-block h-2 w-2 rounded-full" style={{ background: lvColor(i) }} />
                  {LV_NAMES[i]}
                </span>
                <span className="h-[6px] bg-line">
                  <motion.i
                    className="block h-full"
                    style={{ background: lvColor(i) }}
                    initial={reduce ? { width: `${(c / maxCount) * 100}%` } : { width: 0 }}
                    whileInView={{ width: `${(c / maxCount) * 100}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                  />
                </span>
                <span className="serif-num text-right text-lg text-mist">{c}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* index */}
      <section className="mx-auto max-w-[1440px] px-5 py-[clamp(48px,6vh,90px)] md:px-14">
        <Reveal>
          <div className="mb-10 max-w-[520px]">
            <div className="label">04 — INDEX / 索引</div>
            <h2 className="font-display mt-3 text-[clamp(28px,3.4vw,42px)] font-bold leading-tight text-cream">
              找不到你的城市？
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-veil">输入中文名或省份，从精算过的城市里挑一个，直接进七天预报。</p>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            placeholder="例如：南阳 / 河南 / 成都"
            aria-label="搜索精算城市"
            className="w-full max-w-[520px] border border-line bg-ink-800 px-5 py-4 text-[15px] text-cream outline-none transition-colors duration-200 placeholder:text-veil focus:border-line-strong"
          />
          {idxHits.length > 0 && (
            <div className="mt-4 max-w-[520px] border border-line">
              {idxHits.map((r, i) => (
                <RankRow key={i} r={r} rank={i + 1} />
              ))}
            </div>
          )}
        </Reveal>
      </section>
    </div>
  )
}
