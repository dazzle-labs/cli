export function Path({ props }: { props: Record<string, unknown> }) {
  const d = (props.d as string) ?? ""
  const fill = (props.fill as string) ?? "none"
  const stroke = (props.stroke as string) ?? "#e6edf3"
  const strokeWidth = (props.strokeWidth as number) ?? 1
  const style = props.style as React.CSSProperties | undefined

  return (
    <svg
      data-stream-element
      style={{ display: "block", width: "100%", height: "100%", ...style }}
    >
      <path d={d} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  )
}
