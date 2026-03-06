export function SvgContainer({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
  const viewBox = (props.viewBox as string) ?? "0 0 100 100"
  const width = props.width as number | string | undefined
  const height = props.height as number | string | undefined
  const style = props.style as React.CSSProperties | undefined

  return (
    <svg
      data-stream-element
      viewBox={viewBox}
      width={width}
      height={height}
      style={{ display: "block", ...style }}
    >
      {children}
    </svg>
  )
}
