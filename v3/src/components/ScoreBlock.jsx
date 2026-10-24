import { lvColor } from '../core/glow.js'

/* 霞分展示：衬线特大数字 + 等级色 + 0-100 细条（MASTER §6 Score） */
export function ScoreDial({ score, level, size = 'lg' }) {
  const color = lvColor(level)
  const shown = Number.isFinite(score) ? Math.round(score) : '--'
  return (
    <div className="flex items-end gap-4">
      <div
        className="serif-num leading-none"
        style={{
          color,
          fontSize: size === 'xl' ? 'clamp(96px,13vw,178px)' : 'clamp(44px,5vw,64px)',
        }}
      >
        {shown}
      </div>
      <div className="mb-2 flex flex-col gap-2">
        <span className="label">GLOW</span>
        <div className="h-[2px] w-24 bg-line" style={{ minWidth: 96 }}>
          <div
            className="h-full transition-all duration-700"
            style={{ width: `${Math.max(0, Math.min(100, score ?? 0))}%`, background: color }}
          />
        </div>
      </div>
    </div>
  )
}

/* 紧凑分数：榜单行/卡片用 */
export function ScoreInline({ score, level }) {
  const color = lvColor(level)
  return (
    <span className="serif-num text-2xl leading-none" style={{ color }}>
      {Number.isFinite(score) ? Math.round(score) : '--'}
    </span>
  )
}

/* 等级 chip */
export function GradeChip({ grade, level, small = false }) {
  return (
    <span
      className={
        'label inline-flex items-center rounded-full border px-3 py-1 ' +
        (small ? '!text-[10px]' : '')
      }
      style={{ borderColor: lvColor(level) + '99', color: lvColor(level) }}
    >
      {grade}
    </span>
  )
}
