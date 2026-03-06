interface Task {
  name: string
  status: "planned" | "active" | "done"
}

const statusIndicators: Record<string, { color: string; symbol: string }> = {
  planned: { color: "#484f58", symbol: "○" },
  active: { color: "#d29922", symbol: "◉" },
  done: { color: "#3fb950", symbol: "✓" },
}

export function ProgressPanel({ props }: { props: Record<string, unknown> }) {
  const tasks = (props.tasks as Task[] | undefined) ?? []

  return (
    <div style={containerStyle}>
      {tasks.map((task, i) => {
        const indicator = statusIndicators[task.status] ?? statusIndicators.planned
        return (
          <div key={i} style={taskStyle}>
            <span style={{ color: indicator.color, width: 18, flexShrink: 0 }}>
              {indicator.symbol}
            </span>
            <span
              style={{
                color: task.status === "done" ? "#484f58" : "#e6edf3",
                textDecoration: task.status === "done" ? "line-through" : undefined,
              }}
            >
              {task.name}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
}

const taskStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
}
