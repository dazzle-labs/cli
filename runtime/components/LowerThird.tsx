export function LowerThird({ props }: { props: Record<string, unknown> }) {
  const name = (props.name as string) ?? ""
  const title = props.title as string | undefined
  const subtitle = props.subtitle as string | undefined
  const accentColor = (props.accentColor as string) ?? "#58a6ff"
  const style = props.style as React.CSSProperties | undefined

  const base: React.CSSProperties = {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "16px 24px",
    background: "rgba(13, 17, 23, 0.9)",
    borderTop: "1px solid #30363d",
  }

  const barStyle: React.CSSProperties = {
    width: 4,
    alignSelf: "stretch",
    borderRadius: 2,
    background: accentColor,
    flexShrink: 0,
  }

  return (
    <div data-stream-element style={{ ...base, ...style }}>
      <div style={barStyle} />
      <div>
        <div style={{ fontSize: 32, fontWeight: 700, color: "#e6edf3" }}>{name}</div>
        {title && <div style={{ fontSize: 22, color: "#8b949e", marginTop: 4 }}>{title}</div>}
        {subtitle && <div style={{ fontSize: 18, color: "#484f58", marginTop: 4 }}>{subtitle}</div>}
      </div>
    </div>
  )
}
