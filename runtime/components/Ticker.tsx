const { useId } = React

interface TickerItem {
  text: string
  category?: string
  urgent?: boolean
}

export function Ticker({ props }: { props: Record<string, unknown> }) {
  const rawItems = (props.items as unknown[]) ?? []
  // Normalize: agents may send plain strings instead of {text, category?, urgent?} objects
  const items: TickerItem[] = rawItems.map((item) =>
    typeof item === "string" ? { text: item } : (item as TickerItem)
  )
  const speed = (props.speed as number) ?? 60
  const style = props.style as React.CSSProperties | undefined
  const id = useId().replace(/:/g, "")

  if (items.length === 0) return null

  // Estimate total width: ~8px per char, separator dots ~30px each
  const totalChars = items.reduce((sum, item) => sum + item.text.length + (item.category?.length ?? 0) + 5, 0)
  const estimatedWidth = totalChars * 8 + items.length * 30
  const duration = estimatedWidth / speed

  const keyframes = `@keyframes ticker_${id} { from { transform: translateX(100%); } to { transform: translateX(-${estimatedWidth}px); } }`

  const base: React.CSSProperties = {
    overflow: "hidden",
    whiteSpace: "nowrap",
    background: "#161b22",
    padding: "8px 0",
    borderTop: "1px solid #30363d",
  }

  const trackStyle: React.CSSProperties = {
    display: "inline-block",
    animation: `ticker_${id} ${duration}s linear infinite`,
  }

  return (
    <div data-stream-element style={{ ...base, ...style }}>
      <style>{keyframes}</style>
      <div style={trackStyle}>
        {items.map((item, i) => (
          <span key={i} style={{ marginRight: 30 }}>
            {item.category && (
              <span style={{ color: "#58a6ff", fontWeight: 600, marginRight: 8 }}>
                {item.category}
              </span>
            )}
            <span style={{ color: item.urgent ? "#f85149" : "#e6edf3" }}>
              {item.text}
            </span>
            {i < items.length - 1 && (
              <span style={{ color: "#484f58", marginLeft: 30 }}>•</span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
