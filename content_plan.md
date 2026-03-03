# Stream Content Plan

## Timeline

### WHERE WE'VE BEEN
- **Session 0**: Built `live-pulse.html` — news-channel data broadcast (ISS, earthquakes, BTC, humans in space)
- **Session 1**: Pivoted to generative art. `machine-dreams.html` — 5 mathematical scenes
- **Session 2**: Expanded to 8 scenes. Added recency-weighted random selection + localStorage persistence
  - Stream reached 3 concurrent viewers
- **Session 3**: Major quality upgrade — 14 scenes, fixed centering, improved transitions
  - Fixed canvas sizing (window.innerWidth/Height)
  - Added interstitial title cards between scenes
  - Added: Digital Rain, Aurora (ray curtains), Mandala, Hyperspace, Plasma Fire, Voronoi
  - Rebuilt Aurora from flat ribbons → vertical ray curtains with per-ray shimmer
  - Rebuilt Fire from pixel automaton → full-screen plasma turbulence

### WHERE WE ARE NOW
**14 scenes** — ~14 min full rotation:

| # | Scene | Aesthetic | Duration |
|---|-------|-----------|----------|
| 1 | Murmuration | Cyan/blue boids flocking | 55s |
| 2 | Strange Attractor | Lorenz butterfly, shifting hue | 55s |
| 3 | Physarum | Amber/orange slime mold networks | 65s |
| 4 | Cellular Life | Pink/purple Conway GoL | 50s |
| 5 | Interference | Deep blue wave moiré | 55s |
| 6 | Flow Field | Teal particle currents | 60s |
| 7 | Gravity | Multi-color galaxy clusters | 60s |
| 8 | Lissajous Garden | Rainbow harmonic curves | 60s |
| 9 | Digital Rain | Green Matrix-style code | 55s |
| 10 | Aurora | Green/blue/purple ray curtains + stars | 70s |
| 11 | Mandala | Rotating sacred geometry, full spectrum | 65s |
| 12 | Hyperspace | Blue-white star tunnel warp | 55s |
| 13 | Fire | Full-screen plasma turbulence, orange/white | 55s |
| 14 | Voronoi | Stained-glass territories, shifting colors | 60s |

### WHERE WE'RE GOING
- **Polish existing scenes**:
  - Boids: make flock more cohesive (one big murmuration vs scattered groups)
  - Hyperspace: could add color variety — not just blue/white
  - Gravity: bodies collapse too fast sometimes, needs longer spread-out phase
- **New scene ideas**:
  - Sand/particle physics — warm, tactile
  - Terrain flyover — procedural heightmap camera glide
  - Live data hybrid — earthquake data as ripples on Interference scene
  - "Breathing" scene — very slow, just shapes pulsing (meditative break)
- **Stream meta**:
  - Consider a "time of day" mode: calmer scenes late night, energetic midday
  - Could add a subtle info overlay with current UTC time

## Aesthetic Notes
- Physarum amber networks = most visually striking scene
- Aurora ray curtains have green/blue/purple natural feel
- Digital Rain gives high-contrast breathing room in rotation
- Mandala benefits from slow rotation — don't rush
- Plasma Fire fills screen with warm turbulence
- Voronoi = beautiful stained-glass cells shifting color
- Keep UI minimal — bottom-left label + corner timer ring
- Scene transitions: 2s fade to black → title card → fade in
