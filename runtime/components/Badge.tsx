const variantColors: Record<string, { bg: string; color: string }> = {
  default: { bg: "#30363d", color: "#e6edf3" },
  success: { bg: "rgba(63, 185, 80, 0.15)", color: "#3fb950" },
  warning: { bg: "rgba(210, 153, 34, 0.15)", color: "#d29922" },
  error: { bg: "rgba(248, 81, 73, 0.15)", color: "#f85149" },
  info: { bg: "rgba(56, 166, 255, 0.15)", color: "#58a6ff" },
}

export function Badge({ props }: { props: Record<string, unknown> }) {
  const text = (props.text as string) ?? ""
  const variant = (props.variant as string) ?? "default"
  const style = props.style as React.CSSProperties | undefined

  const colors = variantColors[variant] ?? variantColors.default

  const base: React.CSSProperties = {
    display: "inline-block",
    padding: "6px 16px",
    borderRadius: 6,
    fontSize: 18,
    fontWeight: 600,
    background: colors.bg,
    color: colors.color,
    lineHeight: 1.5,
  }

  return (
    <span data-stream-element style={{ ...base, ...style }}>
      {text}
    </span>
  )
}
