export function Code({ props }: { props: Record<string, unknown> }) {
  const code = (props.code as string) ?? ""
  const title = props.title as string | undefined
  const style = props.style as React.CSSProperties | undefined

  return (
    <div data-stream-element style={{ ...containerStyle, ...style }}>
      {title && <div style={headerStyle}>{title}</div>}
      <pre style={preStyle}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid #30363d",
  overflow: "hidden",
}

const headerStyle: React.CSSProperties = {
  padding: "12px 20px",
  background: "#161b22",
  borderBottom: "1px solid #30363d",
  fontSize: 20,
  color: "#8b949e",
  fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
}

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: 20,
  background: "#0d1117",
  fontSize: 20,
  lineHeight: 1.5,
  fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
  color: "#e6edf3",
  overflow: "auto",
}
