import {useEffect, useId, useRef, type PropsWithChildren} from 'react'

// Adapted from wanggongjun/liquidglass1021 modes/final.html (real-time path).
// Attribution: docs/liquidglass1021-NOTICES.txt. No page snapshots or WebGL cache.
export function LiquidGlassSurface({radius = 40, blur = 4}: {radius?: number; blur?: number}) {
  const id = `forum-glass-${useId().replace(/:/g, '')}`
  const layer = useRef<HTMLDivElement>(null)
  const filter = useRef<SVGFilterElement>(null)
  const map = useRef<SVGFEImageElement>(null)
  const displacement = useRef<SVGFEDisplacementMapElement>(null)
  useEffect(() => {
    const node = layer.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const supported = /Chrome|Chromium|Edg\//.test(navigator.userAgent) && CSS.supports('backdrop-filter', `url(#${id})`)
    node.dataset.renderer = supported ? 'live-svg' : 'blur-fallback'
    let signature = ''
    let frame = 0
    const update = () => {
      const W = Math.round(node.offsetWidth), H = Math.round(node.offsetHeight)
      if (!W || !H || signature === `${W}:${H}`) return
      signature = `${W}:${H}`
      canvas.width = W; canvas.height = H
      const data = ctx.createImageData(W,H), raw = new Float32Array(W*H*2)
      const r = Math.min(radius,W/2,H/2)
      let maximum = 0
      for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
        const ix=x-W/2, iy=y-H/2, qx=Math.abs(ix)-W/2+r, qy=Math.abs(iy)-H/2+r
        const d=Math.min(Math.max(qx,qy),0)+Math.hypot(Math.max(qx,0),Math.max(qy,0))-r
        const t=Math.max(0,Math.min(1,(d+50)/50)), weight=t*t*(3-2*t)
        const length=Math.hypot(ix/(W/H),iy)||1, dx=ix/(W/H)/length*weight*23, dy=iy/length*weight*23, k=(y*W+x)*2
        raw[k]=dx; raw[k+1]=dy; maximum=Math.max(maximum,Math.abs(dx),Math.abs(dy))
      }
      const scale=Math.max(1,maximum*2)
      for(let k=0;k<W*H;k++) {data.data[k*4]=Math.round((raw[k*2]/scale+.5)*255);data.data[k*4+1]=Math.round((raw[k*2+1]/scale+.5)*255);data.data[k*4+2]=128;data.data[k*4+3]=255}
      ctx.putImageData(data,0,0)
      for(const el of [filter.current,map.current]) {el?.setAttribute('width',String(W));el?.setAttribute('height',String(H))}
      map.current?.setAttribute('href',canvas.toDataURL())
      displacement.current?.setAttribute('scale',String(scale*.55))
      const effect=(supported?`url(#${id}) `:'')+`blur(${blur}px) saturate(2)`
      node.style.backdropFilter=effect
      node.style.setProperty('-webkit-backdrop-filter',effect)
    }
    const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(update)})
    observer.observe(node);update()
    return ()=>{observer.disconnect();cancelAnimationFrame(frame);canvas.width=canvas.height=0}
  }, [id,radius,blur])
  return <>
    <svg className="forum-glass-defs" aria-hidden="true"><defs><filter ref={filter} id={id} x="0" y="0" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feImage ref={map} result="displacement" preserveAspectRatio="none"/><feDisplacementMap ref={displacement} in="SourceGraphic" in2="displacement" xChannelSelector="R" yChannelSelector="G"/></filter></defs></svg>
    <div ref={layer} className="forum-glass-optics" aria-hidden="true"/>
    <div className="forum-glass-finish" aria-hidden="true"/>
  </>
}

export function MobileLiquidGlassBar({children}: PropsWithChildren) {
  return <div className="mobile-service-glass-live"><LiquidGlassSurface/>{children}</div>
}
