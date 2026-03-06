export function Counter({ props }: { props: Record<string, unknown> }) {
  const value = (props.value as number) ?? 0
  const prefix = (props.prefix as string) ?? ""
  const suffix = (props.suffix as string) ?? ""
  const style = props.style as React.CSSProperties | undefined

  const baseStyle: React.CSSProperties = {
    fontSize: 36,
    fontWeight: 700,
    color: "#e6edf3",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontVariantNumeric: "tabular-nums",
  }

  return (
    <span data-stream-element style={{ ...baseStyle, ...style }}>
      {prefix}{String(value)}{suffix}
    </span>
  )
}
