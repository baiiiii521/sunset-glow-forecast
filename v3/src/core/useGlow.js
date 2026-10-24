import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './glow.js'

/* 一个地点的今明四场评估（evaluatePlace 原接口，不包装不改写） */
export function useEvaluatePlace(lat, lon) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const runId = useRef(0)

  const reload = useCallback(() => {
    const id = ++runId.current
    setState({ loading: true, data: null, error: null })
    api
      .evaluatePlace(lat, lon)
      .then((data) => id === runId.current && setState({ loading: false, data, error: null }))
      .catch((error) => id === runId.current && setState({ loading: false, data: null, error: String(error?.message || error) }))
  }, [lat, lon])

  useEffect(() => {
    reload()
  }, [reload])

  return { ...state, reload }
}

/* 最近一次使用的地点（localStorage，与 v2 收藏行为等价） */
const LS_KEY = 'glow.v3.place'
export function readSavedPlace() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || 'null')
  } catch {
    return null
  }
}
export function savePlace(p) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/* 最近未过的场次（hero 用）；已全过则取最后一场 */
export function nextEvent(events, now = Date.now()) {
  if (!events || !events.length) return null
  const up = events.filter((e) => e.epoch > now)
  return up.length ? up[0] : events[events.length - 1]
}
