export function ProgressBar({ props }: { props: Record<string, unknown> }) {
  const value = (props.value as number) ?? 0
  const label = props.label as string | undefined
  const color = (props.color as string) ?? "#58a6ff"
  const showValue = (props.showValue as boolean) ?? true
  const style = props.style as React.CSSProperties | undefined

  const clamped = Math.max(0, Math.min(100, value))

  return (
    <div data-stream-element style={style}>
      {(label || showValue) && (
        <div style={headerStyle}>
          {label && <span style={{ color: "#e6edf3" }}>{label}</span>}
          {showValue && <span style={{ color: "#8b949e", marginLeft: "auto" }}>{Math.round(clamped)}%</span>}
        </div>
      )}
      <div style={trackStyle}>
        <div
          style={{
            height: "100%",
            width: `${clamped}%`,
            background: color,
            borderRadius: 4,
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  )
}

const headerStyle: React.CSSProperties = {
  display: "flex",
  fontSize: 13,
  marginBottom: 6,
}

const trackStyle: React.CSSProperties = {
  height: 8,
  borderRadius: 4,
  background: "#21262d",
  overflow: "hidden",
}
