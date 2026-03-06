# Mission Control — Mars Rover Landing

You are building a mission control display for a simulated Mars rover landing. This is a DENSE, REAL-TIME MONITORING INTERFACE — dozens of metrics, multiple subsystems, cascading status indicators. This scenario legitimately wants maximum information density. Every pixel communicates.

This is one of the few scenarios where a persistent, information-dense display IS the right format. But it should look like SpaceX mission control or NASA JPL — not like a Grafana instance. Broadcast-quality production values applied to a data-dense surface.

## First Step

Discover the full component catalog before building anything. Study what is available — especially data components (Stat, ProgressBar, Sparkline, Chart, Table, Badge), animation components (Animate, Stagger, Presence), broadcast components (Banner, LowerThird), and layout tools (Grid, Split, Overlay). A mission control display uses every category of component.

## Quality Standards

- **SpaceX mission control quality.** Dense and information-rich, but with broadcast-quality visual discipline. Clean typography. Precise alignment. Semantic color that communicates instantly. Not a generic admin dashboard.
- **The display tells the story through data changing.** The layout is mostly persistent. The drama unfolds through values updating, status colors shifting from green to amber to red, alert conditions triggering. Keep the same structure while the data tells the landing story.
- **Rich component usage.** Use Stat for primary telemetry (altitude, velocity). Use ProgressBar for fuel remaining. Use Sparkline for metric trends. Use Badge for subsystem status indicators (nominal/caution/warning). Use Table for subsystem detail views. Use Banner for critical alerts. Use Chart for trajectory visualization if applicable. Use Overlay for alert overlays during critical phases.
- **Semantic color is critical.** Green = nominal. Amber = caution. Red = warning/critical. Applied through Badge variants, ProgressBar colors, and style overrides. A single glance answers: "are we OK?"
- **Use animation for dramatic moments.** Phase transitions deserve Animate. When the parachute deploys, when the heat shield separates — these are cinematic moments. Use Presence to show/hide alert panels. Use Stagger when building the initial display.

## The Landing Sequence

Simulate the complete entry, descent, and landing:

1. **Cruise Phase** — Build the mission control display using Grid and Split. Use Stagger to animate it coming online panel by panel. Spacecraft approaching Mars. All Stat readings nominal. All Badge indicators green. Stable telemetry. The calm before the storm.

2. **Entry Interface** — Contact with atmosphere at 125 km altitude. Deceleration begins. Update telemetry values. Heat shield temperature climbs via Sparkline. First amber Badge — thermal stress entering caution range.

3. **Peak Heating** — Maximum thermal stress. Multiple values entering warning ranges. Badge indicators shifting to red. Use Banner for "COMMUNICATIONS BLACKOUT" alert. The most dangerous phase — the display should feel tense.

4. **Parachute Deploy** — Sudden, violent deceleration. Use Animate for dramatic effect on the phase transition. Altitude dropping fast. Velocity numbers plummeting. Use Presence to reveal new data panels (radar data).

5. **Heat Shield Separation** — Shield jettisoned. Landing radar goes active. Use Badge to show "RADAR LOCK" status. First direct surface data appears in the display.

6. **Powered Descent** — Retrorockets firing. Fuel ProgressBar depleting. Velocity zeroing out. Update Sparkline trends showing the convergence. Precision matters now — every number communicates.

7. **Touchdown** — Contact. All systems reporting. Use Banner for "TOUCHDOWN CONFIRMED" with severity "success". Use Animate to transition Badge indicators back to green. The display shifts from tension to celebration.

## Metrics to Track

- **Primary**: Altitude (km) via Stat, velocity horizontal (m/s), velocity vertical (m/s)
- **Resources**: Fuel remaining (%) via ProgressBar, signal delay (seconds) via Stat, power levels
- **Thermal**: Heat shield temperature (C) via Stat with Sparkline trend, internal temperature, thermal margin
- **Navigation**: Landing site error radius (m), radar lock status via Badge, trajectory deviation
- **Subsystem Health**: Navigation, Communications, Power, Thermal, Propulsion, Instruments — each with Badge status and key Stat readings

All values change as the landing progresses through phases. Use data value updates for continuous metric changes. Use incremental scene updates for structural changes. Use full scene changes only if you want a dramatically different composition (e.g., a post-landing summary view).
