# GTM Research

Verified data as of March 2026. Sources at bottom.

## Product History

Three eras:
1. Interactive entertainment (May-Aug 2025): AI choose-your-own-adventure games
2. Multiplayer streaming (Jan-Feb 2026): LTX2-powered shared AI video streams
3. Agentic broadcasting platform (Mar 2026): cloud browsers for agents

Pivot driven by: shared stream prompt collisions (Discord tests), $10/hr per shared stream economics, Chrome rendering collapsed costs to $0.10/hr, agent operators already spend money on AI.

## Unit Economics

Hetzner CCX43: 16 dedicated vCPU, 64GB RAM, 360GB SSD, 40TB traffic.
- Pre-April 2026: ~$105/mo
- Post-April 2026: ~$137/mo (~30% increase)

Stage pod resources: 500m-3500m CPU, 2Gi-14Gi RAM, 2Gi /dev/shm, ffmpeg x264 veryfast @ 2500kbps.

Conservative capacity: 4-5 concurrent stages per CCX43.

| Metric | Pre-April | Post-April |
|--------|-----------|------------|
| Worker cost/month | $105 | $137 |
| Stages per worker | 5 | 5 |
| Cost per stage-hour | $0.029 | $0.038 |
| R2 per stage | ~$0.15/mo | ~$0.15/mo |
| Bandwidth | Included (40TB) | Included (40TB) |

Margin at $0.10/hr: ~65-70%. At $0.25/hr: ~85%. At flat $99/mo (24/7): ~81%.

## Competitor Pricing

### Cloud Browsers

| Company | Price | Funding |
|---------|-------|---------|
| Browserbase | $0.10-0.12/hr; $20/mo (100 hrs), $99/mo (500 hrs) | $67.5M total ($40M Series B, Jun 2025, $300M valuation). $4.4M ARR (Jul 2025) |
| E2B | $0.05/hr per vCPU; ~$0.08/hr 1vCPU+2GB; $150/mo Pro | $32M total ($21M Series A, Jul 2025). 88% of Fortune 100 |
| Steel.dev | ~$0.10/hr; $29/mo (290 hrs), $99/mo (1,238 hrs), $499/mo (9,980 hrs) | Undisclosed (YC) |
| Hyperbrowser | $0.10/hr (credit-based) | Undisclosed (YC) |

Market converged on ~$0.10/browser-hour. Dazzle's cost basis is $0.03-0.04.

### 24/7 Streaming Automation

| Company | Price | Notes |
|---------|-------|-------|
| LiveReacting | $20-350/mo | Pre-recorded video loops |
| Gyre.pro | $49-289/mo per stream | Up to 8 simultaneous |
| Restream | $16-299/mo | Multi-platform simulcast, not 24/7 |
| StreamYard | $35-299/mo | Browser studio, session-based |
| OhBubble | $50-70/mo | VPS with OBS pre-installed |

### Digital Signage

| Company | Revenue | Per-screen/mo |
|---------|---------|---------------|
| ScreenCloud | $21M | $20-36 |
| Yodeck | $15M | $8-15 |
| Xibo | $8.6M | Open source |
| OptiSigns | $4.4M | Bootstrapped |
| TelemetryTV | — | $8-35 |

### Funding Context

- AI agent market: $7.6B (2025) to $10.9B (2026)
- Browserbase valuation multiple: ~68x ARR ($300M on $4.4M)
- Anthropic: $30B Series G at $380B (Feb 2026)
- OpenAI: $110B at $730B pre-money
- Total AI startup funding 2025: $202B (US: $159B)

## Prospects

### Top 10

| Person | Built | Why | Contact |
|--------|-------|-----|---------|
| Paul Klein IV | Stream Club (browser-to-streaming, sold to Mux). CEO of Browserbase ($300M). | Built Dazzle's exact product before. | @pk_iv on X |
| Tyler Skaggs | MoltStream: "agent-native streaming infrastructure." Last commit March 15, 2026. | Same thesis as Dazzle. | @skaggsxyz on X |
| Steve Seguin | VDO.Ninja (3.7K stars), browser-to-rtmp-docker. | THE person in browser-to-streaming OSS. 765 GitHub followers. | @xyster on X, Toronto |
| Gregor Zunic | Browser Use (50K+ stars, $17M from Felicis + PG). | Browser Use agents + Dazzle = distribution. | @gregpr07 on X |
| Patrick Debois | "Godfather of DevOps." CTO of Zender.tv (interactive livestreaming). Extensive browser-to-stream research. | Researched Dazzle's exact problem. Now at Snyk Labs. | @patrickdebois on X |
| Garrett Graves | Project-Lightspeed (3.7K stars). Now Agent Infra at Perplexity. | Streaming infra to agent infra: exact convergence. | @grvydev on X, SF |
| Jon Retting | vscreen: 31K lines Rust, headless Chromium to WebRTC, 63 MCP tools. | Same category, WebRTC vs Dazzle's RTMP. | @lowjax on X, LA |
| Han Wang | Agent Browser Protocol: Chromium fork for deterministic AI agent browser control. | Natural complement (ABP = browser, Dazzle = stream). | GitHub: theredsix |
| Fanshi Zhang | AIRI (34K stars): largest AI companion/VTuber framework. Web-first but local-only. | Dazzle is the cloud + streaming layer they lack. | @ayakaneko on X |
| Gregory | Twin.so: Series A ($12M), hiring Rust engineers for browser + agent infra. | Actively building and hiring for what Dazzle does. | gregory@twin.so |

