const trendSymbols: Record<string, { symbol: string; color: string }> = {
  up: { symbol: "▲", color: "#3fb950" },
  down: { symbol: "▼", color: "#f85149" },
  flat: { symbol: "–", color: "#8b949e" },
}

export function Stat({ props }: { props: Record<string, unknown> }) {
  const value = props.value ?? ""
  const label = (props.label as string) ?? ""
  const unit = props.unit as string | undefined
  const trend = props.trend as string | undefined
  const style = props.style as React.CSSProperties | undefined

  const trendInfo = trend ? trendSymbols[trend] : undefined

  return (
    <div data-stream-element style={style}>
      <div style={valueStyle}>
        {trendInfo && (
          <span style={{ color: trendInfo.color, fontSize: 36, marginRight: 8 }}>
            {trendInfo.symbol}
          </span>
        )}
        <span>{String(value)}</span>
        {unit && <span style={{ fontSize: 32, color: "#8b949e", marginLeft: 6 }}>{unit}</span>}
      </div>
      <div style={labelStyle}>{label}</div>
    </div>
  )
}

const valueStyle: React.CSSProperties = {
  fontSize: 56,
  fontWeight: 700,
  color: "#e6edf3",
  lineHeight: 1.2,
  fontFamily: "system-ui, -apple-system, sans-serif",
}

const labelStyle: React.CSSProperties = {
  fontSize: 22,
  color: "#8b949e",
  marginTop: 6,
}
