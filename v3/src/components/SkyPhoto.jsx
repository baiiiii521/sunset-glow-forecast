import { useEffect, useRef, useState } from 'react'
import { skyImage } from '../core/glow.js'

/* 等级联动天空照片层：新旧两张交叉淡化 900ms（MASTER §4）。
 * level: 0-5；kind: 'dawn' | 'dusk'；null 时纯 ink 底（加载中不闪） */
export default function SkyPhoto({ level, kind = 'dusk', className = '' }) {
  const [layers, setLayers] = useState([]) // [{src, opacity}]
  const front = useRef(false)
  const src = level == null ? null : skyImage(level, kind)

  useEffect(() => {
    if (!src) return
    setLayers((prev) => {
      if (prev.length === 1 && prev[0].src === src) return prev
      return [...prev.slice(-1), { src, key: front.current = !front.current }]
    })
  }, [src])

  return (
    <div className={'absolute inset-0 overflow-hidden ' + className} aria-hidden="true">
      {src && (
        <div className="absolute inset-0 bg-ink-900">
          {layers.map((l) => (
            <img
              key={l.key}
              src={l.src}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-[900ms] ease-[cubic-bezier(.16,1,.3,1)]"
              onLoad={(e) => (e.currentTarget.style.opacity = '1')}
              onError={(e) => (e.currentTarget.style.opacity = '0')}
            />
          ))}
          {/* 照片永远压 ink 渐变保证文字对比（MASTER §4/§7） */}
          <div className="absolute inset-0 bg-gradient-to-b from-ink-900/55 via-ink-900/35 to-ink-900" />
        </div>
      )}
    </div>
  )
}
