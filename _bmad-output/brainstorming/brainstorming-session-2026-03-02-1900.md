---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: 'Improving landing page and onboarding experience for browser-streamer'
session_goals: 'Make product immediately understandable, reduce first-session friction, polished UX, developer onboarding, accelerate aha moment'
selected_approach: 'ai-recommended'
techniques_used: ['Role Playing', 'SCAMPER Method', 'First Principles Thinking', 'MCP-First Onboarding (Extended)', 'Recalibrated Landing Page (Extended)']
ideas_generated: [118]
context_file: ''
session_continued: true
continuation_date: '2026-03-02'
---

# Brainstorming Session Results

**Facilitator:** John
**Date:** 2026-03-02

## Session Overview

**Topic:** Improving the landing page and onboarding experience for browser-streamer — the full "front door" including viewer UI, product page, first-time experience, and developer onboarding.

**Goals:**
- Make the product immediately understandable to new visitors
- Reduce friction in getting a first session running
- Visual/UX concepts that feel polished and professional
- Developer-focused onboarding (API docs, quick-starts)
- Accelerate the "aha moment"

### Session Setup

_Full-scope brainstorm covering landing page, onboarding flow, and developer experience. Going broad to capture ideas across all touchpoints._

## Technique Selection

**Approach:** AI-Recommended Techniques
**Analysis Context:** Landing page and onboarding for browser-streamer, focused on product clarity, friction reduction, polished UX, developer onboarding, and aha-moment acceleration.

**Recommended Techniques:**

- **Role Playing:** Step into multiple user personas to surface what each needs from the first experience
- **SCAMPER Method:** Systematically generate ideas by Substituting, Combining, Adapting, Modifying, Putting to other uses, Eliminating, and Reversing current experience elements
- **First Principles Thinking:** Strip back to essentials — what does someone truly need to understand and do to get value?

**AI Rationale:** Multi-persona product with both developer and end-user audiences benefits from empathy-first exploration (Role Playing), structured idea generation on an existing product (SCAMPER), then distillation to core essentials (First Principles).

## Technique Execution Results

### Role Playing (10 Personas, 47 Ideas)

**Personas Explored:** The Evaluator, The Developer Integrator, The Non-Technical Stakeholder, The AI/Agent Builder, The Open-Source Contributor, The Returning User, The "5 Seconds" Visitor, The Enterprise/Security Ops, The Educator/Demo Builder, The "Didn't Know I Needed This" Visitor

