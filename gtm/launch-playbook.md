# Launch Playbook

Platform-by-platform submission guide for Dazzle's go-to-market push. Research verified March 25, 2026.

## Positioning

**One-liner (60 chars):** AI agents get their own live TV channels

**Elevator (500 chars):** Dazzle gives AI agents their own cloud browser, then streams what they see to Twitch, YouTube, and Kick. Each agent gets an isolated Chrome instance with audio, MCP programmability, and a full ffmpeg streaming pipeline. Cost: ~$0.10/hr (vs $4/hr GPU rendering). The agent IS the content creator. Built for autonomous, continuous, 24/7 live content without OBS, hardware, or human babysitting.

**Technical hook (for HN/dev audiences):** K8s pods with Xvfb + Chrome + PulseAudio + ffmpeg sidecar. ConnectRPC API. Full CDP access. MCP-programmable. Stages persist to R2, restore on activation. $0.03-0.04/hr cost basis at Hetzner, selling at $0.10/hr for 65-70% margin.

**Founder story (200 words):** Dazzle started as AI choose-your-own-adventure games, pivoted to shared AI video streams (prompt collisions killed it), then landed on agentic broadcasting: give each agent its own cloud browser and let it stream. The insight was that agent work is inherently entertaining. Watching Claude Code solve a problem, an agent trade crypto, or a visualizer react to music in real-time is compelling content that never stops. The economics work because Chrome rendering costs $0.10/hr, not $4/hr like GPU inference. One agent, one browser, one stream, 24/7. No OBS. No hardware. No human in the loop. The MCP interface means any agent framework (Claude Code, CrewAI, LangChain, n8n) can drive a Dazzle stream programmatically. We're live at dazzle.fm with a CLI, web dashboard, and API. What we're looking for: agent builders who want to make their agents' work visible, and feedback on what's missing from the platform.

## Assets Needed

Create these once, reuse across all platforms.

| Asset | Spec | Used By |
|-------|------|---------|
| Logo | 500x500px, also works at 240x240 | All platforms |
| Screenshots (4) | 1270x760px: agent driving browser, live stream output, MCP config, web dashboard | PH, BetaList, Peerlist, directories |
| Cover/hero | 2400x1200px, under 500KB, PNG | Product Hunt |
| Demo video | YouTube, under 60s, not private. Agent spins up stage, content appears, stream goes live | PH, Show HN, newsletters |
| GIF thumbnail | 240x240px, under 3MB, animates on hover | Product Hunt |
| Existing clips | `gtm/clips/` has 15 clips ready. `showcase-grid-15s.mp4` is a promo reel. | Social, newsletters, PH gallery |

## Phase 1: Directories (submit this week)

Low effort, high SEO value. Fill out forms with good copy.

### There's An AI For That

**Priority: highest.** 7.8M monthly visitors, 2.5M newsletter subscribers. Submit here FIRST to get the $300 PPC launch bonus (requires launching on TAAFT before any other directory).

- **Cost:** $347 one-time (includes newsletter blast)
- **Submit:** theresanaiforthat.com/get-featured
- **Approval:** 1-2 days, manual review
- **Assets:** Tool name, URL, description, category, featured image
- **Refund:** Full automatic refund if rejected
- **After listing:** Self-service edit page for updates

### Toolify

5.1M monthly visitors. Second-largest AI directory.

- **Cost:** $99 one-time, permanent listing
- **Submit:** toolify.ai/submit
- **Approval:** 48 hours
- **Assets:** Name, URL, description, category, features, use cases, pricing
- **Value:** Dofollow backlink, DR ~60, certification badge, border highlight
- **Note:** Get the initial submission right; updates require credits

### Futurepedia

500K monthly visitors. Editorial credibility, YouTube ecosystem.

- **Cost:** $497 one-time (Verified tier; Basic $247 is sold out)
- **Submit:** futurepedia.io/submit-tool
- **Approval:** 2 business days (Verified)
- **Assets:** Tool URL (they handle listing details)
- **Value:** Verified checkmark, newsletter to 250K subscribers, video/tutorial placement, eligibility for sponsorship campaigns
- **Refund:** Full refund if rejected; no refund once published
- **Editorial bar:** They test tools personally. Must deliver on claims, have clear privacy practices.

### BetaList

