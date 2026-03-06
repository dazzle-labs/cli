export function FadeIn({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
  const duration = (props.duration as number) ?? 500
  const delay = (props.delay as number) ?? 0
  const style = props.style as React.CSSProperties | undefined

  const animationStyle: React.CSSProperties = {
    animation: `stream-fade-in ${duration}ms ease ${delay}ms both`,
    ...style,
  }

  return (
    <>
      <style>{`@keyframes stream-fade-in { from { opacity: 0; } to { opacity: 1; } }`}</style>
      <div data-stream-element style={animationStyle}>
        {children}
      </div>
    </>
  )
}
