export function Chart({ props }: { props: Record<string, unknown> }) {
  const mark = (props.mark as string) ?? "bar"
  const data = (props.data as Array<Record<string, unknown>>) ?? []
  const xField = (props.xField as string) ?? "x"
  const yField = (props.yField as string) ?? "y"
  const color = (props.color as string) ?? "#58a6ff"
  const height = (props.height as number) ?? 300
  const title = props.title as string | undefined
  const showLabels = (props.showLabels as boolean) ?? true
  const showLegend = (props.showLegend as boolean) ?? false
  const colors = (props.colors as string[]) ?? [color, "#3fb950", "#d29922", "#f85149", "#bc8cff", "#f0883e"]
  const style = props.style as React.CSSProperties | undefined

  if (data.length === 0) {
    return (
      <div data-stream-element style={{ width: "100%", height: "100%", color: "#8b949e", padding: 16, textAlign: "center", ...style }}>
        No data
      </div>
    )
  }

  if (mark === "pie" || mark === "donut") {
    return renderPie(data, xField, yField, colors, height, title, showLabels, showLegend, mark === "donut", style)
  }

  // For bar, line, area: compute scales
  const yValues = data.map((d) => Number(d[yField]) || 0)
  const maxY = Math.max(...yValues, 1)
  const padding = { top: 20, right: 20, bottom: 40, left: 50 }
  const svgWidth = 600
  const svgHeight = height
  const chartW = svgWidth - padding.left - padding.right
  const chartH = svgHeight - padding.top - padding.bottom

  if (mark === "bar") {
    return renderBar(data, xField, yField, yValues, maxY, colors, svgWidth, svgHeight, chartW, chartH, padding, title, showLabels, style)
  }

  if (mark === "line" || mark === "area") {
    return renderLineArea(data, xField, yField, yValues, maxY, color, svgWidth, svgHeight, chartW, chartH, padding, title, showLabels, mark === "area", style)
  }

  // point
  return renderLineArea(data, xField, yField, yValues, maxY, color, svgWidth, svgHeight, chartW, chartH, padding, title, showLabels, false, style, true)
}