**Key Breakthroughs:**
- AI agent angle (#14): "the browser your AI agent uses while you watch" — category-defining positioning no competitor owns
- Zero framing problem (#1-#5): current page has no hero, no tagline, no value prop, no positioning
- Developer fast-path (#7, #9): curl command + Puppeteer CDP snippet would be highest-impact onboarding additions
- Use-case discovery (#39-#42): problem-framed sections catch people searching for solutions, not tools
- Page separation (#43): landing page and app UI should be distinct experiences
- Interactive playground (#45): landing page IS the demo — live API playground
- Three-path navigation (#47): "Try it" / "Integrate it" / "Deploy it" persona-based routing

### SCAMPER Method (35 Ideas)

**S — Substitute:** One-click demo instead of raw "Create Session" (#49), token login screen instead of URL params (#50), human-readable session names (#52)
**C — Combine:** Landing page IS a live demo (#53), merge session creation + URL input into single action (#55), interactive docs with "Run this" buttons (#56)
**A — Adapt:** Vercel-style creation progress feed (#59), Stripe-style multi-language docs (#60), template-based sessions (#61)
**M — Modify:** Latency indicator as product feature (#63), floating toolbar over stream (#64), session sharing links (#67)
**P — Put to Other Uses:** CI/CD visual test receipts (#68), compliance recording (#69), kiosk mode (#71)
**E — Eliminate:** Kill token-in-URL (#73), eliminate empty state (#74), merge create+view into one action (#75), remove jargon (#76)
**R — Reverse:** Show stream first explain later (#78), use-cases-first navigation (#80), code-first onboarding for devs (#81)

### First Principles Thinking (9 Ideas)

**Core Truths Identified:**
1. The product is: "a real browser somewhere else that you can see and control"
2. Minimum path to value: understand (5s) → see it (10s) → try it (30s) → connect programmatically (5min)
3. Primary user: developer building an AI agent that needs a browser
4. Fundamental differentiator: visibility — headless browsers are invisible, this one you can WATCH
5. MVP landing page: headline + live stream + one button + one code snippet

**Essential Landing Page Formula (#90):**
1. Headline: "Give your AI agent a browser. Watch everything it does."
2. Live stream or looping video of a session
3. One button: "Start a session"
4. One code block: Puppeteer/Playwright CDP connection
5. Footer: GitHub, Docs, Deploy Guide

## Session Synthesis

### Highest-Impact Ideas by Theme

| Theme | Key Ideas | Priority |
|---|---|---|
| AI agent positioning | #14, #42, #86, #87 | P0 — category-defining |
| Show don't tell | #49, #53, #78, #88, #90 | P0 — the product IS visual |
| Radical simplification | #55, #74, #75, #84, #85, #91 | P0 — less is more |
| Developer-first onboarding | #7, #46, #60, #81 | P1 — right audience |
| Page separation | #43, #23, #50 | P1 — enables everything |
| Session creation UX | #52, #55, #59, #65 | P2 — polish |

---

## Extended Session (Continuation)

_Continued after codebase investigation revealed the actual state is far more advanced than the original brainstorm assumed: branded "Dazzle" landing page with Clerk auth, multi-step onboarding wizard, 8 MCP tools, framework-specific snippets, Docs page with full API reference. Key user insight: **users integrate via MCP, not Playwright/Puppeteer directly.**_

### MCP-First Onboarding (12 Ideas)

**#92 — Flip the funnel: MCP URL first, everything else second.** Sign up → get persistent MCP endpoint immediately. No session creation step in onboarding. The agent starts a session when it calls `start`.

**#93 — "Copy one line" onboarding.** Entire getting-started collapses to one copyable line per framework. For Claude Code: `claude mcp add dazzle <url> --transport http --header "Authorization: Bearer $DAZZLE_API_KEY"`. That's it.

**#94 — Pre-provision endpoint + API key at signup.** When user signs up via Clerk, auto-generate first endpoint UUID and API key. "Get Started" opens with these already created.

**#95 — Kill the framework selector as a gate.** MCP URL and API key are framework-agnostic. Show URL + key first, framework snippets as helpers below — not prerequisites.

**#96 — "Your agent's address" mental model.** Frame endpoint as the agent's address, not protocol jargon. "Every agent gets an address on Dazzle."

**#97 — Detect-and-adapt onboarding.** Use referrer/UTM to pre-select framework and collapse irrelevant steps.

**#98 — Live connection status.** After copying MCP URL, show real-time "waiting for connection..." that flips to "connected!" on first agent `start` call.

**#99 — Inline "test it now" button.** Button that sends test `status` call to MCP endpoint. Confirms API key + URL work with immediate feedback.

**#100 — Remove stream destination from critical path.** Default to preview-only mode. Let users add Twitch/YouTube later. Don't block setup on streaming config.

**#101 — "What your agent can do" showcase.** Animated/interactive demo of tools: set_html → browser updates, screenshot → image appears, gobs → scene switches.

**#102 — Progressive tool disclosure.** New users see 3 core tools (start, set_html, screenshot). Power user section reveals full 8.

**#103 — MCP health dashboard.** Panel showing: endpoint status, last agent connection, session uptime, HTML preview thumbnail.

### Recalibrated Landing Page (15 Ideas)

**#104 — Hero is poetic but not actionable.** "Every agent deserves an audience" doesn't say what the product does. Replace with: "Give your AI agent a browser. Stream everything it does."

**#105 — Show a live stream on the landing page.** Embed looping demo stream in the hero. The landing page IS the demo.

**#106 — "Works with everything" buries the lede.** Replace with: "One MCP endpoint. Every agent framework." Show single-line setup per framework as tabs.

**#107 — Missing the "why stream?" argument.** Add section: "Why watch your agent?" — debugging, demos, trust-building, content creation, compliance. Sell the category.

**#108 — No social proof or activity signal.** Add live counter: "12 agents streaming right now" or session count.

**#109 — CTA "Get Started" is a dead phrase.** Try: "Launch a session," "Put your agent on stage," or "Try it free."

**#110 — Two-second demo GIF above the fold.** Looping GIF/video of agent navigating browser with Dazzle stream overlay. Worth more than any copy.

**#111 — Collapse three value props into one bold claim.** "The browser your AI agent uses — live, visible, streamable."

**#112 — Developer-targeted landing variant.** Below-fold section with MCP endpoint, one code snippet, "start streaming in 60 seconds."

**#113 — Use-case cards over abstract props.** "Watch your agent research competitors," "Stream your coding assistant live on Twitch," "Record your agent for compliance."

**#114 — Ecosystem strip should be clickable.** Each framework logo links to its specific setup snippet.

**#115 — "See it in action" curated recordings.** Short clips of real agents doing real things through Dazzle.

**#116 — Position against "headless."** "You already give your agent a headless browser. Dazzle makes it visible."

**#117 — Pricing/free tier clarity above the fold.** "Free to start" or "No credit card" removes conversion blocker.

**#118 — Mobile-first landing page review.** Hero + CTA must work on phone — people discover tools via Twitter/Discord links on mobile.

## Full Session Synthesis

### Highest-Impact Ideas by Theme (All 118 Ideas)

| Theme | Key Ideas | Priority |
|---|---|---|
| **MCP-first funnel flip** | #92, #93, #94, #95 | P0 — invert the entire onboarding model |
| **Hero clarity + visual proof** | #104, #105, #110, #111 | P0 — current hero doesn't convert |
| **Remove gates from critical path** | #100, #95, #97 | P0 — stream config and framework selector shouldn't block setup |
| AI agent positioning | #14, #42, #86, #87 | P0 — category-defining |
| Show don't tell | #49, #53, #78, #88, #90, #105 | P0 — the product IS visual |
| Radical simplification | #55, #74, #75, #84, #85, #91, #93 | P0 — less is more |
| **Connection confidence** | #98, #99, #103 | P1 — user needs proof setup worked |
| **Category creation** | #107, #116 | P1 — sell "why stream" and position against headless |
| **Concrete over abstract** | #106, #113, #115 | P1 — show use cases not value props |
| Developer-first onboarding | #7, #46, #60, #81, #112 | P1 — right audience |
| Page separation | #43, #23, #50 | P1 — enables everything |
| **Conversion details** | #108, #109, #117, #118 | P2 — social proof, CTA, pricing, mobile |
| Session creation UX | #52, #55, #59, #65 | P2 — polish |

### Critical Reframe: Stage, Not Browser

The browser is an implementation detail. What Dazzle gives an agent is a **production stage** — a visible, streamable environment it can control. The agent puts content on the stage (HTML, visuals, whatever), OBS captures and streams it, and an audience watches.

**Tool mapping to stage metaphor:**
- `set_html` / `edit_html` — set the scene
- `gobs` — control the production (scenes, overlays, transitions)
- `screenshot` — capture a moment
- `start` / `stop` — go live / wrap up

This changes the headline direction:
- ~~"Give your AI agent a browser"~~ — wrong, too narrow
- **"Give your AI agent a stage"** — the actual value prop
- "Every agent deserves an audience" — the existing tagline actually fits this framing well as a secondary line

### The Core Insight

**The onboarding IS the product differentiation.** MCP makes integration a single line of config. If the experience is "sign up → copy one line → your agent is streaming," that's a 60-second time-to-value no competitor can match. The landing page should *prove* this by showing it, and the onboarding should *deliver* it by removing every gate between signup and that first agent connection.

### Updated Essential Landing Page + Onboarding Formula

**Landing Page:**
1. Headline: "Give your AI agent a stage." (with "Every agent deserves an audience" as supporting line)
2. Visual: Live or looping demo of an agent session — an agent producing content on its stage
3. One-line pitch: "One MCP endpoint. Every agent framework."
4. CTA: "Launch a session" (not "Get Started")
5. Below fold: Framework tabs showing single-line setup for each
6. Social proof + "why stream?" section

**Onboarding:**
1. Pre-provision endpoint UUID + API key at signup
2. Show MCP URL + key immediately (no wizard gates)
3. Framework snippets as copy-paste helpers (not steps)
4. Live connection status: "waiting..." → "connected!"
5. Stream destination configuration deferred to later

### Recommended Next Step

Create a quick tech spec focusing on:
1. **Landing page messaging overhaul** — new hero, visual demo, "one MCP endpoint" pitch, use-case cards
2. **MCP-first onboarding flip** — pre-provision at signup, copy-one-line flow, remove framework/streaming gates
3. **Connection confidence UX** — live status indicator, test button, health dashboard
4. **Stream destination deferral** — make streaming config optional, not a gate
