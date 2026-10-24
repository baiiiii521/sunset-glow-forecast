import { useCallback, useEffect, useRef, useState } from 'react'
import { api, algo } from './glow.js'

/* v2 forecast.js 的等价移植：一次取数（预报 + 空气 + 集合），
 * 7 天朝/晚两场完整评分 + 四场切片。只调 api 公开接口，不改算法。 */

const dayOfYearFromDateStr = (s) => {
  const p = s.split('-')
  return Math.floor((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(+p[0], 0, 0)) / 86400000)
}

const cache = new Map()

export function weeklyCached(lat, lon, n = 7) {
  const key = lat.toFixed(2) + ',' + lon.toFixed(2) + ',' + n
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.p
  const p = weekly(lat, lon, n).catch((e) => {
    cache.delete(key)
    throw e
  })
  cache.set(key, { p, at: Date.now() })
  return p
}

function weekly(lat, lon, n) {
  return api.fetchJSON(api.forecastURL(lat, lon, 'auto', n)).then((fc) => {
    const offsetSec = fc.utc_offset_seconds || 0
    const tzName = fc.timezone || 'UTC'
    const daily = fc.daily || {}
    const dates = (daily.time || []).slice(0, n)
    const bearings = dates.map((d) => {
      const doy = dayOfYearFromDateStr(d)
      return { doy, ss: algo.sunsetBearing(lat, doy), sr: algo.sunriseBearing(lat, doy) }
    })
    const ep = api.ensemblePoints(lat, lon, [bearings[0].sr, bearings[0].ss])
    return Promise.all([
      api.fetchJSON(api.aqURL(lat, lon, tzName, n)).catch(() => null),
      api.fetchEnsemble(ep.points, tzName, n),
    ]).then(([aq, ens]) => {
      const days = dates.map((d, i) => {
        // 极昼/极夜时 sunset/sunrise 为 null，跳过该场
        const ssEpoch = daily.sunset && daily.sunset[i] ? algo.toEpoch(daily.sunset[i], offsetSec) : null
        const srEpoch = daily.sunrise && daily.sunrise[i] ? algo.toEpoch(daily.sunrise[i], offsetSec) : null
        let ss = null
        let sr = null
        if (ssEpoch != null) {
          try {
            ss = api.scoreEvent(fc, aq, ssEpoch, bearings[i].ss, offsetSec, ens, ep.upIdx[1], ep.dist)
          } catch (e) {
            console.error('晚霞评分失败', d, e?.message)
          }
        }
        if (srEpoch != null) {
          try {
            sr = api.scoreEvent(fc, aq, srEpoch, bearings[i].sr, offsetSec, ens, ep.upIdx[0], ep.dist)
          } catch (e) {
            console.error('朝霞评分失败', d, e?.message)
          }
        }
        if (ss) {
          ss.epoch = ssEpoch
          ss.bearing = bearings[i].ss
          ss.type = 'sunset'
        }
        if (sr) {
          sr.epoch = srEpoch
          sr.bearing = bearings[i].sr
          sr.type = 'sunrise'
        }
        return { date: d, sunset: ss, sunrise: sr }
      })
      return { offsetSec, tzName, fetchedAt: Date.now(), days }
    })
  })
}

/* 四场切片（今早/今晚/明早/明晚），字段与 api.evaluatePlace 一致 */
export function fourEvents(w) {
  const todayStr = api.zonedParts(Date.now(), w.offsetSec).dateStr
  const tmrStr = api.zonedParts(Date.now() + 86400000, w.offsetSec).dateStr
  let iT = -1
  let iM = -1
  ;(w.days || []).forEach((d, i) => {
    if (d.date === todayStr && iT < 0) iT = i
    if (d.date === tmrStr && iM < 0) iM = i
  })
  if (iT < 0) iT = 0
  if (iM < 0) iM = iT + 1
  const d0 = w.days[iT] || {}
  const d1 = w.days[iM] || {}
  const raw = [
    { day: 'today', type: 'sunrise', ev: d0.sunrise },
    { day: 'today', type: 'sunset', ev: d0.sunset },
    { day: 'tomorrow', type: 'sunrise', ev: d1.sunrise },
    { day: 'tomorrow', type: 'sunset', ev: d1.sunset },
  ]
  const events = raw
    .filter((x) => x.ev && x.ev.epoch)
    .map((x) => {
      const e = x.ev
      e.day = x.day
      e.type = x.type
      e.offsetSec = w.offsetSec
      e.tzName = w.tzName
      return e
    })
    .sort((a, b) => a.epoch - b.epoch)
  return events
}

export function useWeekly(lat, lon, n = 7) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const runId = useRef(0)
  const reload = useCallback(() => {
    const id = ++runId.current
    setState({ loading: true, data: null, error: null })
    weeklyCached(lat, lon, n)
      .then((data) => id === runId.current && setState({ loading: false, data, error: null }))
      .catch((error) => id === runId.current && setState({ loading: false, data: null, error: String(error?.message || error) }))
  }, [lat, lon, n])
  useEffect(() => {
    reload()
  }, [reload])
  return { ...state, reload }
}
