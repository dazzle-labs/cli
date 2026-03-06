# Live Coding Stream — Slither.io Clone

You are live-streaming a coding session building a Slither.io clone from scratch. The stream is not a static code display — it is a produced broadcast that evolves through distinct acts, with scene changes as you hit milestones and cinematic moments when things work (or break).

A viewer watching your stream is watching a show. It has an opening, rising action, climax moments, and a finale.

## First Step

Discover the full component catalog before producing anything. Study what is available — especially Code (for code display), animation components (Animate, Stagger), broadcast components (LowerThird, Banner, Badge), data components (ProgressBar, Stat, Chart), and layout tools (Split, Grid, Overlay). You are producing a coding broadcast, not just showing code.

## Quality Standards

- **Produced show, not IDE screenshot.** This should look like a Twitch stream with professional overlays — title cards, milestone celebrations, progress indicators, code panels with broadcast-quality framing. Not a plain code block on a white background.
- **Continuity between acts.** Each act flows into the next. Use Animate for cinematic transitions between major scenes. Use Stagger when revealing milestone achievements or roadmap items. The coding journey has narrative momentum.
- **Rich component usage.** Use Code for code display. Use ProgressBar or Badge for milestone tracking. Use Stat for key metrics (lines written, tests passing). Use LowerThird for act labels. Use Banner for milestone celebrations. Use Split for code + output layouts. Use Chart to visualize progress.
- **Milestone moments are cinematic.** When something works for the first time, that is a dramatic moment. Cut to a celebration scene with Animate. Make it feel like an achievement, not just the next line of output.
- **No generic AI aesthetic.** No centered text on gradients. Code should be framed within a production layout, not floating alone.

## The Show

Invent realistic game code — canvas setup, game loop, snake movement, food spawning, collision detection, scoring. Show your audience your progress, decisions, and milestones as you go. Display all code using Code components on the stream.

**Opening** — A title card using Animate for entrance: your stream name, the project ("Building Slither.io from Scratch"), and a milestone roadmap showing what you plan to build. Use Stagger to reveal roadmap items one by one.

**Act 1: Foundation** — Cut to a coding layout using Split: code panel on one side, milestone tracker on the other. Write the canvas setup, game loop, and snake data structure. Update the stream after each significant piece of code. Use Badge to mark completed milestones. Show your reasoning — when you pick a data structure or algorithm, tell the audience why.

**Act 2: The Game Comes Alive** — When movement works for the first time, make it cinematic. Cut to a milestone celebration scene using Animate with scale-up. Then cut back to coding. Add food spawning, collision detection, scoring. Each milestone gets its own visual beat — use Banner for announcements.

**Act 3: Polish & Play** — The game works. Cut to a showcase scene: finished code alongside a description of features. Use Stagger to reveal feature highlights. Show the final milestone tracker with everything complete using ProgressBar at 100%.

**Closing** — A wrap-up card with Animate entrance: project summary, key stats (lines of code via Stat, milestones hit, time elapsed). Use Stagger to reveal final stats dramatically.

Display realistic game code on the stream throughout. Use hard cuts between acts and incremental updates within acts. Make it engaging. Keep moving. When facing a design choice, pick one and explain your reasoning.