function renderBar(
  data: Array<Record<string, unknown>>,
  xField: string, yField: string,
  yValues: number[], maxY: number,
  colors: string[],
  svgWidth: number, svgHeight: number,
  chartW: number, chartH: number,
  padding: { top: number; right: number; bottom: number; left: number },
  title: string | undefined,
  showLabels: boolean,
  style: React.CSSProperties | undefined,
) {
  const barGap = 4
  const barWidth = Math.max(1, (chartW - barGap * (data.length - 1)) / data.length)

  // Y-axis ticks
  const yTicks = computeYTicks(maxY)

  return (
    <div data-stream-element style={{ width: "100%", height: "100%", overflow: "hidden", ...style }}>
      {title && <div style={titleStyle}>{title}</div>}
      <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ width: "100%", height: "100%", display: "block" }}>
        {/* Y axis gridlines + labels */}
        {yTicks.map((tick, i) => {
          const y = padding.top + chartH - (tick / maxY) * chartH
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={padding.left + chartW} y2={y} stroke="#21262d" strokeWidth={1} />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="#8b949e" fontSize={11}>{formatTick(tick)}</text>
            </g>
          )
        })}

        {/* Bars */}
        {data.map((d, i) => {
          const val = yValues[i]
          const barH = (val / maxY) * chartH
          const x = padding.left + i * (barWidth + barGap)
          const y = padding.top + chartH - barH
          const barColor = colors[i % colors.length]
          return (
            <g key={i}>
              <rect x={x} y={y} width={barWidth} height={barH} fill={barColor} rx={2} />
              {showLabels && (
                <text
                  x={x + barWidth / 2} y={padding.top + chartH + 18}
                  textAnchor="middle" fill="#8b949e" fontSize={11}
                >
                  {String(d[xField] ?? "")}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function renderLineArea(
  data: Array<Record<string, unknown>>,
  xField: string, yField: string,
  yValues: number[], maxY: number,
  color: string,
  svgWidth: number, svgHeight: number,
  chartW: number, chartH: number,
  padding: { top: number; right: number; bottom: number; left: number },
  title: string | undefined,
  showLabels: boolean,
  isArea: boolean,
  style: React.CSSProperties | undefined,
  isPoint?: boolean,
) {
  const yTicks = computeYTicks(maxY)

  const points = data.map((d, i) => {
    const x = padding.left + (i / Math.max(data.length - 1, 1)) * chartW
    const y = padding.top + chartH - (yValues[i] / maxY) * chartH
    return { x, y }
  })

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ")
  const areaPath = isArea
    ? `M${points.map((p) => `${p.x},${p.y}`).join(" L")} L${points[points.length - 1].x},${padding.top + chartH} L${points[0].x},${padding.top + chartH} Z`
    : undefined

  return (
    <div data-stream-element style={{ width: "100%", height: "100%", overflow: "hidden", ...style }}>
      {title && <div style={titleStyle}>{title}</div>}
      <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ width: "100%", height: "100%", display: "block" }}>
        {/* Y axis gridlines + labels */}
        {yTicks.map((tick, i) => {
          const y = padding.top + chartH - (tick / maxY) * chartH
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={padding.left + chartW} y2={y} stroke="#21262d" strokeWidth={1} />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="#8b949e" fontSize={11}>{formatTick(tick)}</text>
            </g>
          )
        })}

        {/* Area fill */}
        {areaPath && <path d={areaPath} fill={color} opacity={0.15} />}

        {/* Line */}
        {!isPoint && (
          <polyline points={polyline} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* Points */}
        {(isPoint || data.length <= 20) && points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={isPoint ? 4 : 3} fill={color} />
        ))}

        {/* X labels */}
        {showLabels && data.map((d, i) => (
          <text
            key={i}
            x={points[i].x}
            y={padding.top + chartH + 18}
            textAnchor="middle"
            fill="#8b949e"
            fontSize={11}
          >
            {String(d[xField] ?? "")}
          </text>
        ))}
      </svg>
    </div>
  )
}

function renderPie(
  data: Array<Record<string, unknown>>,
  xField: string, yField: string,
  colors: string[],
  height: number,
  title: string | undefined,
  showLabels: boolean,
  showLegend: boolean,
  isDonut: boolean,
  style: React.CSSProperties | undefined,
) {
  const values = data.map((d) => Math.max(0, Number(d[yField]) || 0))
  const total = values.reduce((a, b) => a + b, 0) || 1
  const cx = 150
  const cy = 150
  const r = 120
  const innerR = isDonut ? r * 0.6 : 0

  let startAngle = -Math.PI / 2
  const slices = values.map((val, i) => {
    const angle = (val / total) * 2 * Math.PI
    const endAngle = startAngle + angle
    const largeArc = angle > Math.PI ? 1 : 0

    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)

    let d: string
    if (innerR > 0) {
      const ix1 = cx + innerR * Math.cos(startAngle)
      const iy1 = cy + innerR * Math.sin(startAngle)
      const ix2 = cx + innerR * Math.cos(endAngle)
      const iy2 = cy + innerR * Math.sin(endAngle)
      d = `M${ix1},${iy1} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} L${ix2},${iy2} A${innerR},${innerR} 0 ${largeArc} 0 ${ix1},${iy1} Z`
    } else {
      d = `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`
    }

    const midAngle = startAngle + angle / 2
    const labelR = r + 18
    const labelX = cx + labelR * Math.cos(midAngle)
    const labelY = cy + labelR * Math.sin(midAngle)

    const result = { d, color: colors[i % colors.length], label: String(data[i][xField] ?? ""), labelX, labelY }
    startAngle = endAngle
    return result
  })

  return (
    <div data-stream-element style={{ width: "100%", height: "100%", overflow: "hidden", ...style }}>
      {title && <div style={titleStyle}>{title}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <svg viewBox="0 0 300 300" style={{ width: height, height, display: "block", flexShrink: 0 }}>
          {slices.map((s, i) => (
            <path key={i} d={s.d} fill={s.color} stroke="#0d1117" strokeWidth={2} />
          ))}
          {showLabels && slices.map((s, i) => (
            <text key={i} x={s.labelX} y={s.labelY} textAnchor="middle" fill="#8b949e" fontSize={11} dominantBaseline="middle">
              {s.label}
            </text>
          ))}
        </svg>
        {showLegend && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.map((d, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: colors[i % colors.length], flexShrink: 0 }} />
                <span style={{ color: "#e6edf3", fontSize: 13 }}>{String(d[xField] ?? "")}</span>
                <span style={{ color: "#8b949e", fontSize: 13, marginLeft: "auto" }}>{String(d[yField] ?? "")}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function computeYTicks(maxY: number): number[] {
  if (maxY === 0) return [0]
  const roughStep = maxY / 5
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const normalized = roughStep / magnitude
  let step: number
  if (normalized <= 1) step = magnitude
  else if (normalized <= 2) step = 2 * magnitude
  else if (normalized <= 5) step = 5 * magnitude
  else step = 10 * magnitude

  const ticks: number[] = []
  for (let v = 0; v <= maxY; v += step) {
    ticks.push(v)
  }
  if (ticks[ticks.length - 1] < maxY) {
    ticks.push(ticks[ticks.length - 1] + step)
  }
  return ticks
}

function formatTick(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#e6edf3",
  marginBottom: 12,
}
