export function StatusBar({ props }: { props: Record<string, unknown> }) {
  const title = (props.title as string) ?? ""
  const detail = props.detail as string | undefined
  const stats = props.stats as
    | { events?: number; filesRead?: number; filesWritten?: number; commands?: number }
    | undefined

  return (
    <div style={containerStyle}>
      <div style={leftStyle}>
        <div style={titleStyle}>{title}</div>
        {detail && <div style={detailStyle}>{detail}</div>}
      </div>
      {stats && (
        <div style={statsStyle}>
          {stats.events != null && <Stat label="events" value={stats.events} />}
          {stats.filesRead != null && <Stat label="read" value={stats.filesRead} color="#58a6ff" />}
          {stats.filesWritten != null && (
            <Stat label="written" value={stats.filesWritten} color="#d29922" />
          )}
          {stats.commands != null && <Stat label="commands" value={stats.commands} />}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <span style={statStyle}>
      <span style={{ color: color ?? "#8b949e" }}>{value}</span>{" "}
      <span style={{ color: "#484f58" }}>{label}</span>
    </span>
  )
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 16px",
  background: "#161b22",
}

const leftStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 12,
}

const titleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "#e6edf3",
}

const detailStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#8b949e",
}

const statsStyle: React.CSSProperties = {
  display: "flex",
  gap: 16,
  fontSize: 13,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
}

const statStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
}