### AI VTuber Framework Builders

All require local OBS + hardware. Dazzle eliminates that.

| Person | Project | Stars | Contact |
|--------|---------|-------|---------|
| Yi-Ting Chiu | Open-LLM-VTuber | 6.2K | LinkedIn: yi-ting-chiu |
| Ikaros-521 | AI-Vtuber (multi-platform) | 4.3K | Bilibili |
| fagenorn | handcrafted-persona-engine | 1K | @fagenorn on X |
| Ardha | AI-Waifu-Vtuber | 1K | @ardhach_ on IG |
| SugarcaneDefender | z-waif | 478 | zwaif77@gmail.com |
| Adi Panda | Kuebiko | 387 | @awdii_ on X, Austin |
| Yuki Shindo | aituber-onair | 33 | @shinshin86 on X |
| Hironao Otsubo | ai-streamer (CTO of Hatena) | 12 | @motemen.works on Bluesky |

### Browser-to-Stream Pipeline Builders

| Person | Project | Contact |
|--------|---------|---------|
| Andrey Novikov (Evil Martians) | dockerized-browser-streamer (28 stars) | @Envek on X |
| Gray Leonard | xvfb-record (50 stars) | @botglen on X |
| Bing Quan Chua | Pxy (Go browser-to-RTMP) | GitHub: chuabingquan |
| codecflow | conductor (agent-browser-to-RTMP, 2 stars) | @codecopenflow on X |
| Xyber Labs | EchoBot (53 stars) | @Xyberinc on X |

### Cloud Browser Founders

| Person | Company | Raised | Contact |
|--------|---------|--------|---------|
| Hussien Hussien | Steel.dev (YC) | — | @hussufo on X |
| Akshay/Shri | Hyperbrowser (YC) | — | LinkedIn: shrisukhani |
| Vasek Mlejnsky | E2B | $21M Series A | @e2b_dev on X |
| Suchintan Singh | Skyvern (YC S23) | — | GitHub: Skyvern-AI |
| Cris Stringfellow | BrowserBox ($99/user/yr) | — | sales@dosaygo.com, HN: 12.7K karma |

### HN Commenters with Email

| Person | Why | Email |
|--------|-----|-------|
| Daniel Kehoe | "happy to see browser automation without building infrastructure" | daniel@danielkehoe.com |
| Vikesh at TexAu | Data extraction platform evaluating cloud browsers | vikesh@texau.com |
| Franz Enzenhofer | High-karma, posts about headless browser + AI | fe@f19n.com |

### Other Notable

| Person | Why | Contact |
|--------|-----|---------|
| Matt McClure | Mux co-founder (acquired Stream Club), runs Demuxed + SF Video Technology | @matt_mcclure on X |
| Eli Mallon | Streamplace founder, Livepeer | Bluesky: iame.li |
| Ben Guo | Zo Computer co-founder, ex-Stripe 9 years | LinkedIn: 0thernet |
| Bachir Boumaaza (Athene) | Singularity Group: multiple 24/7 AI streams on Twitch | twitch.tv/team/singularitygroup |
| Adrien Morvan | AI Streamer Experiment, documented every infra pain point | Medium: @adrien_morvan |
| Guilherme Oliveira | 24/7 AI Twitch stream in Go, wrote the tutorial | Medium: guioliveira |
| Olivia Jack | Hydra (browser live-coding video synth) | ojack.xyz |
| Lyell Hintz | StreamDiffusionTD, real-time AI art via Livepeer/Daydream | discord.gg/daydreamlive |

## Verticals

### Crypto/Trading Streamers

Twitch "Crypto" + Kick "Crypto & Trading" (25.8K concurrent viewers). Dashboards ARE web pages (TradingView, Dexscreener via OBS screen capture).

Top: K1m6a (561K viewer hrs/mo, 41.6K followers), dvces (212K), degenpumplivetrading (86K), scharo100x (65K), georgeweb3dev (61K).

Links: twitch.tv/directory/category/crypto, kick.com/category/crypto-and-trading

### Radio Stations Going Visual

