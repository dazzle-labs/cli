

export function Stagger({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
  const preset = (props.preset as string) ?? "fade-in"
  const interval = (props.interval as number) ?? 100
  const duration = (props.duration as number) ?? 400
  const easing = (props.easing as string) ?? "ease"
  const style = props.style as React.CSSProperties | undefined

  const keyframeMap: Record<string, string> = {
    "fade-in": "stream-stagger-fade-in",
    "slide-in-left": "stream-stagger-slide-in-left",
    "slide-in-right": "stream-stagger-slide-in-right",
    "slide-in-up": "stream-stagger-slide-in-up",
    "slide-in-down": "stream-stagger-slide-in-down",
    "scale-up": "stream-stagger-scale-up",
  }

  const animName = keyframeMap[preset] ?? keyframeMap["fade-in"]

  const wrappedChildren = React.Children.map(children, (child, index) => {
    const delay = index * interval
    return (
      <div
        style={{
          animation: `${animName} ${duration}ms ${easing} ${delay}ms both`,
        }}
      >
        {child}
      </div>
    )
  })

  return (
    <>
      <style>{`
        @keyframes stream-stagger-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes stream-stagger-slide-in-left { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes stream-stagger-slide-in-right { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes stream-stagger-slide-in-up { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes stream-stagger-slide-in-down { from { opacity: 0; transform: translateY(-15px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes stream-stagger-scale-up { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
      `}</style>
      <div data-stream-element style={style}>
        {wrappedChildren}
      </div>
    </>
  )
}
