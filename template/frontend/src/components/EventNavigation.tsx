import { Link, useLocation } from 'react-router-dom'

export interface EventNavigationItem { label: string; to: string; activePaths?: readonly string[] }

export function EventNavigation({ items }: { items: readonly EventNavigationItem[] }) {
  const {pathname}=useLocation()
  return <nav className="event-navigation" aria-label="活动主导航">
    <div className="event-container event-navigation__inner">
      {items.map((item) => {
        const active=pathname===item.to||(item.to!=='/'&&pathname.startsWith(item.to+'/'))||item.activePaths?.includes(pathname)
        return <Link className={`event-navigation__link${active?' active':''}`} aria-current={active?'page':undefined} key={item.to} to={item.to}>{item.label}</Link>
      })}
    </div>
  </nav>
}

