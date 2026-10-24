import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Share2, Star, RotateCw, ArrowRight, Play, Pause } from 'lucide-react'
import { api, lvColor } from '../core/glow.js'
import { useWeekly, fourEvents } from '../core/useWeekly.js'
import { readSavedPlace, savePlace, nextEvent } from '../core/useGlow.js'
import SkyPhoto from '../components/SkyPhoto.jsx'
import Reveal from '../components/Reveal.jsx'
import { ScoreDial, GradeChip } from '../components/ScoreBlock.jsx'

const DEFAULT_PLACE = { name: '胡志明市', country: '越南', lat: 10.82, lon: 106.63 }

const WORD = {
  'today|sunrise': '今晨',
  'today|sunset': '今晚',
  'tomorrow|sunrise': '明晨',
  'tomorrow|sunset': '明晚',
}

/* ---------------- Hero ---------------- */
function Hero({ place, w, onShare, onFav, fav }) {
  const reduce = useReducedMotion()
  const events = w ? fourEvents(w) : []
  const hero = nextEvent(events)
  const offset = w?.offsetSec || 0
  const tz = w?.tzName || ''
  const kind = hero?.type === 'sunrise' ? 'dawn' : 'dusk'

  return (
    <section className="relative flex min-h-[100svh] flex-col justify-end overflow-hidden" aria-label="今晚霞预报">
      <SkyPhoto level={hero?.level ?? null} kind={kind} />
      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-5 pb-16 pt-32 md:px-14 md:pb-24">
        {/* 地点行 */}
        <div className="mb-8 flex items-center gap-4">
          <span className="label !text-[13px] !tracking-[0.25em] text-cream/90" style={{ textShadow: '0 1px 12px rgba(6,5,14,.85)' }}>
            此地 · {place.name}{place.country ? ` / ${place.country}` : ''}
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" className="icon-btn" aria-label="收藏此地" onClick={onFav}>
              <Star size={15} strokeWidth={1.7} fill={fav ? 'currentColor' : 'none'} className={fav ? 'text-gold' : ''} />
            </button>
            <button type="button" className="icon-btn" aria-label="分享" onClick={onShare}>
              <Share2 size={15} strokeWidth={1.7} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-8">
          <div>
            <div className="mb-3 flex items-baseline gap-4">
              <h1 className="font-display text-[clamp(56px,8vw,104px)] font-black leading-none tracking-tight text-cream">
                {hero ? WORD[`${hero.day}|${hero.type}`] : '今晚'}
              </h1>
              <span className="label">
                {hero ? (hero.type === 'sunset' ? 'SUNSET GLOW' : 'SUNRISE GLOW') : '…'}
              </span>
            </div>
            {hero ? (
              <motion.div initial={reduce ? { opacity: 0 } : { opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
                <ScoreDial score={hero.score} level={hero.level} size="xl" />
                <p className="mt-6 max-w-[640px] text-[17px] leading-relaxed text-cream">
                  <b style={{ color: lvColor(hero.level) }}>{hero.grade}</b>
                  <span className="text-mist"> · {hero.script || ''}</span>
                  {Array.isArray(hero.reasons) && hero.reasons.length > 0 && (
                    <span className="text-veil"> —— {hero.reasons.slice(0, 2).join('，')}</span>
                  )}
                </p>
              </motion.div>
            ) : (
              <div className="serif-num text-[clamp(96px,13vw,178px)] leading-none text-veil">--</div>
            )}
          </div>

          {/* 数据排 */}
          <div className="grid w-full max-w-[520px] grid-cols-2 gap-x-8 gap-y-6 md:w-auto md:grid-cols-4 md:gap-y-8">
            <Fact label={hero?.type === 'sunset' ? 'WINDOW / 时间窗' : 'WINDOW / 时间窗'} nowrap
              value={hero ? (api.viewingWindow(hero.epoch, hero.type === 'sunset', offset, tz) || '--').replace('约 ', '') : '--'} />
            <Fact label={hero?.type === 'sunset' ? 'SUNSET / 日落' : 'SUNRISE / 日出'}
              value={hero ? api.fmtTime(hero.epoch, offset, tz) : '--:--'} />
            <Fact label="BEARING / 方位" value={hero ? `${Math.round(hero.bearing)}°` : '---°'} />
            <Fact label="CONFIDENCE / 把握" value={hero ? hero.conf : '--'} />
          </div>
        </div>

        {/* chips + CTA */}
        <div className="mt-10 flex flex-wrap items-center gap-3">
          {hero && <GradeChip grade={hero.grade} level={hero.level} />}
          {hero?.clarity && (
            <span className="label rounded-full border border-line px-3 py-1 !text-mist">通透 · {hero.clarity.name}</span>
          )}
          {hero && hero.ensemble == null && (
            <span className="label rounded-full border border-line-strong px-3 py-1 !text-ember">单模式估算</span>
          )}
          {hero?.ensemble?.members && (
            <span className="label rounded-full border border-line px-3 py-1 !text-mist">
              {hero.ensemble.n} 模式 · 一致 {hero.ensemble.agreePct}%
            </span>
          )}
        </div>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link to="/board" className="btn btn-primary">
            看今天的霞榜 <ArrowRight size={15} />
          </Link>
          <button type="button" className="btn btn-ghost" onClick={onShare}>
            <Share2 size={14} /> 分享此地
          </button>
        </div>
      </div>
    </section>
  )
}

function Fact({ label, value, nowrap }) {
  return (
    <div>
      <div className="label mb-2">{label}</div>
      <div className={'serif-num text-2xl text-cream md:text-[26px] ' + (nowrap ? 'whitespace-nowrap' : '')}>{value}</div>
    </div>
  )
}

/* ---------------- SUN PATH + MODELS ---------------- */
function SunPath({ w }) {
  const events = w ? fourEvents(w) : []
  const hero = nextEvent(events)
  if (!hero) return null
  const sameDay = events.filter((e) => e.day === hero.day).sort((a, b) => a.epoch - b.epoch)
  const rise = sameDay.find((e) => e.type === 'sunrise')
  const set = sameDay.find((e) => e.type === 'sunset')
  if (!rise || !set) return null
  const t0 = rise.epoch
  const span = set.epoch - rise.epoch
  const x = (e) => ((e - t0) / span) * 100
  const heroX = x(hero.epoch)

  return (
    <section className="mx-auto max-w-[1440px] px-5 py-[clamp(72px,9vh,130px)] md:px-14">
      <Reveal>
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          <div className="card p-6 md:p-10">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="label">SUN PATH / 太阳轨迹</h3>
              <h3 className="label !text-gold">
                {hero.type === 'sunset' ? 'SUNSET' : 'SUNRISE'} {api.fmtTime(hero.epoch, w.offsetSec, w.tzName)}
              </h3>
            </div>
            <svg viewBox="0 0 1000 220" className="w-full" role="img" aria-label="日出至日落的太阳高度轨迹">
              <line x1="0" y1="190" x2="1000" y2="190" stroke="rgba(246,239,230,.22)" strokeWidth="1" />
              <path
                d={`M 0 190 Q ${500 * (x(set.epoch - span / 2) / 100)},-80 1000 190`}
                fill="none"
                stroke="rgba(246,239,230,.28)"
                strokeWidth="1.5"
                strokeDasharray="3 6"
              />
              <path
                d={`M ${x(rise.epoch)} 190 Q ${heroX * 5} ${hero.type === 'sunset' ? -60 : 60} ${x(set.epoch)} 190`}
                fill="none"
                stroke={lvColor(hero.level)}
                strokeWidth="2"
              />
              {[rise, set].map((e, i) => (
                <g key={i}>
                  <circle cx={x(e.epoch) * 10} cy="190" r="4" fill="#6E6A80" />
                  <text x={x(e.epoch) * 10} y="212" fill="rgba(246,239,230,.56)" fontSize="13" textAnchor="middle" fontFamily="JetBrains Mono">
                    {api.fmtTime(e.epoch, w.offsetSec, w.tzName)}
                  </text>
                </g>
              ))}
              <circle cx={heroX * 10} cy={hero.type === 'sunset' ? 60 : 130} r="7" fill={lvColor(hero.level)} />
              <circle cx={heroX * 10} cy={hero.type === 'sunset' ? 60 : 130} r="16" fill="none" stroke={lvColor(hero.level)} strokeOpacity=".4" />
            </svg>
            <div className="mt-4 flex justify-between">
              <span className="label">日出 {api.fmtTime(rise.epoch, w.offsetSec, w.tzName)}</span>
              <span className="label">方位 {Math.round(hero.bearing)}°</span>
              <span className="label">日落 {api.fmtTime(set.epoch, w.offsetSec, w.tzName)}</span>
            </div>
          </div>

          <div className="card p-6 md:p-10">
            <h3 className="label mb-6">MODELS / 模式共识</h3>
            {hero.ensemble?.members?.length ? (
              <div className="flex flex-col">
                {hero.ensemble.members.map((m) => (
                  <div key={m.model} className="data-row">
                    <span className="w-16 text-sm text-mist">{m.label}</span>
                    <span className="serif-num ml-auto text-2xl" style={{ color: lvColor(m.grade ? undefined : undefined) || undefined, }}>
                      <span style={{ color: m.label === '综合' ? lvColor(hero.level) : 'rgba(246,239,230,.74)' }}>
                        {Math.round(m.score)}
                      </span>
                    </span>
                    <span className="label w-14 text-right">{m.grade}</span>
                  </div>
                ))}
                <div className="mt-5 flex flex-wrap gap-2">
                  <span className="label rounded-full border border-line px-3 py-1">极差 {hero.ensemble.spread}</span>
                  <span className="label rounded-full border border-line px-3 py-1">代表 {hero.repModel}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-veil">
                本次为单模式估算（多模式集合数据暂不可用），把握已自动下调。
              </p>
            )}
          </div>
        </div>
      </Reveal>
    </section>
  )
}

/* ---------------- 48H 四场 ---------------- */
function Rail({ w, onPick }) {
  const events = w ? fourEvents(w) : []
  const hero = nextEvent(events)
  const [sel, setSel] = useState(null)
  const cur = sel || hero
  useEffect(() => setSel(null), [w])
  if (!events.length) return null

  return (
    <section className="mx-auto max-w-[1440px] px-5 py-[clamp(72px,9vh,130px)] md:px-14">
      <Reveal>
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="label">02 — 48 HOURS / 四十八小时</div>
            <h2 className="font-display mt-3 text-[clamp(30px,3.6vw,44px)] font-bold leading-tight text-cream">
              48 小时，四场。
            </h2>
          </div>
          <p className="max-w-[380px] text-sm leading-relaxed text-veil">
            今明两天的朝霞与晚霞各算一场。点击一张卡，下面的天色时间轴跟着换。
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="tablist" aria-label="48 小时四场预报">
          {events.map((e, i) => {
            const active = cur && e.epoch === cur.epoch
            return (
              <button
                key={e.day + e.type}
                type="button"
                role="tab"
                aria-selected={!!active}
                onClick={() => {
                  setSel(e)
                  onPick?.(e)
                }}
                className={
                  'card card-hover relative overflow-hidden p-6 text-left cursor-pointer ' +
                  (active ? '!border-line-strong bg-ink-700' : '')
                }
              >
                <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: lvColor(e.level) }} />
                <div className="label mb-4">
                  {WORD[`${e.day}|${e.type}`]} · {e.type === 'sunset' ? '晚霞' : '朝霞'}
                </div>
                <div className="flex items-end justify-between">
                  <span className="serif-num text-[44px] leading-none" style={{ color: lvColor(e.level) }}>
                    {Math.round(e.score)}
                  </span>
                  <span className="text-right">
                    <span className="block text-sm text-mist">{e.grade}</span>
                    <span className="label">{api.fmtTime(e.epoch, w.offsetSec, w.tzName)}</span>
                  </span>
                </div>
                <div className="mt-4 text-xs leading-relaxed text-veil">
                  {api.viewingWindow(e.epoch, e.type === 'sunset', w.offsetSec, w.tzName) || ''}
                </div>
              </button>
            )
          })}
        </div>
      </Reveal>
    </section>
  )
}

