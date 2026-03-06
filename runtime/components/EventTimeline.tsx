interface TimelineEvent {
  type: string
  summary: string
  detail?: string
  timestamp?: string
}

const typeColors: Record<string, string> = {
  read: "#58a6ff",
  write: "#d29922",
  edit: "#d29922",
  bash: "#8b949e",
  command: "#8b949e",
  search: "#a371f7",
  error: "#f85149",
  success: "#3fb950",
  info: "#8b949e",
}

export function EventTimeline({ props }: { props: Record<string, unknown> }) {
  const events = (props.events as TimelineEvent[] | undefined) ?? []
  const maxVisible = (props.maxVisible as number) ?? 50
  const visible = events.slice(-maxVisible)

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>Timeline</div>
      <div style={listStyle}>
        {visible.length === 0 && <div style={emptyStyle}>No events yet</div>}
        {visible.map((event, i) => (
          <div key={i} style={eventStyle}>
            <div style={{ ...dotStyle, background: typeColors[event.type] ?? "#484f58" }} />
            <div style={contentStyle}>
              <div style={summaryStyle}>{event.summary}</div>
              {event.detail && <div style={detailStyle}>{event.detail}</div>}
            </div>
            {event.timestamp && <div style={timeStyle}>{formatTime(event.timestamp)}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return ts
  }
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
}

const headerStyle: React.CSSProperties = {
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: 600,
  color: "#8b949e",
  borderBottom: "1px solid #30363d",
}

const listStyle: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
  padding: "8px 0",
}

const emptyStyle: React.CSSProperties = {
  padding: "32px 16px",
  textAlign: "center",
  color: "#484f58",
  fontSize: 13,
}

const eventStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "6px 16px",
}

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  marginTop: 5,
  flexShrink: 0,
}

const contentStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
}

const summaryStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#e6edf3",
  lineHeight: 1.4,
}

const detailStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#484f58",
  marginTop: 2,
  lineHeight: 1.3,
}

const timeStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#484f58",
  fontFamily: "'SF Mono', monospace",
  whiteSpace: "nowrap",
  flexShrink: 0,
}
