import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, RotateCw } from 'lucide-react'
import { api, lvColor, loadJSON } from '../core/glow.js'
import { useWeekly } from '../core/useWeekly.js'
import SkyPhoto from '../components/SkyPhoto.jsx'
import Reveal from '../components/Reveal.jsx'
import { GradeChip } from '../components/ScoreBlock.jsx'

const DAY_LABEL = (dateStr, offsetSec) => {
  const d = api.zonedParts(new Date(dateStr + 'T12:00:00Z').getTime(), offsetSec)
  const today = api.zonedParts(Date.now(), offsetSec).dateStr
  const tmr = api.zonedParts(Date.now() + 86400000, offsetSec).dateStr
  if (dateStr === today) return '今天'
  if (dateStr === tmr) return '明天'
  return `${d.m}/${d.day}`
}

/* 云层剖面：本点 × 上游 三层云量对比（信息取自 inputs，展示层重排） */
function CloudDeck({ ev }) {
  if (!ev?.inputs) return null
  const ins = ev.inputs
  const rows = [
    { name: '高云 · 幕布', v: ins.mid == null ? null : ins.mid * 0 + (ins.mid ?? 0), raw: ins.mid, color: '#FF7E8B' },
    { name: '中云 · 幕布', v: ins.high ?? null, raw: ins.high, color: '#FF9F45' },
    { name: '低云 · 墙', v: ins.low ?? null, raw: ins.low, color: 'rgba(246,239,230,.75)' },
  ]
  return (
    <div className="card p-6 md:p-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h3 className="label">CLOUD DECK / 云层剖面</h3>
        <span className="label !text-[10px]">本点云量 · 0–100%</span>
      </div>
      {rows.map((r) => (
        <div key={r.name} className="mb-6 last:mb-0">
          <div className="mb-2 flex justify-between">
            <span className="text-sm text-mist">{r.name}</span>
            <span className="serif-num text-lg" style={{ color: r.raw == null ? 'var(--color-veil)' : 'var(--color-cream)' }}>
              {r.raw == null ? '--' : Math.round(r.raw)}
            </span>
          </div>
          <div className="h-[10px] bg-line">
            <div className="h-full transition-all duration-700" style={{ width: `${r.raw ?? 0}%`, background: r.color }} />
          </div>
        </div>
      ))}
      <p className="mt-6 border-t border-line pt-5 text-xs leading-relaxed text-veil">
        光路上游（太阳方向 50–400 km）平均：低云 {ins.upLowAvg == null ? '--' : Math.round(ins.upLowAvg)}% ·
        中云 {ins.upMidAvg == null ? '--' : Math.round(ins.upMidAvg)}% ·
        总云 {ins.upTotalAvg == null ? '--' : Math.round(ins.upTotalAvg)}%。
        霞要烧起来，得中高云在场、低云让路。
      </p>
    </div>
  )
}

