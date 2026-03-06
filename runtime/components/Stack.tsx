const justifyMap: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
}

const alignMap: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
}

export function Stack({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
  const direction = (props.direction as string) ?? "vertical"
  const gap = (props.gap as number) ?? 8
  const align = props.align as string | undefined
  const justify = props.justify as string | undefined
  const style = props.style as React.CSSProperties | undefined

  const base: React.CSSProperties = {
    display: "flex",
    flexDirection: direction === "horizontal" ? "row" : "column",
    gap,
    alignItems: align ? alignMap[align] : undefined,
    justifyContent: justify ? justifyMap[justify] : undefined,
  }

  return (
    <div data-stream-element style={{ ...base, ...style }}>
      {children}
    </div>
  )
}
