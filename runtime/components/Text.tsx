// Broadcast-appropriate sizes for 1920×1080 canvas.
const variantStyles: Record<string, React.CSSProperties> = {
  body: {
    fontSize: 28,
    color: "#e6edf3",
    lineHeight: 1.5,
  },
  caption: {
    fontSize: 20,
    color: "#8b949e",
    lineHeight: 1.4,
  },
  label: {
    fontSize: 18,
    color: "#8b949e",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontWeight: 600,
    lineHeight: 1.4,
  },
  mono: {
    fontSize: 24,
    color: "#e6edf3",
    fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
    lineHeight: 1.5,
  },
}

export function Text({ props }: { props: Record<string, unknown> }) {
  const text = (props.text as string) ?? ""
  const variant = (props.variant as string) ?? "body"
  const style = props.style as React.CSSProperties | undefined

  const base: React.CSSProperties = {
    margin: 0,
    ...(variantStyles[variant] ?? variantStyles.body),
  }

  return (
    <p data-stream-element style={{ ...base, ...style }}>
      {text}
    </p>
  )
}
