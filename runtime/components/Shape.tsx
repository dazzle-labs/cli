export function Shape({ props }: { props: Record<string, unknown> }) {
  const shape = (props.shape as string) ?? "rect"
  const width = (props.width as number) ?? 100
  const height = (props.height as number) ?? 100
  const fill = (props.fill as string) ?? "none"
  const stroke = (props.stroke as string) ?? "#e6edf3"
  const strokeWidth = (props.strokeWidth as number) ?? 1
  const points = props.points as string | undefined
  const style = props.style as React.CSSProperties | undefined

  const svgProps = {
    fill,
    stroke,
    strokeWidth,
  }

  let child: React.ReactNode

  switch (shape) {
    case "circle": {
      const r = Math.min(width, height) / 2
      child = <circle cx={width / 2} cy={height / 2} r={r} {...svgProps} />
      break
    }
    case "ellipse":
      child = <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...svgProps} />
      break
    case "polygon":
      child = <polygon points={points ?? ""} {...svgProps} />
      break
    case "rect":
    default:
      child = <rect x={0} y={0} width={width} height={height} {...svgProps} />
      break
  }

  return (
    <svg
      data-stream-element
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ display: "block", ...style }}
    >
      {child}
    </svg>
  )
}