/* ---------------- SKY TIMELINE（±2.5h 可拖时间轴，展示层） ---------------- */
function SkyTimeline({ w, event }) {
  const ev = event || (w ? nextEvent(fourEvents(w)) : null)
  const [pos, setPos] = useState(0) // 分钟，相对事件时刻
  const [playing, setPlaying] = useState(false)
  const reduce = useReducedMotion()
  const timer = useRef(null)

  useEffect(() => {
    if (!playing || reduce) return
    timer.current = setInterval(() => {
      setPos((p) => (p >= 150 ? -150 : Math.min(150, p + 2)))
    }, 90)
    return () => clearInterval(timer.current)
  }, [playing, reduce])

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const step = e.shiftKey ? 20 : 2
      if (e.key === 'ArrowLeft') { setPos((p) => Math.max(-150, p - step)); e.preventDefault() }
      else if (e.key === 'ArrowRight') { setPos((p) => Math.min(150, p + step)); e.preventDefault() }
      else if (e.key === ' ') { setPlaying((v) => !v); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ev) return null
  const offset = w.offsetSec
  const tz = w.tzName
  const abs = Math.abs(pos)
  const phase = abs <= 10 ? '核心时刻' : abs <= 30 ? (pos < 0 ? '酝酿' : '收尾') : abs <= 60 ? (pos < 0 ? '天色渐变' : '余晖') : '常态'
  const glow = Math.max(0, Math.round(ev.score * Math.exp(-((pos / 28) ** 2))))
  const t = api.fmtTime(ev.epoch + pos * 60000, offset, tz)
  const skyHue = pos < -60 ? '#1B1140' : pos < -20 ? '#2A1A55' : pos < 0 ? '#FF7E8B' : pos < 20 ? '#FF5A1F' : pos < 60 ? '#B14BFF' : '#0B0918'

  return (
    <section className="mx-auto max-w-[1440px] px-5 py-[clamp(72px,9vh,130px)] md:px-14">
      <Reveal>
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="label">03 — SKY TIMELINE / 天色</div>
            <h2 className="font-display mt-3 text-[clamp(30px,3.6vw,44px)] font-bold leading-tight text-cream">
              拖着时间走，看天色变化。
            </h2>
          </div>
          <button type="button" className="btn btn-ghost !py-2 !px-4" onClick={() => setPlaying((v) => !v)}>
            {playing ? <Pause size={13} /> : <Play size={13} />} {playing ? '暂停' : '播放'}
          </button>
        </div>

        <div className="card overflow-hidden">
          {/* 天色舞台 */}
          <div className="relative h-56 overflow-hidden md:h-72" aria-hidden="true">
            <div className="absolute inset-0 transition-colors duration-300" style={{ background: skyHue }} />
            <div className="absolute inset-0 opacity-40 transition-opacity duration-300"
              style={{ background: `radial-gradient(60% 70% at ${50 + pos * 0.2}% 78%, rgba(255,195,107,${Math.max(0, 0.9 - abs / 90)}) 0%, transparent 70%)` }} />
            <div className="absolute bottom-0 h-24 w-full bg-gradient-to-t from-ink-800 to-transparent" />
            <div className="absolute left-1/2 top-8 -translate-x-1/2 text-center">
              <div className="serif-num text-5xl text-cream drop-shadow-lg md:text-6xl">{t}</div>
            </div>
            <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-8 md:bottom-8">
              <div className="text-center">
                <div className="label mb-1">霞强度</div>
                <div className="serif-num text-xl text-cream">{glow}</div>
              </div>
              <div className="text-center">
                <div className="label mb-1">阶段</div>
                <div className="text-xl text-cream">{phase}</div>
              </div>
              <div className="text-center">
                <div className="label mb-1">场次</div>
                <div className="text-xl text-cream">{ev.type === 'sunset' ? '晚霞' : '朝霞'}</div>
              </div>
            </div>
          </div>

          {/* 轨迹条 */}
          <div className="px-6 pb-8 pt-6 md:px-10">
            <input
              type="range"
              min={-150}
              max={150}
              step={2}
              value={pos}
              onChange={(e) => setPos(Number(e.target.value))}
              aria-label="时间轴（前后各 2.5 小时）"
              aria-valuetext={`${t}，${phase}`}
              className="glow-range w-full"
            />
            <div className="mt-3 flex justify-between">
              <span className="label">−2.5h</span>
              <span className="label">← → 逐格 2 分钟 · Shift 加速 · 空格播放</span>
              <span className="label">+2.5h</span>
            </div>
            <div className="relative mt-6 h-10" aria-hidden="true">
              <div className="absolute inset-x-0 top-4 h-[2px] bg-line" />
              <div
                className="absolute top-4 h-[2px] bg-gradient-to-r from-transparent via-ember to-transparent transition-all duration-150"
                style={{ left: '28%', right: '28%', opacity: Math.max(0.15, 1 - abs / 120) }}
              />
              <div
                className="absolute top-0 h-10 w-[2px] bg-cream transition-all duration-150"
                style={{ left: `calc(${((pos + 150) / 300) * 100}% )` }}
              />
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  )
}

