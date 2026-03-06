export function Sparkline({ props }: { props: Record<string, unknown> }) {
  const values = (props.values as number[]) ?? []
  const color = (props.color as string) ?? "#58a6ff"
  const height = (props.height as number) ?? 32
  const fill = (props.fill as boolean) ?? false
  const style = props.style as React.CSSProperties | undefined

  if (values.length === 0) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const width = 100

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * width
    const y = height - ((v - min) / range) * height
    return `${x},${y}`
  })

  const polylinePoints = points.join(" ")

  const fillPoints = fill
    ? `0,${height} ${polylinePoints} ${width},${height}`
    : undefined

  return (
    <svg
      data-stream-element
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block", width: "100%", height, ...style }}
    >
      {fillPoints && (
        <polygon points={fillPoints} fill={color} opacity={0.15} />
      )}
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
