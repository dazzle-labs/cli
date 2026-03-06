# DevOps Pipeline — Deployment Drama

You are building a mission-control-grade deployment monitoring display where a deployment drama plays out through data. Think SpaceX flight control meets Bloomberg Terminal — a dense, real-time monitoring surface where the drama comes from DATA CHANGING, not layouts changing.

This is one of the few scenarios where a persistent, information-dense layout IS the right format. But it should still look like it belongs on a wall in a SpaceX control room — not like a Grafana instance or a generic admin panel.

This runs fully autonomously. No user interaction. The viewer watches a deployment story unfold.

## First Step

Discover the full component catalog before building anything. Study what is available — especially data components (Table, Stat, ProgressBar, Sparkline, Chart, Badge), animation components (Animate, Stagger, Presence), broadcast components (Banner), and layout tools (Grid, Split, Overlay). These are your instruments. A control room display uses every one of them.

## Quality Standards

- **Control room quality, not admin panel.** Think NASA flight control, Bloomberg Terminal, SpaceX mission control. Dense and information-rich, yes — but with typographic discipline, semantic color, and visual hierarchy. Not a default Grafana dashboard.
- **The drama is in the data.** The layout stays mostly persistent. The story unfolds through values changing, colors shifting, alerts cascading. Same dashboard, different data, completely different feeling.
- **Rich component usage for data density.** Use Table for the pipeline matrix. Use Stat for key metrics (response_p95, error_rate). Use ProgressBar for pipeline stage progress. Use Sparkline for metric trends over time. Use Badge for service status indicators (green/amber/red). Use Banner for critical alerts. Use Chart if you want to show metric history.
- **Semantic color is sacred.** Green = healthy. Amber = degraded. Red = critical. No other color system. Apply through Badge variants, ProgressBar colors, and style overrides.
- **Numbers are sacred.** "0.3%" not "low." "187ms" not "fast." "78.2%" not "most." Every metric has a precise value.
- **Use animation for state transitions.** When a service fails, use Animate to make the transition visible. Use Stagger when cascading failures propagate. Use Presence to show/hide alert panels.

## The Deployment

**Phase 1: Setup.** Build the monitoring layout using Grid and Split: a pipeline matrix (Table) showing 5 services (api-gateway, auth-service, user-service, notification-service, database) across 8 stages (checkout, build, unit-test, integration-test, security-scan, deploy-staging, smoke-test, deploy-prod), service health metrics (Stat components for response_p95, error_rate, CPU, memory), and a scrolling event log. Use Stagger to animate the display coming online. All services pending. All metrics at healthy baselines. The display is calm and green.

**Phase 2: Green Path.** Advance services through pipeline stages one by one by updating data values. Vary the speed — api-gateway is fast, database is slow. Log each progression. Metrics stay healthy. Build a rhythm of steady, routine progress over 8-12 updates. The viewer should feel: "everything is nominal."

**Phase 3: The Failure.** auth-service fails at security-scan. On the same display, everything shifts: the failed cell turns red via Badge variant, error_rate Stat spikes from 0.1% to 15%, response_p95 jumps to 800ms, dependent services go amber, alerts cascade in the event log. Use Banner with severity "error" for critical alerts. Build this crisis over 4-6 updates — each one worse than the last.

**Phase 4: The Rollback.** Rollback initiated. Pipeline stages reverse for auth-service. Metrics gradually recover over several updates. The display slowly returns to calm. This should feel earned, not instant.

**Phase 5: Resolution.** The recovered display stands as the final state. Optionally cut to a post-incident summary using a different composition with Table and Chart showing the incident timeline.

Use data value updates for metric changes within the persistent layout. Use incremental scene updates for structural changes like adding alert panels. Use full scene changes only for major composition shifts (like a post-incident summary view).
