export function Grid({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
  const columns = props.columns ?? 1
  const rows = props.rows as string | undefined
  const gap = (props.gap as number) ?? 8
  const style = props.style as React.CSSProperties | undefined

  const gridTemplateColumns = typeof columns === "number" ? `repeat(${columns}, 1fr)` : String(columns)

  const base: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns,
    gridTemplateRows: rows,
    gap,
  }

  return (
    <div data-stream-element style={{ ...base, ...style }}>
      {children}
    </div>
  )
}
