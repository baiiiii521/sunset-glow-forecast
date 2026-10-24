import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, LocateFixed, CornerDownLeft } from 'lucide-react'
import { loadJSON } from '../core/glow.js'

/* ---------------- Context：Navbar / 各页共享 ⌘K ---------------- */
const Ctx = createContext({ open: () => {} })
export const useSearch = () => useContext(Ctx)

/* 城市索引：中国 2,850（points-china）+ 全球 2,024（world-cities） */
let indexCache = null
async function loadIndex() {
  if (indexCache) return indexCache
  const [world, china] = await Promise.all([
    loadJSON('/data/world-cities.json').catch(() => []),
    loadJSON('/data/points-china.json').catch(() => ({ points: [] })),
  ])
  indexCache = {
    china: (china.points || []).map((p) => ({
      name: p.name,
      sub: p.path || '',
      lat: p.lat,
      lon: p.lon,
      scope: 'china',
    })),
    world: (world || [])
      .filter((c) => c.cc !== 'CN')
      .map((c) => ({ name: c.zh, sub: c.en, lat: c.lat, lon: c.lon, scope: 'world' })),
  }
  return indexCache
}

function match(list, q) {
  const ql = q.trim().toLowerCase()
  if (!ql) return []
  return list
    .filter((c) => c.name.includes(q.trim()) || (c.sub || '').toLowerCase().includes(ql))
    .slice(0, 8)
}

export function SearchProvider({ children }) {
  const [visible, setVisible] = useState(false)
  const open = useCallback(() => setVisible(true), [])
  const value = useMemo(() => ({ open }), [open])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setVisible((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <Ctx.Provider value={value}>
      {children}
      {visible && <Panel onClose={() => setVisible(false)} />}
    </Ctx.Provider>
  )
}

/* ---------------- 面板本体 ---------------- */
function Panel({ onClose }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState({ china: [], world: [] })
  const [cursor, setCursor] = useState(0)
  const [locating, setLocating] = useState(false)
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const listRef = useRef([])

  useEffect(() => {
    inputRef.current?.focus()
    let alive = true
    loadIndex().then((idx) => {
      if (!alive) return
      setItems({ china: match(idx.china, q), world: match(idx.world, q) })
    })
    return () => {
      alive = false
    }
  }, [q])

  listRef.current = [...items.china, ...items.world]
  const total = listRef.current.length

  const go = (c) => {
    onClose()
    navigate(`/city?lat=${c.lat}&lon=${c.lon}&name=${encodeURIComponent(c.name)}&country=${encodeURIComponent(c.scope === 'china' ? '中国' : '')}`)
  }

  const locate = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        onClose()
        navigate(`/city?lat=${pos.coords.latitude.toFixed(3)}&lon=${pos.coords.longitude.toFixed(3)}&name=${encodeURIComponent('我的位置')}&country=`)
      },
      () => setLocating(false),
      { timeout: 8000 },
    )
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') return onClose()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => (total ? (c + 1) % total : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => (total ? (c - 1 + total) % total : 0))
    } else if (e.key === 'Enter' && total) {
      e.preventDefault()
      go(listRef.current[cursor])
    }
  }

  let flatIdx = -1

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="搜索城市">
      <div className="absolute inset-0 bg-ink-900/85 backdrop-blur-[8px]" onClick={onClose} />
      <div className="relative mx-auto mt-[12vh] w-[92vw] max-w-[640px] border border-line-strong bg-ink-800">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <Search size={16} strokeWidth={1.8} className="shrink-0 text-veil" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setCursor(0)
            }}
            onKeyDown={onKeyDown}
            type="search"
            placeholder="城市名 / 拼音 / 省份，例如 河内、胡志明、Nha Trang"
            aria-label="搜索城市"
            className="w-full bg-transparent text-[15px] text-cream outline-none placeholder:text-veil"
          />
          <kbd className="label shrink-0 border border-line px-2 py-1">ESC</kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto">
          {total === 0 && (
            <div className="px-5 py-10 text-center text-sm text-veil">
              {q ? '没有匹配的城市，换个关键词试试' : '输入中文名、英文或省份检索'}
            </div>
          )}
          {['china', 'world'].map((scope) =>
            items[scope].length === 0
              ? null
              : (
                <div key={scope}>
                  <div className="label border-b border-line px-5 py-2.5">
                    {scope === 'china' ? 'CHINA / 中国 · 2,850 城' : 'WORLD / 全球 · 2,024 城'}
                  </div>
                  {items[scope].map((c) => {
                    flatIdx += 1
                    const active = flatIdx === cursor
                    const my = flatIdx
                    return (
                      <button
                        key={scope + c.name + c.lat}
                        type="button"
                        className={
                          'flex w-full items-center justify-between px-5 py-3 text-left transition-colors duration-150 ' +
                          (active ? 'bg-ink-700' : 'hover:bg-ink-700')
                        }
                        onMouseEnter={() => setCursor(my)}
                        onClick={() => go(c)}
                      >
                        <span className="text-[15px] text-cream">{c.name}</span>
                        <span className="label">{c.sub}</span>
                      </button>
                    )
                  })}
                </div>
              ),
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="label">中国 2,850 城 + 全球 2,024 城</span>
          <div className="flex items-center gap-4">
            <span className="label hidden items-center gap-1 md:flex">
              <CornerDownLeft size={11} /> 进入
            </span>
            <button type="button" onClick={locate} className="label !text-gold transition-opacity hover:opacity-70">
              {locating ? '定位中…' : '用我的位置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