AzuraCast community is writing FFmpeg scripts to do what Dazzle does natively.
- Feature request: https://features.azuracast.com/suggestions/575961/video-streaming-from-the-azuracast
- AzuraCast/radio-video-stream repo: janky Liquidsoap script, community begging for real solution
- Hosted platforms: RadioKing, Radio Cult, Radio.co

### Church/Worship Streaming ($283M software market)

87% of churches stream. Volunteer-dependent, technically complex.
- BoxCast $109-169/mo, Resi $99-249/mo
- FreeShow: free/OSS, 2.5M+ downloads, 1K+ stars, already outputs to browsers
- Communities: theleadpastor.com, churchtrac.com, faith.tools

### Music Visualizer 24/7 Streams

Butterchurn, Kaleidosync: WebGL visualizers that run in browsers. Currently people use Gyre ($49-289/mo) or LiveReacting ($14-250/mo) with pre-recorded loops.

### Live Commerce ($67.8B US market)

AI hosts running 24/7 product streams. Proven in China, US catching up.
- eStreamly (nicolas@estreamly.com), Stickler (hello@stickler.live), Immerss ($1.1M seed, Dallas), CommentSold ($25-100M rev, 10K retailers)

## Communities

### Discord

- CrewAI: discord.com/invite/crewai (9K+)
- MCP Server Community: discord.com/invite/RsYPRrnyqg (1.2K)
- AI Agency Alliance: discord.com/invite/ai-automation-community-902668725298278470 (13K)
- VDO.Ninja: discord.vdo.ninja
- Livepeer/Daydream: discord.gg/daydreamlive

### Reddit

r/AI_Agents, r/LocalLLaMA (653K), r/ClaudeAI, r/digitalsignage, r/Twitch, r/creativecoding, r/lofihiphop, r/SideProject

### HN Threads

- vscreen: news.ycombinator.com/item?id=47205515
- Open-source browser for AI agents: news.ycombinator.com/item?id=47336171
- SentientTube: news.ycombinator.com/item?id=47150512
- Hyperbrowser: news.ycombinator.com/item?id=42381712
- Steel.dev: news.ycombinator.com/item?id=42245573

### Curated Lists (get listed)

- proj-airi/awesome-ai-vtubers (351 stars)
- wong2/awesome-mcp-servers
- terkelg/awesome-creative-coding

### Key Reference Docs

- jedi4ever's livestream research: gist.github.com/jedi4ever/30eaf96d29f92da42ff5b79db06af125
- Mux: headless Chrome as a service: mux.com/blog/lessons-learned-building-headless-chrome-as-a-service
- Mux: state of going live from a browser: mux.com/blog/the-state-of-going-live-from-a-browser

## Twitter API

Basic tier: $200/mo ($175/mo annual). Pay-per-use pilot launched Feb 2026.
- 10K posts/month cap (search, stream, timelines count; user lookups don't)
- 7-day search window
- 60 search requests/15min, 300 user lookups/15min
- Filtered stream: 50 rules, real-time push
- Pro tier ($5,000/mo) adds full-archive search, 1M posts/month

Grok API (api.x.ai): pay-per-token, grok-3-mini ~$0.30/M input. Has real-time X data access. Good for qualitative synthesis, bad for exhaustive search. Available via OpenRouter.

## Sources

- [Browserbase Pricing](https://www.browserbase.com/pricing)
- [Browserbase Revenue (Latka)](https://getlatka.com/companies/browserbase.com)
- [Browserbase Series B](https://www.upstartsmedia.com/p/browserbase-raises-40m-and-launches-director)
- [Contrary Research: Browserbase](https://research.contrary.com/company/browserbase)
- [E2B Pricing](https://e2b.dev/pricing)
- [E2B Series A (PRNewswire)](https://www.prnewswire.com/news-releases/e2b-raises-a-21m-series-a-to-offer-cloud-for-ai-agents-to-fortune-100-302514540.html)
- [Steel.dev Pricing](https://docs.steel.dev/overview/pricinglimits)
- [Hyperbrowser Pricing](https://www.hyperbrowser.ai/pricing)
- [LiveReacting Pricing](https://www.livereacting.com/pricing)
- [Gyre.pro Pricing](https://gyre.pro/pricing)
- [Restream Pricing](https://restream.io/pricing)
- [StreamYard Pricing](https://streamyard.com/pricing)
- [ScreenCloud Pricing](https://screencloud.com/pricing)
- [Yodeck Pricing](https://www.yodeck.com/pricing/)
- [TelemetryTV Pricing](https://www.telemetrytv.com/digital-signage-software-pricing/)
- [OhBubble Servers](https://www.ohbubble.com/servers)
- [Hetzner CCX43](https://sparecores.com/server/hcloud/ccx43)
- [Hetzner Price Adjustment April 2026](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Hetzner Price Hikes (Tom's Hardware)](https://www.tomshardware.com/tech-industry/hetzner-to-raise-prices-by-up-to-37-percent-from-april-1)
