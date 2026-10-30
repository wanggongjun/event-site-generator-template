import {
  useCallback,
  useId,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Link, useLocation } from 'react-router-dom'
import { MobileLiquidGlassBar, LiquidGlassSurface } from './MobileLiquidGlassBar'
import {
  clampDrawerY,
  drawerProgress,
  releaseTarget,
  type DrawerTarget,
} from './mobile-service-dock-motion'

type DragState = {
  pointerId: number
  startY: number
  originY: number
  travel: number
  lastY: number
  lastTime: number
  velocityY: number
  stableTarget: DrawerTarget
}

type DockStyle = CSSProperties & {
  '--mobile-drawer-y': string
  '--mobile-drawer-progress': number
}

export function MobileServiceDock({ children, entry }: { children: ReactNode, entry: {label: string; to: string} }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const shadeId = `dock-shade-${useId().replace(/:/g, '')}`
  const drawerHoleRef = useRef<SVGRectElement | null>(null)
  const barHoleRef = useRef<SVGRectElement | null>(null)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const drawerRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const frameRef = useRef<number | null>(null)

  const writePosition = useCallback((drawerY: number, travel: number) => {
    const nextY = clampDrawerY(drawerY, travel)
    const progress = drawerProgress(nextY, travel)
    const apply = () => {
      dockRef.current?.style.setProperty('--mobile-drawer-y', `${nextY}px`)
      dockRef.current?.style.setProperty('--mobile-drawer-progress', `${progress}`)
      frameRef.current = null
    }

    if (typeof requestAnimationFrame !== 'function') {
      apply()
      return
    }
    if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameRef.current)
    }
    frameRef.current = requestAnimationFrame(apply)
  }, [])

  const measureTravel = useCallback(() => Math.max(1, drawerRef.current?.offsetHeight ?? 0), [])

  const settle = useCallback((target: DrawerTarget, travel = measureTravel()) => {
    setOpen(target === 'open')
    setDragging(false)
    writePosition(target === 'open' ? 0 : travel, travel)
  }, [measureTravel, writePosition])

  useEffect(() => {
    dragRef.current = null
    settle('closed')
  }, [location.pathname, location.search, settle])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') settle('closed') }
    window.addEventListener('keydown', close)
    drawerRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', close)
      document.body.style.overflow = previousOverflow
      triggerRef.current?.focus()
    }
  }, [open, settle])

  useEffect(() => () => {
    if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameRef.current)
    }
  }, [])

  // Follow the actual CSS transition and drag position, keeping both glass surfaces clear.
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return
    let frame = 0
    let until = performance.now() + 500
    const update = () => {
      const surfaces = [[drawerRef.current, drawerHoleRef.current],
        [dockRef.current?.querySelector('.mobile-service-glass-live'), barHoleRef.current]] as const
      for (const [surface, hole] of surfaces) {
        if (!surface || !hole) continue
        const rect = surface.getBoundingClientRect()
        hole.setAttribute('x', String(rect.x)); hole.setAttribute('y', String(rect.y))
        hole.setAttribute('width', String(rect.width)); hole.setAttribute('height', String(rect.height))
        hole.setAttribute('rx', String(Math.min(40, rect.width / 2, rect.height / 2)))
      }
      if (dragging || performance.now() < until) frame = requestAnimationFrame(update)
    }
    const refresh = () => { cancelAnimationFrame(frame); until = performance.now() + 500; update() }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh)
    if (drawerRef.current) observer?.observe(drawerRef.current)
    if (dockRef.current) observer?.observe(dockRef.current)
    window.addEventListener('resize', refresh)
    window.visualViewport?.addEventListener('resize', refresh)
    window.visualViewport?.addEventListener('scroll', refresh)
    refresh()
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect()
      window.removeEventListener('resize', refresh)
      window.visualViewport?.removeEventListener('resize', refresh)
      window.visualViewport?.removeEventListener('scroll', refresh)
    }
  }, [open, dragging])

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const travel = measureTravel()
    const originY = open ? 0 : travel
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      originY,
      travel,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocityY: 0,
      stableTarget: open ? 'open' : 'closed',
    }
    setDragging(true)
    writePosition(originY, travel)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const elapsed = event.timeStamp - drag.lastTime
    if (elapsed > 0) drag.velocityY = (event.clientY - drag.lastY) / elapsed
    drag.lastY = event.clientY
    drag.lastTime = event.timeStamp
    writePosition(drag.originY + event.clientY - drag.startY, drag.travel)
  }

  const finishDrag = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    if (cancelled) {
      settle(drag.stableTarget, drag.travel)
      return
    }
    const finalY = clampDrawerY(drag.originY + event.clientY - drag.startY, drag.travel)
    settle(releaseTarget({ progress: drawerProgress(finalY, drag.travel), velocityY: drag.velocityY }), drag.travel)
  }

  const toggle = () => {
    settle(open ? 'closed' : 'open')
  }

  const hidden = !open && !dragging
  const dockStyle: DockStyle = {
    '--mobile-drawer-y': '100vh',
    '--mobile-drawer-progress': 0,
  }

  return <>
    <div
    data-handle-style="soft"
    aria-label="移动端活动服务"
    className={`mobile-service-dock${open ? ' is-open' : ''}${dragging ? ' is-dragging' : ''}`}
    ref={dockRef}
    style={dockStyle}
  >
    <button
      aria-hidden={!open}
      aria-label="关闭活动信息遮罩"
      className="mobile-service-dock__backdrop"
      disabled={!open}
      onClick={() => settle('closed')}
      tabIndex={open ? 0 : -1}
      type="button"
    >
      <svg className="mobile-service-shade" width="100%" height="100%" aria-hidden="true">
        <defs><mask id={shadeId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%" style={{maskType:'luminance'}}>
          <rect width="100%" height="100%" fill="white"/>
          <rect ref={drawerHoleRef} fill="black"/>
          <rect ref={barHoleRef} fill="black"/>
        </mask></defs>
        <rect width="100%" height="100%" fill="#092a42" mask={`url(#${shadeId})`}/>
      </svg>
    </button>
    <section
      aria-hidden={hidden}
      aria-label={hidden ? undefined : '活动信息'}
      aria-modal="true"
      className="mobile-service-drawer"
      inert={hidden}
      ref={drawerRef}
      role="dialog"
      tabIndex={open ? -1 : undefined}
    >
      <LiquidGlassSurface/>
      <div
        aria-label="拖动活动信息抽屉"
        className="mobile-service-drawer__control"
        onLostPointerCapture={(event) => finishDrag(event, true)}
        onPointerCancel={(event) => finishDrag(event, true)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        role="group"
      >
        <span aria-hidden="true" className="mobile-service-drawer__handle" />
      </div>
      <div className="mobile-service-drawer__scroll" data-testid="activity-info-scroll">
        {children}
      </div>
    </section>
    <div
      aria-hidden={open}
      aria-label={open ? undefined : '上拉展开活动信息'}
      className="mobile-service-dock__grabber"
      inert={open}
      onLostPointerCapture={(event) => finishDrag(event, true)}
      onPointerCancel={(event) => finishDrag(event, true)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      role="group"
    />
    <MobileLiquidGlassBar>
      <div className="mobile-service-bar">
        <button
          aria-expanded={open}
          aria-label={open ? '收起活动信息' : '展开活动信息'}
          className="mobile-service-bar__details"
          onClick={toggle}
          ref={triggerRef}
          type="button"
        ><span aria-hidden="true" />活动信息</button>
        <Link className="mobile-service-bar__entry" to={entry.to}>{entry.label}</Link>
      </div>
    </MobileLiquidGlassBar>
  </div></>
}