export default function City() {
  const [params] = useSearchParams()
  const lat = Number(params.get('lat'))
  const lon = Number(params.get('lon'))
  const name = params.get('name') || '未命名地点'
  const country = params.get('country') || ''

  const [tab, setTab] = useState('all') // all | sunset | sunrise
  const [rank, setRank] = useState(null)
  const { loading, data, error, reload } = useWeekly(lat, lon, 7)

  useEffect(() => {
    loadJSON('/data/rankings.json')
      .then((d) => {
        const scopes = ['global', 'china']
        for (const sc of scopes) {
          const i = (d[sc] || []).findIndex((r) => r.city.name === name)
          if (i >= 0) return setRank({ sc, no: i + 1, r: d[sc][i] })
        }
        setRank(null)
      })
      .catch(() => setRank(null))
  }, [name])

  const valid = Number.isFinite(lat) && Number.isFinite(lon)
  if (!valid) return <Navigate to="/" replace />

  const days = data?.days || []
  const today = days[0] || null
  const heroEv = today?.sunset || today?.sunrise || null
  const maxLevel = useMemo(() => {
    let m = null
    days.forEach((d) => [d.sunset, d.sunrise].forEach((e) => e && (m = m == null || e.level > m ? e.level : m)))
    return m
  }, [days])

  const shownDays = days.filter((d) =>
    tab === 'all' ? true : tab === 'sunset' ? d.sunset : d.sunrise,
  )

  return (
    <div className="pt-16">
      {/* 城市头 */}
      <section className="relative overflow-hidden pb-14 pt-14 md:pt-20">
        <SkyPhoto level={maxLevel ?? null} kind={heroEv?.type === 'sunrise' ? 'dawn' : 'dusk'} />
        <div className="relative z-10 mx-auto max-w-[1440px] px-5 md:px-14">
          <Link to="/" className="label inline-flex items-center gap-2 transition-colors hover:!text-cream">
            <ArrowLeft size={12} /> 回到今晚
          </Link>
          <h1 className="font-display mt-6 text-[clamp(44px,7vw,96px)] font-black leading-none tracking-tight text-cream">
            {name}
          </h1>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <span className="label">
              {country ? `${country} · ` : ''}{lat.toFixed(2)}°, {lon.toFixed(2)}°{data ? ` · ${data.tzName}` : ''}
            </span>
            {rank ? (
              <Link
                to="/board"
                className="label inline-flex items-center gap-2 rounded-full border px-3 py-1 transition-colors"
                style={{ borderColor: lvColor(rank.r.level) + '99', color: lvColor(rank.r.level) }}
              >
                今日{rank.sc === 'china' ? '中国' : '全球'}榜 第 {rank.no} 名 · {rank.r.grade}
              </Link>
            ) : (
              <span className="label rounded-full border border-line px-3 py-1">未入今日榜单</span>
            )}
          </div>
          <div className="mt-10 flex gap-2" role="tablist" aria-label="场次筛选">
            {[
              ['all', '七天总览'],
              ['sunset', '只看晚霞'],
              ['sunrise', '只看朝霞'],
            ].map(([k, lab]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={
                  'label cursor-pointer rounded-full border px-5 py-2 transition-all duration-200 ' +
                  (tab === k ? 'border-gold !text-gold' : 'border-line !text-veil hover:border-line-strong hover:!text-cream')
                }
              >
                {lab}
              </button>
            ))}
          </div>
        </div>
      </section>

      {loading && <div className="label flex items-center justify-center gap-3 py-24"><RotateCw size={13} className="animate-spin" /> 正在计算七天霞分…</div>}
      {error && (
        <div className="mx-auto max-w-[560px] px-5 py-24 text-center">
          <p className="mb-6 text-sm text-mist">计算失败：{error}</p>
          <button type="button" className="btn btn-ghost" onClick={reload}>
            <RotateCw size={14} /> 重试
          </button>
        </div>
      )}

      {data && (
        <>
          {/* 今天这一场 */}
          <section className="mx-auto max-w-[1440px] px-5 py-[clamp(48px,6vh,90px)] md:px-14">
            <Reveal>
              <div className="mb-8">
                <div className="label">01 — TODAY / 今天</div>
                <h2 className="font-display mt-3 text-[clamp(28px,3.4vw,42px)] font-bold text-cream">今天这一场</h2>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {[today?.sunset, today?.sunrise].filter(Boolean).map((ev) => (
                  <div key={ev.type} className="card relative overflow-hidden p-7 md:p-9">
                    <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: lvColor(ev.level) }} />
                    <div className="label mb-5">{ev.type === 'sunset' ? 'TODAY SUNSET / 晚霞' : 'TODAY SUNRISE / 朝霞'}</div>
                    <div className="flex items-end justify-between gap-4">
                      <span className="serif-num text-[clamp(56px,7vw,88px)] leading-none" style={{ color: lvColor(ev.level) }}>
                        {Math.round(ev.score)}
                      </span>
                      <div className="text-right">
                        <GradeChip grade={ev.grade} level={ev.level} />
                        <div className="label mt-3">{api.fmtTime(ev.epoch, data.offsetSec, data.tzName)}</div>
                        <div className="label mt-1 !text-[10px]">
                          {api.viewingWindow(ev.epoch, ev.type === 'sunset', data.offsetSec, data.tzName)}
                        </div>
                      </div>
                    </div>
                    <p className="mt-6 text-sm leading-relaxed text-mist">
                      {ev.script} · 方位 {Math.round(ev.bearing)}° · 把握 {ev.conf}
                      {ev.clarity ? ` · 通透 ${ev.clarity.name}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </Reveal>
          </section>

          {/* 七天矩阵 */}
          <section className="mx-auto max-w-[1440px] px-5 py-[clamp(48px,6vh,90px)] md:px-14">
            <Reveal>
              <div className="mb-8 max-w-[520px]">
                <div className="label">02 — SEVEN DAYS / 七日</div>
                <h2 className="font-display mt-3 text-[clamp(28px,3.4vw,42px)] font-bold text-cream">七天，一天一行。</h2>
                <p className="mt-4 text-sm text-veil">每格都是完整集合算法重算的结果：颜色=等级，数字=霞分。</p>
              </div>
              <div className="card overflow-x-auto p-2 md:p-4">
                <div className="min-w-[520px]">
                  <div className="grid grid-cols-[90px_1fr_1fr] gap-2 border-b border-line-strong px-4 py-3">
                    <span className="label">DAY</span>
                    <span className="label">SUNSET / 晚霞</span>
                    <span className="label">SUNRISE / 朝霞</span>
                  </div>
                  {shownDays.map((d) => (
                    <div key={d.date} className="grid grid-cols-[90px_1fr_1fr] items-stretch gap-2 border-b border-line px-4 py-3 last:border-0">
                      <span className="flex items-center text-sm text-mist">{DAY_LABEL(d.date, data.offsetSec)}</span>
                      {['sunset', 'sunrise'].map((k) => {
                        const e = d[k]
                        return (
                          <span
                            key={k}
                            className="flex items-center justify-between border border-line px-4 py-3 transition-colors duration-200"
                            style={{ background: e ? lvColor(e.level) + '14' : 'transparent' }}
                          >
                            {e ? (
                              <>
                                <span className="text-xs" style={{ color: lvColor(e.level) }}>{e.grade}</span>
                                <span className="serif-num text-2xl" style={{ color: lvColor(e.level) }}>{Math.round(e.score)}</span>
                              </>
                            ) : (
                              <span className="label">极昼/极夜 · 无此场</span>
                            )}
                          </span>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </section>

          {/* 云层 + 模式 */}
          <section className="mx-auto max-w-[1440px] px-5 py-[clamp(48px,6vh,90px)] md:px-14">
            <Reveal>
              <div className="grid gap-8 lg:grid-cols-2">
                <CloudDeck ev={heroEv} />
                <div className="card p-6 md:p-10">
                  <h3 className="label mb-6">CONSENSUS / 模式分歧</h3>
                  {heroEv?.ensemble?.members?.length ? (
                    <>
                      <div className="flex flex-col">
                        {heroEv.ensemble.members.map((m) => (
                          <div key={m.model} className="data-row">
                            <span className="w-16 text-sm text-mist">{m.label}</span>
                            <span className="flex-1">
                              <i className="block h-[4px] bg-line">
                                <i className="block h-full" style={{ width: `${m.score}%`, background: 'var(--color-lv3)' }} />
                              </i>
                            </span>
                            <span className="serif-num w-10 text-right text-xl text-cream">{Math.round(m.score)}</span>
                            <span className="label w-16 text-right">{m.grade}</span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-5 text-xs leading-relaxed text-veil">
                        同一场日落，四个数值模式各算一遍，综合模式权重 ×3。极差 {heroEv.ensemble.spread} 分 ·
                        加权一致度 {heroEv.ensemble.agreePct}%。分歧也是信息：分歧大时把握自动下调。
                      </p>
                    </>
                  ) : (
                    <p className="text-sm leading-relaxed text-veil">本场为单模式估算（多模式集合暂不可用）。</p>
                  )}
                </div>
              </div>
            </Reveal>
          </section>
        </>
      )}
    </div>
  )
}
