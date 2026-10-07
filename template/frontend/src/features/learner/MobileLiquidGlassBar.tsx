import { lazy, Suspense, useEffect, useState, type PropsWithChildren } from 'react'

const LiquidGlass = lazy(() => import('liquid-glass-react'))
const mobileQuery = '(max-width: 640px)'

export function MobileLiquidGlassBar({ children }: PropsWithChildren) {
  const [mobile, setMobile] = useState(() => typeof matchMedia === 'function' && matchMedia(mobileQuery).matches)

  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const media = matchMedia(mobileQuery)
    const update = () => setMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  if (!mobile) return <div className="mobile-service-glass-fallback">{children}</div>

  return <Suspense fallback={<div className="mobile-service-glass-fallback">{children}</div>}>
    <LiquidGlass
      aberrationIntensity={1.25}
      blurAmount={0.5}
      className="mobile-service-glass-shell"
      cornerRadius={22}
      displacementScale={42}
      elasticity={0}
      mode="standard"
      padding="0"
      saturation={155}
      style={{ position: 'absolute', inset: '50% auto auto 50%', width: '100%' }}
    >
      {children}
    </LiquidGlass>
  </Suspense>
}

