export function Card({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
  const title = props.title as string | undefined
  const subtitle = props.subtitle as string | undefined
  const style = props.style as React.CSSProperties | undefined
  const headerStyle = props.headerStyle as React.CSSProperties | undefined

  const hasHeader = title || subtitle

  return (
    <div data-stream-element style={{ ...containerStyle, ...style }}>
      {hasHeader && (
        <div style={{ ...defaultHeaderStyle, ...headerStyle }}>
          {title && <div style={titleStyle}>{title}</div>}
          {subtitle && <div style={subtitleStyle}>{subtitle}</div>}
        </div>
      )}
      <div style={contentStyle}>{children}</div>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid #30363d",
  background: "#161b22",
  overflow: "hidden",
}

const defaultHeaderStyle: React.CSSProperties = {
  padding: "24px 32px",
  borderBottom: "1px solid #30363d",
}

const titleStyle: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 700,
  color: "#e6edf3",
}

const subtitleStyle: React.CSSProperties = {
  fontSize: 20,
  color: "#8b949e",
  marginTop: 4,
}

const contentStyle: React.CSSProperties = {
  padding: 32,
}