200K monthly visitors. High conversion rate (12-15% vs PH's 3-5%).

- **Cost:** Free (2-3 month queue) or $129 expedited (days to review, 1-2 weeks to feature, includes newsletter)
- **Submit:** betalist.com
- **Approval:** Editorial review; can be rejected. Resubmit after 2-3 months with improvements.
- **Requirements:** Custom landing page on own domain (no Vercel/Netlify subdomains). Sign-up mechanism. Mobile responsive. 3-5 screenshots. One-sentence pitch (no buzzwords).
- **Value:** 50-300 signups typical, dofollow DR 75 backlink, Twitter repost (~160 retweets)
- **On feature day:** Share BetaList page on social, write a comment introducing yourself

### Uneed

40-70K monthly visitors. Strong newsletter (15K subs, 40% open rate).

- **Cost:** Free (queue) or $29.99 to skip line and pick launch date
- **Submit:** uneed.best/submit-a-tool (auto-scrapes your URL)
- **Approval:** No editorial gate; queue-based
- **Launch time:** Daily at 12:00 AM PST. Pick a weekday.
- **Value:** DR 74 dofollow backlink. Top 3 weekly get newsletter feature.
- **Tip:** Power users have vote multipliers (2x at 5-day streak, up to 5x at 1000-day). Notify network before launch day, not after.
- **Relaunch:** $15 if first attempt underperforms

### DevHunt

~100K registered developers. Small but laser-focused dev audience.

- **Cost:** Free (queue) or paid expedited (pricing not public)
- **Submit:** devhunt.org, sign in with GitHub
- **Approval:** Queue-based for free
- **Assets:** Name, tagline, logo, banner, category (AI, API, Open Source, Hosting), about section, demo URL
- **Value:** DR 62 dofollow backlink. Winners stay on homepage permanently. Each listing gets its own Google-indexed page.
- **Voting:** GitHub-reputation-weighted. Active developers' votes count more.

### MicroLaunch

Small but engaged indie community. 30-day launch window (not 24hr sprint).

- **Cost:** Free (queue, days/weeks) or $39/month to skip queue
- **Submit:** microlaunch.net
- **Assets:** Name, description, screenshots, founder story, live URL
- **Value:** DR 58-59 dofollow backlink, dual scoring (idea + product), 30-day visibility
- **Tip:** Offer a discount to get placed in Top Deals section. Engage throughout the full month.
- **Honest assessment:** Low traffic (~2K monthly visitors). Worth doing only because it's cheap and low-effort.

### AI Toolbox

Negligible traffic. Free, 2 minutes.

- **Cost:** Free. Requires adding their backlink to your homepage.
- **Submit:** aitoolbox.today/submit
- **Assets:** Website name, URL. Description auto-generated by GPT-4o.
- **Value:** Minimal. Do it as part of the bulk submission pass, not as a standalone effort.

## Phase 2: Community Platforms (need 1-2 weeks prep)

These require building presence before posting. Start account warmup immediately.

### Hacker News (Show HN)

The most technically sophisticated audience. One front-page post can drive thousands of developer signups.

**Rules:**
- Title must start with "Show HN:"
- Must be something you personally worked on and are available to discuss
- Must be non-trivial, not a quickly-generated one-off
- Must be easy to try without signup barriers
- Never ask friends to upvote (vote-ring detection will penalize you)
- Landing pages and fundraiser pages are explicitly banned

**Title draft:** `Show HN: Dazzle, cloud browsers that let AI agents livestream their work`

**Alternative titles:**
- `Show HN: I built cloud browser pods so AI agents can stream to Twitch`
- `Show HN: Dazzle, MCP-programmable cloud browsers with live streaming ($0.10/hr)`

**First comment (post within 60 seconds):**

Use the founder story from the Positioning section above. Structure: personal backstory, what makes it different (MCP + K8s + Chrome, not GPU inference), technical details (architecture, cost breakdown), invite feedback ("curious how others are making agent work visible" or "what would you stream if you had a cloud browser with RTMP output?").

**Timing:** Tuesday or Wednesday, 8:30-9:30 AM Eastern.

**If it flops:** Email hn@ycombinator.com to request the second-chance pool. Put your email in your HN profile.

**What HN loves about tools like this:**
- Concrete technical specs ("$0.10/hr," "K8s pods," "full CDP access")
- Open-source components or architecture transparency
- Solving a real problem you personally had
- No marketing language whatsoever

**What triggers hostility:**
- Thin API wrappers with no novel engineering
- Hype language or inflated claims
- Requiring signup to try
- Being defensive when criticized

### Reddit

Largest potential reach across niche communities. Requires 2 weeks of genuine participation first.

**Account prep (start now):**
- Build 200-500+ karma through genuine comments in target subreddits
- Use a real profile: real name, photo, bio saying "Building Dazzle"
- No promotional posts until karma threshold is hit

**Launch sequence:**

1. **Day 1, 6-8am EST:** r/SideProject (503K members). Text post, "I built..." format. Most forgiving launch sub.
2. **Day 2-3:** r/SaaS weekly thread (409K). r/buildinpublic (27K). Different framing for each.
3. **Day 4-5:** r/LocalLLaMA (653K, agent/LLM angle). r/artificial (AI tool angle). r/AI_Agents.
4. **Day 7+:** r/Twitch (streaming angle). r/creativecoding (visualizer angle). r/digitalsignage.
5. **If free demo exists with no signup:** r/InternetIsBeautiful (17M members, but must be completely free with no signup wall).

**Post format:** Text post with "I built..." framing. Never link-only posts. Include the why (personal problem), what (technical approach), and an ask (specific feedback request). Embed video demo link in body.

**Critical rules:**
- Never post identical content across subreddits. Customize every post for the community.
- Never use marketing language ("revolutionary," "game-changing").
- Reply to every comment in the first 2 hours.
- Space out posts: one per subreddit, never the same day.

**Subreddits to avoid posting in (use designated threads only):**
- r/Entrepreneur: permanent ban for sales posts outside "Thank You Thursday"
- r/startups: monthly "Share Your Startup" thread only
- r/webdev: strict 9:1 participation rule

### Indie Hackers

Converts 3-8x better than Product Hunt for founder-focused products. 23.1% conversion per engaged post.

**Account setup:**
- Create account at indiehackers.com
- Comment genuinely on a few posts to unlock posting (new accounts are gated)
- Create product page at indiehackers.com/products

**Post format:** NOT an announcement. Write a story with specific numbers: "I pivoted 5 times in 10 months, burned $300K, and finally found what sticks. Here's what I learned about agent-driven streaming." Include revenue transparency (even if $0), technical decisions, failures. The community rewards vulnerability and real metrics.

**Headline formulas that work:**
- "I [accomplished thing], here's how"
- "X months building [product]: honest lessons from $0 to [current state]"
- "[Specific metric] by doing [specific thing]"

**What doesn't work:** Pure announcements ("My app just launched"), long rambling posts, self-promotional content without value.

**Ongoing:** Monthly milestone updates. Engage 60/40 (others' content vs yours). Build email list from IH traffic.

### Peerlist

100K users, 400K monthly visits. Developer/designer focused.

**Prep (2 weeks before launch):**
- Create profile, fill out 100% (name, tagline, logo, screenshots, description, category, tech tags)
- Engage daily: comment, upvote, appreciate projects
- Build follower base and activity streak (high-streak users' votes are 2-3x weighted)

**Launch:**
- Submissions accepted ONLY on Mondays, 12:00 AM to 11:59 PM UTC
- Prepare everything by Friday
- All submitted projects get featured (unlike PH)
- Ranking randomized for first 2 days, then sorted by aggregate score

**Assets:**
- Project name (45 chars max)
- Tagline (60 chars max)
- Logo (500x500px, max 15MB)
- Screenshots (1200x630px, 1-4 images)
- Description (5,000 chars max)
- Categories (up to 3)
- Tech tags (up to 10)
- Demo link

**Value:** Free. Top 3 weekly get newsletter + social + badge. 100-upvote club gets special gifts. Nofollow backlinks (DR 76).

## Phase 3: Newsletter Pitches (after traction)

Wait until you have signal: upvotes from earlier launches, user numbers, a Show HN run. Newsletters want newsworthy tools, not cold submissions.

### Ben's Bites

115-158K subscribers, 45% open rate. Builder/founder audience.

**Free path:**
- Submit at news.bensbites.com (community upvote-driven aggregator, like HN for AI)
- Create account, submit link, rally initial upvotes from real users
- Top-voted submissions get pulled into the newsletter
- DM @bentossell on X with a compelling demo

**Paid path:** $200-$2,000 via Grizzly Ads (sponsor.bensbites.co). Classified ad $200, tools section $1,200, main sponsor $2,000.

**Tip:** Having simultaneous PH or HN buzz when you submit increases odds dramatically.

### The Rundown AI

2M+ subscribers, 51.7% open rate. 45% C-level/founder audience.

**Free path:**
- Submit at rundown.ai/submit (editorial review)
- DM @rowancheung on X
- They feature 5-10 tools daily; the bar is "interesting and useful," not revolutionary

**Paid path:** Custom quote via rundown.ai/advertise-with-us. Expect premium rates (2M+ audience). Slots book months ahead, 80%+ repeat sponsors.

**Positioning for this audience:** Executive-facing. Emphasize business impact: "24/7 streaming without human operators," "agent builders monetizing their agents as content creators," "$0.10/hr infrastructure."

## Phase 4: Product Hunt (the coordinated launch, 2-4 weeks out)

Product Hunt is the capstone. Use earlier launches to refine messaging, gather social proof, build a supporter base of ~400 people.

**Critical context:** Only ~10% of launches get "Featured" now. The homepage has "Featured" and "All" tabs. Landing in "All" means ~70% less visibility. Featured status is manually curated by PH's team based on: useful, novel, high-craft, creative.

**Assets checklist:**

| Asset | Spec |
|-------|------|
| Tagline | 60 chars max |
| Description | 500 chars max |
| Thumbnail | 240x240px, under 3MB, GIF OK |
| Gallery images | Min 2, recommended 1270x760px, under 3MB each |
| Cover/hero | 2400x1200px, under 500KB, PNG |
| Video | YouTube URL, under 60s, not private |
| First comment | ~200 words, pre-written, post within 60 seconds |

**First comment structure:**
1. Hook (1-2 sentences): Something personal or surprising about the journey
2. Problem (2-3 sentences): The gap in agent infrastructure
3. Solution (2-3 sentences): What Dazzle does differently
4. Social proof (1-2 sentences): User count, notable users, metrics from earlier launches
5. Ask (1 sentence): An engaging question, never "please upvote"

**Timing:** 12:01 AM PST. Best days: Monday or Friday for less competition, Tue-Thu for max traffic. Developer tools sometimes outperform on weekends.

**Pre-launch (4-8 weeks ideal, minimum 2):**
- Build ~400 supporters (from earlier launches, social, email list)
- Become active PH member (upvote, comment on other products)
- Consider recruiting a Hunter (established PH member) for their follower network
- Brief supporters on exact timing and URL
- Prepare all copy, images, video, first comment, FAQ responses, social posts

**Launch day:**
- Post first comment within 60 seconds
- Reply to every comment all day
- One substantive comment = ~40-50 upvotes in algorithmic weight
- Products with 50+ comments consistently outrank vote-only products
- Upvote quality matters: established accounts (365+ days, regular engagement) carry ~10x algorithmic weight vs new accounts

**Post-launch:**
- Repurpose launch assets across all other platforms
- Share on LinkedIn, X, Reddit, IH
- PH audience engages with trending products for days after launch

**Re-launch:** Must wait 6 months between launches. Requires a significant update.

## Recommended Sequence

| Day | Action |
|-----|--------|
| 0 | Create accounts on all 15 platforms. Start Reddit/IH/Peerlist engagement. |
| 1 | Submit to TAAFT ($347, for $300 PPC bonus). |
| 2-3 | Submit to Toolify, Futurepedia, BetaList, Uneed, DevHunt, MicroLaunch, AI Toolbox. |
| 7-14 | Continue Reddit/IH/Peerlist karma building. Prep Show HN post and first comment. |
| 14 | Show HN launch (Tue/Wed 8:30am ET). Same day: Reddit r/SideProject. |
| 15-16 | IH story post. Reddit expansion (r/LocalLLaMA, r/artificial). |
| 17 | Submit to Ben's Bites news aggregator. Peerlist Monday launch. |
| 18-20 | Reddit r/Twitch, r/creativecoding, r/digitalsignage posts. |
| 21 | Pitch newsletters (Ben's Bites DM, Rundown AI submit) with traction numbers. |
| 28 | Product Hunt launch. Cross-promote everything. |

## Budget Summary

| Tier | Platforms | Cost |
|------|-----------|------|
| Free only | AI Toolbox, DevHunt, MicroLaunch (free queue), BetaList (free queue), Peerlist, HN, Reddit, IH | $0 |
| Fast-track directories | TAAFT, Toolify, Futurepedia, Uneed, BetaList expedited, MicroLaunch skip | ~$1,140 |
| Newsletter sponsorships (optional) | Ben's Bites classified, Uneed newsletter | ~$317 |
| Full budget | All paid tiers | ~$1,457 |

The free tier alone (all 15 platforms, using free queues where available) costs $0 and covers every platform on the list. The paid tiers buy speed and guaranteed newsletter placements.

## Sources

Platform research conducted March 25, 2026. Key references:

- Product Hunt: producthunt.com/launch/preparing-for-launch
- Hacker News: news.ycombinator.com/showhn.html
- Reddit: foundevo.com/best-subreddits-to-promote-your-startup
- Indie Hackers: indiehackers.com/products
- BetaList: betalist.com/criteria
- Uneed: uneed.best/how-it-works
- Peerlist: peerlist.neetokb.com/articles/project-spotlight-faqs-and-guidelines
- DevHunt: devhunt.org/blog/tools-developers-guide-launches-on-devhunt
- TAAFT: theresanaiforthat.com/get-featured
- Futurepedia: futurepedia.io/submit-tool
- Toolify: toolify.ai/submit
- MicroLaunch: microlaunch.net/premium
- Ben's Bites: news.bensbites.com
- The Rundown AI: rundown.ai/submit
