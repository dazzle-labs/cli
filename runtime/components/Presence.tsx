const { useState, useEffect, useRef } = React

export function Presence({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
  const visible = (props.visible as boolean) ?? true
  const enter = (props.enter as string) ?? "fade-in"
  const exit = (props.exit as string) ?? "fade-out"
  const duration = (props.duration as number) ?? 500
  const style = props.style as React.CSSProperties | undefined

  const [mounted, setMounted] = useState(visible)
  const [animating, setAnimating] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null)

  const enterKeyframes: Record<string, string> = {
    "fade-in": "stream-presence-fade-in",
    "slide-in-left": "stream-presence-slide-in-left",
    "slide-in-right": "stream-presence-slide-in-right",
    "slide-in-up": "stream-presence-slide-in-up",
    "slide-in-down": "stream-presence-slide-in-down",
    "scale-up": "stream-presence-scale-up",
  }

  const exitKeyframes: Record<string, string> = {
    "fade-out": "stream-presence-fade-out",
    "slide-out-left": "stream-presence-slide-out-left",
    "slide-out-right": "stream-presence-slide-out-right",
    "slide-out-up": "stream-presence-slide-out-up",
    "slide-out-down": "stream-presence-slide-out-down",
    "scale-down": "stream-presence-scale-down",
  }

  useEffect(() => {
    if (visible) {
      // Show: mount immediately, animate in
      setMounted(true)
      setAnimating(false)
    } else if (mounted) {
      // Hide: animate out, then unmount
      setAnimating(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        setMounted(false)
        setAnimating(false)
      }, duration)
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [visible, duration, mounted])

  if (!mounted) return null

  const isExiting = !visible && animating
  const animName = isExiting
    ? (exitKeyframes[exit] ?? exitKeyframes["fade-out"])
    : (enterKeyframes[enter] ?? enterKeyframes["fade-in"])

  const animationStyle: React.CSSProperties = {
    animation: `${animName} ${duration}ms ease both`,
    ...style,
  }

  return (
    <>
      <style>{`
        @keyframes stream-presence-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes stream-presence-fade-out { from { opacity: 1; } to { opacity: 0; } }
        @keyframes stream-presence-slide-in-left { from { opacity: 0; transform: translateX(-30px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes stream-presence-slide-out-left { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(-30px); } }
        @keyframes stream-presence-slide-in-right { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes stream-presence-slide-out-right { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(30px); } }
        @keyframes stream-presence-slide-in-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes stream-presence-slide-out-up { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-20px); } }
        @keyframes stream-presence-slide-in-down { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes stream-presence-slide-out-down { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(20px); } }
        @keyframes stream-presence-scale-up { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
        @keyframes stream-presence-scale-down { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.8); } }
      `}</style>
      <div data-stream-element style={animationStyle}>
        {children}
      </div>
    </>
  )
}
