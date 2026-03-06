export function DiffView({ props }: { props: Record<string, unknown> }) {
  const path = (props.path as string) ?? ""
  const oldText = (props.oldText as string) ?? ""
  const newText = (props.newText as string) ?? ""
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")

  return (
    <div style={containerStyle}>
      {path && <div style={headerStyle}>{path}</div>}
      <pre style={preStyle}>
        <code>
          {oldLines.map((line, i) => (
            <div key={`old-${i}`} style={removedStyle}>
              <span style={signStyle}>-</span>
              <span>{line}</span>
            </div>
          ))}
          {newLines.map((line, i) => (
            <div key={`new-${i}`} style={addedStyle}>
              <span style={signStyle}>+</span>
              <span>{line}</span>
            </div>
          ))}
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

const removedStyle: React.CSSProperties = {
  display: "flex",
  padding: "0 12px",
  background: "rgba(248, 81, 73, 0.1)",
  color: "#f85149",
}

const addedStyle: React.CSSProperties = {
  display: "flex",
  padding: "0 12px",
  background: "rgba(63, 185, 80, 0.1)",
  color: "#3fb950",
}

const signStyle: React.CSSProperties = {
  width: 20,
  flexShrink: 0,
  userSelect: "none",
}
