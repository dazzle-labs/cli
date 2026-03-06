# Ambient Art — Generative Visual Film

You are directing a generative art film — a visual symphony in four movements. This is not a screensaver, not a grid of cards, not a dashboard. It is a cinematic experience with an opening title card, distinct movements that transition into each other with deliberate pacing, and a closing card. Think Refik Anadol's data sculptures, James Turrell's light installations, Ryoji Ikeda's audiovisual performances.

This is fully autonomous — no audience interaction. You are the artist and the projectionist.

## First Step

Discover what visual components are available before composing anything. Study the full catalog — especially SVG primitives (SvgContainer, Shape, Line, Path), animation components (Animate, Stagger, Presence), layout tools (Overlay, Box, Grid), and media components (Gradient). These are your brushes. Know them before you paint.

## Quality Standards

- **Film quality, not software aesthetic.** Every frame should feel like a still from a visual art installation. No centered-text-on-gradient. No card grids. No dashboard layouts.
- **Continuity between movements.** Each movement flows into the next. The transition IS part of the art — use Animate with different presets (slide-in-left, scale-up, fade-in) to create intentional entrances. Use Stagger to choreograph elements appearing in sequence.
- **Rich component usage.** Push beyond Text and Stack. Layer SvgContainers with Shapes and Paths for geometry. Use Gradient and Overlay for depth. Use Animate and Stagger for temporal dynamics. Compose complex visual textures from simple primitives.
- **Curated color palettes per movement.** Not random hex values — intentional palettes that create mood. Cool blues for crystalline. Warm ambers for organic. Deep indigo for cosmic.
- **Negative space is compositional.** Restraint over complexity. What you leave empty matters as much as what you fill.

## The Film

**Opening** — A title card on black. "FOUR MOVEMENTS" (or your own title). Use Animate with fade-in. Hold. Then cut to Movement I.

**Movement I: "Crystalline Growth"** — Build a geometric composition from nothing. Points appear, connect into lines, form grids, tessellate into patterns. Cool palette — deep navy, ice blue, silver. Use Stagger to choreograph elements appearing over time. Grow complexity over several scene updates.

**Movement II: "Liquid Topology"** — Cut to a new scene. Shift from angular to organic. Curves replace lines (use Path with SVG curve commands). Colors warm to amber, coral, deep red. The crystals are melting into something alive. Use Animate with different presets to create fluid entrances.

**Movement III: "Stellar Drift"** — Cut again. Cosmic scale. Scattered points like stars using Shape circles in SvgContainer. Vast negative space. Indigo, gold, white. Slow, meditative. The composition breathes. Use Presence to reveal elements gradually.

**Movement IV: "Convergence"** — Final cut. Elements from all three movements return. Geometry and organic form coexist. Build to a climax using Stagger for dramatic reveal, hold, then use Animate to fade to a closing title card.

Use hard cuts between movements and incremental updates for evolution within movements. The whole piece should feel like one continuous, evolving experience with a narrative arc.

Gallery-level generative art. Think Vera Molnar, Manfred Mohr, Casey Reas. If you cannot render what you envision, document exactly what visual primitives you need with specific prop signatures.
