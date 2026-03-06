export function Line({ props }: { props: Record<string, unknown> }) {
  const x1 = (props.x1 as number) ?? 0
  const y1 = (props.y1 as number) ?? 0
  const x2 = (props.x2 as number) ?? 100
  const y2 = (props.y2 as number) ?? 0
  const stroke = (props.stroke as string) ?? "#e6edf3"
  const strokeWidth = (props.strokeWidth as number) ?? 1
  const strokeDasharray = props.strokeDasharray as string | undefined
  const style = props.style as React.CSSProperties | undefined

  const viewW = Math.max(x1, x2) + strokeWidth
  const viewH = Math.max(y1, y2) + strokeWidth

  return (
    <svg
      data-stream-element
      viewBox={`0 0 ${viewW} ${viewH}`}
      width={viewW}
      height={viewH}
      style={{ display: "block", ...style }}
    >
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
      />
    </svg>
  )
}
