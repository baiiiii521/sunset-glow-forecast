import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useSearch } from './SearchPanel.jsx'

/* 品牌 + 编号导航 + ⌘K 搜索（滚动 >40px 后加底与描边） */
export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const { open } = useSearch()
  const navigate = useNavigate()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const navCls = ({ isActive }) =>
    'label flex items-center gap-2 transition-colors duration-200 hover:text-cream ' +
    (isActive ? '!text-gold' : '')

  return (
    <header
      className={
        'fixed inset-x-0 top-0 z-50 transition-all duration-300 ' +
        (scrolled
          ? 'bg-ink-900/80 backdrop-blur-md border-b border-line'
          : 'bg-gradient-to-b from-ink-900/75 via-ink-900/35 to-transparent')
      }
    >
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 md:px-14">
        <Link to="/" className="group flex items-center gap-3" aria-label="GLOW 首页">
          <span className="font-display flex h-9 w-9 items-center justify-center border border-line-strong text-lg font-bold text-gold transition-colors duration-200 group-hover:border-gold">
            霞
          </span>
          <span className="hidden leading-tight sm:block">
            <b className="font-label text-sm tracking-[0.3em] text-cream">GLOW</b>
            <span className="label !text-[10px] block">火烧云预报</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="主导航">
          <NavLink to="/" end className={navCls}>
            <i className="font-label !text-[10px] not-italic text-veil">01</i>今晚
          </NavLink>
          <NavLink to="/board" className={navCls}>
            <i className="font-label !text-[10px] not-italic text-veil">02</i>霞榜
          </NavLink>
          <a
            href="/#brief"
            className="label flex items-center gap-2 transition-colors duration-200 hover:text-cream"
            onClick={(e) => {
              e.preventDefault()
              if (window.location.pathname !== '/') navigate('/#brief')
              else document.getElementById('brief')?.scrollIntoView({ behavior: 'smooth' })
              setTimeout(() => document.getElementById('brief')?.scrollIntoView({ behavior: 'smooth' }), 60)
            }}
          >
            <i className="font-label !text-[10px] not-italic text-veil">03</i>算法
          </a>
        </nav>

        <button
          type="button"
          className="icon-btn"
          aria-label="搜索城市（快捷键 Command K）"
          onClick={open}
        >
          <Search size={15} strokeWidth={1.8} />
          <kbd className="hidden font-label !text-[10px] !tracking-widest text-veil md:block">⌘K</kbd>
        </button>
      </div>
    </header>
  )
}
