export function TerminalView({ props }: { props: Record<string, unknown> }) {
  const command = (props.command as string) ?? ""
  const output = (props.output as string) ?? ""
  const exitCode = props.exitCode as number | undefined
  const success = exitCode === undefined || exitCode === 0

  return (
    <div style={containerStyle}>
      <div style={{ ...promptStyle, borderColor: success ? "#30363d" : "#f8514933" }}>
        <span style={{ color: success ? "#3fb950" : "#f85149" }}>$</span>{" "}
        <span style={{ color: "#e6edf3" }}>{command}</span>
        {exitCode != null && (
          <span style={{ marginLeft: "auto", color: success ? "#3fb950" : "#f85149", fontSize: 12 }}>
            exit {exitCode}
          </span>
        )}
      </div>
      {output && <pre style={outputStyle}>{output}</pre>}
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid #30363d",
  overflow: "hidden",
}

const promptStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  padding: "10px 12px",
  background: "#161b22",
  borderBottom: "1px solid",
  fontSize: 13,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
}

const outputStyle: React.CSSProperties = {
  margin: 0,
  padding: 12,
  background: "#0d1117",
  fontSize: 13,
  lineHeight: 1.5,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  color: "#8b949e",
  overflow: "auto",
  maxHeight: 400,
}
