export function Box({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
  const style = props.style as React.CSSProperties | undefined
  return (
    <div data-stream-element style={style}>
      {children}
    </div>
  )
}
