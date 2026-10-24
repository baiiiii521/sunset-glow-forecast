import { NavLink } from 'react-router-dom'
import { Sun, BarChart3, MapPin } from 'lucide-react'

/* 移动端底部导航（MASTER §3：移动端不是缩小版） */
export default function TabBar() {
  const item = ({ isActive }) =>
    'flex flex-col items-center gap-1 text-[11px] transition-colors duration-200 ' +
    (isActive ? 'text-gold' : 'text-veil')
  return (
    <nav
      aria-label="移动端导航"
      className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-3 border-t border-line bg-ink-900/90 backdrop-blur-md md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <NavLink to="/" end className={item}>
        <Sun size={20} strokeWidth={1.7} />
        <span>今晚</span>
      </NavLink>
      <NavLink to="/board" className={item}>
        <BarChart3 size={20} strokeWidth={1.7} />
        <span>霞榜</span>
      </NavLink>
      <NavLink to="/city" className={item}>
        <MapPin size={20} strokeWidth={1.7} />
        <span>城市</span>
      </NavLink>
    </nav>
  )
}
