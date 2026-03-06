export function Image({ props }: { props: Record<string, unknown> }) {
  const src = (props.src as string) ?? ""
  const alt = (props.alt as string) ?? ""
  const fit = (props.fit as string) ?? "cover"
  const style = props.style as React.CSSProperties | undefined

  const base: React.CSSProperties = {
    display: "block",
    width: "100%",
    objectFit: fit as React.CSSProperties["objectFit"],
  }

  return <img data-stream-element src={src} alt={alt} style={{ ...base, ...style }} />
}
