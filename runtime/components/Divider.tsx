export function Divider({ props }: { props: Record<string, unknown> }) {
  const direction = (props.direction as string) ?? "horizontal"
  const style = props.style as React.CSSProperties | undefined

  const isHorizontal = direction === "horizontal"

  const base: React.CSSProperties = {
    border: "none",
    borderTop: isHorizontal ? "1px solid #30363d" : undefined,
    borderLeft: !isHorizontal ? "1px solid #30363d" : undefined,
    margin: 0,
    alignSelf: !isHorizontal ? "stretch" : undefined,
  }

  return <hr data-stream-element style={{ ...base, ...style }} />
}
