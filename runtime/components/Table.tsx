export function Table({ props }: { props: Record<string, unknown> }) {
  const columns = (props.columns as Array<{ key: string; label?: string; align?: string; width?: string }>) ?? []
  const rows = (props.rows as Array<Record<string, unknown>>) ?? []
  const striped = (props.striped as boolean) ?? false
  const compact = (props.compact as boolean) ?? false
  const sortBy = props.sortBy as string | undefined
  const sortDir = (props.sortDir as string) ?? "asc"
  const title = props.title as string | undefined
  const style = props.style as React.CSSProperties | undefined

  const cellPadding = compact ? "6px 10px" : "10px 14px"

  return (
    <div data-stream-element style={style}>
      {title && <div style={titleStyle}>{title}</div>}
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={i}
                  style={{
                    ...thStyle,
                    padding: cellPadding,
                    textAlign: (col.align as React.CSSProperties["textAlign"]) ?? "left",
                    width: col.width,
                  }}
                >
                  {col.label ?? col.key}
                  {sortBy === col.key && (
                    <span style={{ marginLeft: 4, fontSize: 10 }}>
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                style={{
                  background: striped && rowIdx % 2 === 1 ? "#161b22" : "transparent",
                }}
              >
                {columns.map((col, colIdx) => (
                  <td
                    key={colIdx}
                    style={{
                      ...tdStyle,
                      padding: cellPadding,
                      textAlign: (col.align as React.CSSProperties["textAlign"]) ?? "left",
                    }}
                  >
                    {String(row[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const titleStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 600,
  color: "#e6edf3",
  marginBottom: 12,
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: 22,
}

const thStyle: React.CSSProperties = {
  color: "#8b949e",
  fontWeight: 600,
  fontSize: 18,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #30363d",
  whiteSpace: "nowrap",
}

const tdStyle: React.CSSProperties = {
  color: "#e6edf3",
  borderBottom: "1px solid #21262d",
}
