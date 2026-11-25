import { useEffect, useRef, useState } from 'react'

/** Reveal an element the first time it scrolls into view (CSS handles motion). */
export function Reveal({ children, delay = 0, as: Tag = 'div', className = '', style, ...rest }) {
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return undefined
    entrySafe(element)

    if (!('IntersectionObserver' in window)) {
      element.classList.add('is-in')
      return undefined
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in')
            observer.unobserve(entry.target)
          }
        })
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <Tag ref={ref} data-reveal="" style={{ ...style, '--reveal-delay': `${delay}ms` }} className={className} {...rest}>
      {children}
    </Tag>
  )
}

/* Elements already on screen at first paint reveal immediately. */
function entrySafe(element) {
  const rect = element.getBoundingClientRect()
  if (rect.top < window.innerHeight * 0.92) {
    requestAnimationFrame(() => element.classList.add('is-in'))
  }
}

/** Count a number up when it first becomes visible. */
export function CountUp({ value, duration = 1200, className = '', suffix = '' }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(value)

  useEffect(() => {
    const element = ref.current
    const target = Number(value) || 0
    if (!element) return undefined
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || !('IntersectionObserver' in window)) {
      setShown(target)
      return undefined
    }
    // Keep the real number until the counter actually comes into view, so a
    // section that never intersects (or a background tab) can't leave a 0 or a
    // half-counted figure on the page.
    let raf = 0
    let started = false
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || started) return
        started = true
        observer.disconnect()
        setShown(0)
        const start = performance.now()
        const step = (now) => {
          const progress = Math.min((now - start) / duration, 1)
          if (progress >= 1) {
            setShown(target)
            return
          }
          setShown(Math.round(target * (1 - Math.pow(1 - progress, 3))))
          raf = requestAnimationFrame(step)
        }
        raf = requestAnimationFrame(step)
      },
      { threshold: 0.1, rootMargin: '0px 0px -10% 0px' },
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [value, duration])

  return (
    <span ref={ref} className={className}>
      {Number(shown).toLocaleString('en-PH')}
      {suffix}
    </span>
  )
}

/** Thin gradient bar at the very top that tracks reading progress. */
export function ScrollProgress() {
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return undefined
    let frame = 0
    const update = () => {
      frame = 0
      const scrollable = document.documentElement.scrollHeight - window.innerHeight
      const progress = scrollable > 0 ? Math.min(window.scrollY / scrollable, 1) : 0
      element.style.transform = `scaleX(${progress})`
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return <div ref={ref} className="scroll-progress" aria-hidden="true" />
}