/* ---------------- ATMOSPHERE PROFILE ---------------- */
const FACTOR_ORDER = ['high', 'mid', 'low', 'curtain', 'washed', 'vis', 'aod', 'pm', 'wind', 'cape', 'up', 'rh']
function Profile({ w }) {
  const events = w ? fourEvents(w) : []
  const hero = nextEvent(events)
  if (!hero) return null
  const comps = Object.entries(hero.comps || {}).filter(([, v]) => Array.isArray(v) && v.length >= 2)
  comps.sort((a, b) => {
    const ia = FACTOR_ORDER.findIndex((k) => a[0].includes(k))
    const ib = FACTOR_ORDER.findIndex((k) => b[0].includes(k))
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

  return (
    <section className="mx-auto max-w-[1440px] px-5 py-[clamp(72px,9vh,130px)] md:px-14">
      <Reveal>
        <div className="mb-10">
          <div className="label">04 — ATMOSPHERE / 剖面</div>
          <h2 className="font-display mt-3 text-[clamp(30px,3.6vw,44px)] font-bold leading-tight text-cream">
            从 12 公里高空，一路看到地面。
          </h2>
          <p className="mt-4 max-w-[560px] text-sm leading-relaxed text-veil">
            每个因素给这一场打出的条件分。三层云决定霞能不能烧起来，空气因素只做调制。
          </p>
        </div>
        <div className="card p-6 md:p-10">
          <div className="mb-2 grid grid-cols-[1fr_120px_64px] items-center gap-4 border-b border-line-strong pb-3 md:grid-cols-[1fr_200px_80px]">
            <span className="label">FACTOR / 因素</span>
            <span className="label">SCORE / 条件分</span>
            <span className="label text-right">分值</span>
          </div>
          {comps.map(([key, v]) => {
            const s = Math.max(0, Math.min(100, Math.round(v[0] ?? 0)))
            const missing = v[0] == null
            return (
              <div key={key} className="grid grid-cols-[1fr_120px_64px] items-center gap-4 border-b border-line py-4 md:grid-cols-[1fr_200px_80px]">
                <span className="text-sm text-mist">{v[1] || key}{missing && <i className="label ml-2 !text-[10px] not-italic">缺数据</i>}</span>
                <span className="flex items-center gap-3">
                  <i className="h-[3px] flex-1 bg-line">
                    <i className="block h-full transition-all duration-700" style={{ width: missing ? 0 : `${s}%`, background: s >= 60 ? 'var(--color-lv5)' : s >= 35 ? 'var(--color-lv3)' : 'var(--color-lv0)' }} />
                  </i>
                </span>
                <span className="serif-num text-right text-lg" style={{ color: missing ? 'var(--color-veil)' : 'var(--color-cream)' }}>
                  {missing ? '--' : s}
                </span>
              </div>
            )
          })}
          <div className="mt-6 flex items-center justify-between border-t border-line-strong pt-5">
            <span className="label">GLOW SCORE / 霞分（v2 几何加权）</span>
            <span className="serif-num text-4xl" style={{ color: lvColor(hero.level) }}>
              {Math.round(hero.score)}
            </span>
          </div>
        </div>
      </Reveal>
    </section>
  )
}

/* ---------------- BRIEF ---------------- */
function Brief() {
  return (
    <section id="brief" className="mx-auto max-w-[1440px] px-5 py-[clamp(72px,9vh,130px)] md:px-14">
      <div className="grid gap-12 lg:grid-cols-2">
        <Reveal>
          <div className="label mb-6">05 — BRIEF / 算法</div>
          <h2 className="font-display text-[clamp(34px,4.4vw,56px)] font-bold leading-[1.15] text-cream">
            不预测云，
            <br />
            预测光穿过云的方式。
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="flex flex-col gap-6 text-[15px] leading-[1.85] text-mist">
            <p>
              火烧云要三件事同时成立：头顶有中高云可被照亮（幕布）、太阳方向的光路畅通（缺口）、低云不挡视线（墙）。
              任何一项接近零，霞就烧不起来——所以这三项用几何加权，而不是简单平均。
            </p>
            <p>
              每场日落，ECMWF、GFS、ICON 与综合模式各算一遍，按权重合成一个 0–100 的霞分，再切成六档：无烧、微烧、小烧、小到中烧、中到大烧、大烧。
              空气通透度独立评分，与把握分开告诉你。
            </p>
            <p className="text-veil">
              数据来自 Open-Meteo（ECMWF / GFS / ICON / CAMS）。启发式算法，不是官方预报——但每天清晨与傍晚，它都在替你抬头。
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ---------------- 页面 ---------------- */
export default function Home() {
  const [place, setPlace] = useState(() => readSavedPlace() || DEFAULT_PLACE)
  const [fav, setFav] = useState(false)
  const [pick, setPick] = useState(null)
  const { loading, data, error, reload } = useWeekly(place.lat, place.lon, 7)

  useEffect(() => savePlace(place), [place])

  const onShare = async () => {
    const text = `GLOW 火烧云预报 · ${place.name}${data ? ` · ${nextEvent(fourEvents(data))?.grade ?? ''}` : ''} https://glow.nybbq.art`
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* 剪贴板不可用时静默 */
    }
  }

  return (
    <>
      <Hero
        place={place}
        w={data}
        fav={fav}
        onFav={() => setFav((v) => !v)}
        onShare={onShare}
      />
      {loading && (
        <div className="label flex items-center justify-center gap-3 py-16">
          <RotateCw size={13} className="animate-spin" /> 正在拉取预报…
        </div>
      )}
      {error && (
        <div className="mx-auto max-w-[560px] px-5 py-20 text-center">
          <p className="mb-6 text-sm text-mist">拉取预报失败：{error}</p>
          <button type="button" className="btn btn-ghost" onClick={reload}>
            <RotateCw size={14} /> 重试
          </button>
        </div>
      )}
      {data && (
        <>
          <SunPath w={data} />
          <Rail w={data} onPick={setPick} />
          <SkyTimeline w={data} event={pick} />
          <Profile w={data} />
          <Brief />
        </>
      )}
    </>
  )
}
