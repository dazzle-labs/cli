// Broadcast-appropriate sizes for 1920×1080 canvas.
// Level 1 is a hero heading; level 6 is a small label.
const sizeMap: Record<number, number> = {
  1: 96,
  2: 64,
  3: 48,
  4: 36,
  5: 28,
  6: 24,
}

export function Heading({ props }: { props: Record<string, unknown> }) {
  const text = (props.text as string) ?? ""
  const level = (props.level as number) ?? 2
  const style = props.style as React.CSSProperties | undefined

  const Tag = `h${Math.min(Math.max(level, 1), 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6"

  const base: React.CSSProperties = {
    color: "#e6edf3",
    fontSize: sizeMap[level] ?? 32,
    fontWeight: 600,
    margin: 0,
    lineHeight: 1.25,
  }

  return (
    <Tag data-stream-element style={{ ...base, ...style }}>
      {text}
    </Tag>
  )
}
