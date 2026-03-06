const positionStyles: Record<string, React.CSSProperties> = {
  "top-left": { top: 0, left: 0 },
  "top-right": { top: 0, right: 0 },
  "bottom-left": { bottom: 0, left: 0 },
  "bottom-right": { bottom: 0, right: 0 },
  center: { top: "50%", left: "50%", transform: "translate(-50%, -50%)" },
  full: { top: 0, left: 0, right: 0, bottom: 0 },
}

export function Overlay({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
  const position = (props.position as string) ?? "full"
  const padding = props.padding as number | string | undefined
  const style = props.style as React.CSSProperties | undefined

  const posStyle = positionStyles[position] ?? positionStyles.full

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    padding,
    ...posStyle,
  }

  return (
    <div data-stream-element style={{ ...baseStyle, ...style }}>
      {children}
    </div>
  )
}
