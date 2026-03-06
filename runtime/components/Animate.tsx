const PRESET_ALIASES: Record<string, string> = {
  "bounce": "bounce-in",
  "slide-up": "slide-in-up",
  "slide-down": "slide-in-down",
  "slide-left": "slide-in-left",
  "slide-right": "slide-in-right",
  "scale": "scale-up",
  "rotate": "pulse", // no rotate preset; closest match
}

export function Animate({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
  const rawPreset = (props.preset as string) ?? "fade-in"
  const preset = PRESET_ALIASES[rawPreset] ?? rawPreset
  const duration = (props.duration as number) ?? 500
  const delay = (props.delay as number) ?? 0
  const easing = (props.easing as string) ?? "ease"
  const loop = (props.loop as boolean) ?? false
  const style = props.style as React.CSSProperties | undefined

  const keyframeMap: Record<string, string> = {
    "fade-in": "stream-anim-fade-in",
    "slide-in-left": "stream-anim-slide-in-left",
    "slide-in-right": "stream-anim-slide-in-right",
    "slide-in-up": "stream-anim-slide-in-up",
    "slide-in-down": "stream-anim-slide-in-down",
    "scale-up": "stream-anim-scale-up",
    "scale-down": "stream-anim-scale-down",
    "bounce-in": "stream-anim-bounce-in",
    "pulse": "stream-anim-pulse",
  }

  const animName = keyframeMap[preset] ?? keyframeMap["fade-in"]
  const iterationCount = loop ? "infinite" : "1"
  const fillMode = loop ? "none" : "both"

  const animationStyle: React.CSSProperties = {
    animation: `${animName} ${duration}ms ${easing} ${delay}ms ${iterationCount} ${fillMode}`,
    // Override the global [data-stream-element] transition which conflicts with
    // CSS animations — the transition can prevent fill-mode "both" from applying
    // the initial keyframe state correctly, leaving elements stuck at opacity: 0.
    transition: "none",
    ...style,
  }

  return (
    <>
      <style>{`
        @keyframes stream-anim-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes stream-anim-slide-in-left { from { opacity: 0; transform: translateX(-30px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes stream-anim-slide-in-right { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes stream-anim-slide-in-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes stream-anim-slide-in-down { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes stream-anim-scale-up { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
        @keyframes stream-anim-scale-down { from { opacity: 0; transform: scale(1.2); } to { opacity: 1; transform: scale(1); } }
        @keyframes stream-anim-bounce-in { 0% { opacity: 0; transform: scale(0.3); } 50% { opacity: 1; transform: scale(1.05); } 70% { transform: scale(0.95); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes stream-anim-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
      <div data-stream-element style={animationStyle}>
        {children}
      </div>
    </>
  )
}
