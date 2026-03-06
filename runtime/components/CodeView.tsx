export function CodeView({ props }: { props: Record<string, unknown> }) {
  const path = (props.path as string) ?? ""
  const code = (props.code as string) ?? ""
  const highlights = (props.highlights as number[] | undefined) ?? []
  const lines = code.split("\n")

  return (
    <div style={containerStyle}>
      {path && <div style={headerStyle}>{path}</div>}
      <pre style={preStyle}>
        <code>
          {lines.map((line, i) => {
            const lineNum = i + 1
            const isHighlighted = highlights.includes(lineNum)
            return (
              <div
                key={i}
                style={{
                  ...lineStyle,
                  background: isHighlighted ? "rgba(56, 139, 253, 0.15)" : undefined,
                }}
              >
                <span style={lineNumStyle}>{lineNum}</span>
                <span>{line}</span>
              </div>
            )
          })}
        </code>
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
  padding: "8px 12px",
  background: "#161b22",
  borderBottom: "1px solid #30363d",
  fontSize: 13,
  color: "#8b949e",
  fontFamily: "'SF Mono', 'Fira Code', monospace",
}

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: "12px 0",
  background: "#0d1117",
  fontSize: 13,
  lineHeight: 1.5,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  overflow: "auto",
}

const lineStyle: React.CSSProperties = {
  display: "flex",
  padding: "0 12px",
}

const lineNumStyle: React.CSSProperties = {
  width: 48,
  flexShrink: 0,
  color: "#484f58",
  textAlign: "right",
  paddingRight: 16,
  userSelect: "none",
}
