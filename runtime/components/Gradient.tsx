export function Gradient({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
  const type = (props.type as string) ?? "linear"
  // Support both "colors" and "stops" prop names
  const colors = (props.colors as string[]) ?? (props.stops as string[]) ?? ["#58a6ff", "#3fb950"]
  // Support both "angle" (number) and "direction" (CSS string like "135deg")
  const direction = props.direction as string | undefined
  const angle = (props.angle as number) ?? 180
  const style = props.style as React.CSSProperties | undefined

  const colorStops = colors.join(", ")

  let background: string
  switch (type) {
    case "radial":
      background = `radial-gradient(${colorStops})`
      break
    case "conic":
      background = `conic-gradient(${colorStops})`
      break
    case "linear":
    default:
      background = `linear-gradient(${direction ?? `${angle}deg`}, ${colorStops})`
      break
  }

  const baseStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    minHeight: 40,
    background,
  }

  return (
    <div data-stream-element style={{ ...baseStyle, ...style }}>
      {children}
    </div>
  )
}
