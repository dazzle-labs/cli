const severityColors: Record<string, { bg: string; color: string }> = {
  info: { bg: "rgba(56, 166, 255, 0.15)", color: "#58a6ff" },
  warning: { bg: "rgba(210, 153, 34, 0.15)", color: "#d29922" },
  error: { bg: "rgba(248, 81, 73, 0.15)", color: "#f85149" },
  success: { bg: "rgba(63, 185, 80, 0.15)", color: "#3fb950" },
}

export function Banner({ props }: { props: Record<string, unknown> }) {
  const text = (props.text as string) ?? ""
  const severity = (props.severity as string) ?? "info"
  const style = props.style as React.CSSProperties | undefined

  const colors = severityColors[severity] ?? severityColors.info

  const base: React.CSSProperties = {
    padding: "16px 24px",
    background: colors.bg,
    color: colors.color,
    fontWeight: 600,
    fontSize: 24,
    textAlign: "center",
    borderTop: `1px solid ${colors.color}33`,
    borderBottom: `1px solid ${colors.color}33`,
  }

  return (
    <div data-stream-element style={{ ...base, ...style }}>
      {text}
    </div>
  )
}
