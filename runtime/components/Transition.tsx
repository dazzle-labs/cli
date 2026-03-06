export function Transition({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
  const property = (props.property as string) ?? "all"
  const duration = (props.duration as number) ?? 300
  const easing = (props.easing as string) ?? "ease"
  const delay = (props.delay as number) ?? 0
  const style = props.style as React.CSSProperties | undefined

  const transitionStyle: React.CSSProperties = {
    transition: `${property} ${duration}ms ${easing} ${delay}ms`,
    ...style,
  }

  return (
    <div data-stream-element style={transitionStyle}>
      {children}
    </div>
  )
}
