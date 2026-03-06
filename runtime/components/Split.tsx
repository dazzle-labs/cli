

export function Split({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
  const ratio = (props.ratio as string) ?? "2/1"
  const direction = (props.direction as string) ?? "horizontal"
  const gap = props.gap as number | undefined
  const style = props.style as React.CSSProperties | undefined

  const [primary, secondary] = ratio.split("/").map((s) => `${s.trim()}fr`)
  const isHorizontal = direction === "horizontal"

  const base: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: isHorizontal ? `${primary} ${secondary}` : undefined,
    gridTemplateRows: !isHorizontal ? `${primary} ${secondary}` : undefined,
    gap,
    width: "100%",
    height: "100%",
  }

  const childArray = React.Children.toArray(children)

  return (
    <div data-stream-element style={{ ...base, ...style }}>
      {childArray[0] ?? null}
      {childArray[1] ?? null}
    </div>
  )
}
