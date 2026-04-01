#!/usr/bin/env python3
"""
Dazzle Pricing Model Generator

Tweak the variables below, then run:
    python3 scripts/pricing-model.py

Outputs the full pricing-model.md to docs/pricing-model.md.
"""

import math
import os

# ============================================================================
# INFRASTRUCTURE VARIABLES
# ============================================================================

# Fixed costs (always running)
FIXED_COSTS = {
    "Control plane nodes (cpx21)":   {"spec": "3 shared vCPU / 4 GB",   "qty": 3, "cost": 26},
    "Worker nodes (ccx43)":          {"spec": "16 dedicated vCPU / 64 GB", "qty": 2, "cost": 224},
    "Load balancers (lb11)":         {"spec": "Layer 4",                 "qty": 2, "cost": 7},
    "Hetzner volumes (5Gi PG)":      {"spec": "CSI storage",            "qty": 1, "cost": 1},
    "Cloudflare":                    {"spec": "Pro plan + R2",          "qty": 1, "cost": 25},
    "Clerk (auth)":                  {"spec": "Pro plan",               "qty": 1, "cost": 125},
    "Domain + misc":                 {"spec": "",                       "qty": 0, "cost": 5},
}

# CPU nodes
CPU_NODE_COST_MO = 112        # ccx43 monthly cost
CPU_STAGES_PER_NODE = 8       # baseline packing density (720p)
HOURS_PER_MONTH = 730         # ~365.25*24/12

# GPU nodes (RunPod SECURE RTX 4090)
GPU_NODE_COST_HR = 0.60
GPU_MAX_STAGES_PER_NODE = 4

# Other variable costs
R2_PER_STAGE_MO = 0.01
STRIPE_PERCENT = 0.029
STRIPE_FLAT = 0.30
TAX_RATE = 0.25              # C-corp income tax

# ============================================================================
# PRICING VARIABLES
# ============================================================================

# Plan prices
STARTER_PRICE = 19.99
PRO_PRICE = 79.99

# CPU hours included
FREE_CPU_HRS = 24
STARTER_CPU_HRS = 750
PRO_CPU_HRS = 1500

# CPU overage rates
STARTER_CPU_OVERAGE = 0.15
PRO_CPU_OVERAGE = 0.04

# GPU rates
STARTER_GPU_RATE = 0.90
PRO_GPU_RATE = 0.70

# GPU trial
GPU_TRIAL_HRS = 2

# Stage limits
FREE_STAGE_LIMIT = 1
STARTER_STAGE_LIMIT = 3
PRO_STAGE_LIMIT = "Unlimited"

# Destinations
FREE_DESTINATIONS = "Dazzle + 1 external"
STARTER_DESTINATIONS = "Dazzle + 1 external"
PRO_DESTINATIONS = "Dazzle + 5 external"

# ============================================================================
# SCALE ECONOMICS ASSUMPTIONS
# ============================================================================

PLAN_MIX_STARTER = 0.55
PLAN_MIX_PRO = 0.45
FREE_TO_PAID_RATIO = 0.5     # free users per paid user

# GPU adoption assumptions
GPU_ADOPTION_RATE = 0.60
STARTER_AVG_GPU_HRS = 25
PRO_AVG_GPU_HRS = 30
PRO_OVERAGE_RATE = 0.30      # % of Pro users with 1 extra always-on stage

# GPU packing for scale economics
GPU_PACK_DENSITY = 2          # stages per node (50% packing)

# ============================================================================
# PERSONA DEFINITIONS
# ============================================================================

PERSONAS = [
    {
        "name": "Claude Code streamer",
        "description": "streaming my agent working",
        "who": "Developer (25-35) already using Claude Code or Cursor 4+ hrs/day. Has a Twitch account they barely use. Saw a tweet of someone streaming their AI agent building a project.",
        "discovery": "Twitter/X, Hacker News Show HN, stream-examples repo.",
        "week1": "Pastes llms-full.txt into Claude Code. Tells it to build a dashboard showing git activity, task progress, terminal output. Syncs to a stage. Streams to Twitch. Gets 2 viewers. Tweaks the layout. Leaves it running.",
        "steady_state": "Stream runs whenever they're coding — 15-25 hrs/week. They iterate on the dashboard a few times, add a \"currently working on\" panel, maybe push events from CI. Some make it a habit; ~40% churn after month 2 when novelty fades.",
        "llms_txt": "Heavy — this is literally who it's for. They paste it every session.",
        "cpu_hrs": (60, 100),
        "gpu_hrs": (0, 5),
        "plan": "Starter",
        "try_yr1": (200, 500),
        "stick": (50, 100),
        "margin_driver": "Volume + low utilization",
        "funnel_note": "Low ARPU but highest volume.",
    },
    {
        "name": "Generative art looper",
        "description": "my shader runs 24/7 on Twitch Art",
        "who": "Creative coder (20-40) writing p5.js, Three.js, or raw GLSL. Has a portfolio site. Uses AI to iterate on shader code. Knows about Twitch's Art category.",
        "discovery": "r/creativecoding, creative coding Discord, Twitter #genart.",
        "week1": "Builds a generative piece locally. Syncs to Dazzle CPU stage — realizes fragment shader runs at 3 FPS. Tries GPU tier, hits 30 FPS. Impressed. Connects to Twitch Art.",
        "steady_state": "Builds 2-3 pieces over a month (4-6 hr creative sessions each). Picks one as their \"permanent\" stream. Leaves it running 24/7. Active dev: 4-6 hrs/week in bursts. Passive streaming: always-on.",
        "llms_txt": "Moderate — during dev sessions to iterate on content. Once the piece is running, they use CLI directly.",
        "cpu_hrs": (40, 730),
        "gpu_hrs": (10, 50),
        "plan": "Starter/Pro",
        "try_yr1": (30, 50),
        "stick": (10, 15),
        "margin_driver": "GPU PAYG + marketing value",
        "funnel_note": "Tiny segment but high ARPU and great for marketing (visible, shareable content).",
    },
    {
        "name": "Crypto dashboard",
        "description": "24/7 trading stream, zero effort",
        "who": "Crypto trader or fintech builder (25-45). Has a trading bot or portfolio tracker. Wants a 24/7 YouTube/Twitch stream showing live market data. Currently would need OBS on a VPS — too much hassle.",
        "discovery": "Crypto Twitter. Someone shares a stream of a live Dexscreener dashboard and links Dazzle.",
        "week1": "Builds an HTML dashboard with TradingView embeds, live prices via WebSocket, maybe a chat feed. 8-10 hours total. Syncs to Dazzle, connects to YouTube.",
        "steady_state": "Stream just runs. Updates the dashboard once every 2-3 weeks — 30 min to 2 hrs per update. Essentially zero active compute beyond the always-on stage. **This is the dream customer:** pays Pro/month, costs ~${cpu_stage_cost_mo:.0f} in compute, files zero support tickets.",
        "llms_txt": "Low — used once during initial setup, then CLI directly.",
        "cpu_hrs": (730, 730),
        "gpu_hrs": (0, 0),
        "plan": "Pro",
        "try_yr1": (50, 100),
        "stick": (20, 30),
        "margin_driver": "Best unit economics (set-and-forget)",
        "funnel_note": "Best unit economics of any persona. High retention because the stream generates followers/revenue for them.",
    },
    {
        "name": "AI VTuber builder",
        "description": "my character streams 24/7",
        "who": "Builder (20-30) deep in the AI companion/VTuber scene. Tried Open-LLM-VTuber or AIRI locally. Bottleneck: needs a PC running OBS 24/7 with a GPU.",
        "discovery": "AI VTuber Discord communities, GitHub (Open-LLM-VTuber, AIRI repos).",
        "week1": "Most complex setup — character model (Live2D/3D), TTS pipeline, LLM for personality, lip sync, web renderer. 20+ hours. Heavy AI assistance. Likely in the Dazzle Discord asking questions.",
        "steady_state": "If they get it working, it runs 24/7. They spend 3-5 hrs/week tweaking personality, monitoring chat integration, adding features. The 24/7 always-on GPU cost (${gpu_rate_pro}/hr × {hours_per_month} = ${gpu_always_on_mo:.0f}/mo) is prohibitive, so they split: CPU for the web rendering, GPU only for heavy scenes or dev.",
        "llms_txt": "Heavy during setup — their AI agent needs deep understanding of events, persistence, and content sync.",
        "cpu_hrs": (730, 730),
        "gpu_hrs": (20, 30),
        "plan": "Pro",
        "try_yr1": (5, 15),
        "stick": (3, 5),
        "margin_driver": "High ARPU + community growth",
        "funnel_note": "Tiny volume but high ARPU and extremely vocal — they create visible content that attracts more users. Partnership with AIRI/Open-LLM-VTuber could 10x this segment.",
    },
    {
        "name": "Build in public",
        "description": "watch my AI build my startup",
        "who": "Solo founder (25-40) building a SaaS. Active on Indie Hackers and Twitter. \"Build in public\" is their marketing strategy. Streaming their AI agent working is the ultimate form.",
        "discovery": "Indie Hackers, Twitter build-in-public community, another \"watch me build\" stream.",
        "week1": "Sets up a simple status page — current task, recent commits, maybe a terminal-like view. 3-4 hours. Streams to Twitch or YouTube.",
        "steady_state": "Turns stream on for build sessions — 3-4 sessions/week, 2-4 hrs each. 8-16 hrs/week. Content quality varies wildly (sometimes interesting, sometimes watching CI for 20 minutes). **Novelty wears off fast.** Most stream less by month 2, then cancel.",
        "llms_txt": "Moderate — pasted at start of build sessions.",
        "cpu_hrs": (30, 60),
        "gpu_hrs": (0, 2),
        "plan": "Free/Starter",
        "try_yr1": (300, 500),
        "stick": (30, 50),
        "margin_driver": "Top-of-funnel only",
        "funnel_note": "Largest top-of-funnel but highest churn. Most stay on Free or barely use Starter.",
    },
]

# ============================================================================
# TAM / SAM / SOM — MARKET SIZING
# ============================================================================
# Sources cited inline. All figures as of March 2026 unless noted.

# --- TAM: Adjacent markets (total spend, not users) ---
TAM_MARKETS = [
    {
        "name": "Live streaming platforms & tools",
        "size_b": 97,         # $97B in 2026 (Mordor Intelligence)
        "cagr": 0.27,         # 26.7% CAGR 2026-2031 (Mordor Intelligence)
        "cagr_period": "2026-2031",
        "source": "Mordor Intelligence",
        "note": "Includes Twitch, YouTube Live, Kick, Restream, StreamYard, OBS ecosystem",
    },
    {
        "name": "AI agent infrastructure",
        "size_b": 11.8,       # $11.8B in 2026 (Fortune Business Insights)
        "cagr": 0.41,         # 40.5% CAGR 2026-2034 (Fortune Business Insights)
        "cagr_period": "2026-2034",
        "source": "Fortune Business Insights",
        "note": "Browserbase, E2B, Steel, Hyperbrowser + broader agent tooling",
    },
    {
        "name": "Digital signage software",
        "size_b": 14.3,       # $14.3B in 2026 (The Business Research Company)
        "cagr": 0.12,         # 12.3% CAGR 2026-2030 (The Business Research Company)
        "cagr_period": "2026-2030",
        "source": "The Business Research Company",
        "note": "ScreenCloud, Yodeck, OptiSigns — programmatic display content",
    },
    {
        "name": "VTuber / virtual creator economy",
        "size_b": 3.1,        # $3.1B in 2026 (Mordor Intelligence)
        "cagr": 0.10,         # 9.6% CAGR 2026-2031 (Mordor Intelligence)
        "cagr_period": "2026-2031",
        "source": "Mordor Intelligence",
        "note": "Live2D, AI companions, avatar streaming",
    },
]

# --- SAM: Segments where Dazzle competes directly ---
SAM_SEGMENTS = [
    {
        "name": "Cloud browser-as-a-service",
        "size_m": 50,         # ~$50M (Browserbase $4.4M ARR + E2B + Steel + Hyperbrowser)
        "cagr": 0.80,         # ~80% — Browserbase 0→$4.4M in 16mo, category is exploding
        "customers_lo": 5000, # Browserbase 1K+ orgs, 20K+ devs; + E2B/Steel/Hyper
        "customers_hi": 8000,
        "customers_basis": "Browserbase 1K+ paying orgs + 20K devs (Contrary Research). E2B, Steel, Hyperbrowser est. 4K-7K combined.",
        "source": "Browserbase $4.4M ARR (Latka, Jul 2025), plus E2B/Steel/Hyperbrowser est.",
        "dazzle_angle": "Dazzle adds streaming output — no competitor does browser + broadcast",
        "dazzle_capturable_pct": 0.02,  # 2% — most cloud browser users don't need streaming
    },
    {
        "name": "24/7 streaming automation",
        "size_m": 30,         # LiveReacting + Gyre + OhBubble + Restream 24/7 segment
        "cagr": 0.15,         # ~15% — steady growth, mature segment
        "customers_lo": 15000,  # LiveReacting 10K+ creators; Gyre + OhBubble est. 5K-10K
        "customers_hi": 25000,
        "customers_basis": "LiveReacting: 10K+ creators (livereacting.com). Gyre, OhBubble, Restream 24/7 segment est. 5K-15K.",
        "source": "LiveReacting, Gyre, OhBubble pricing pages; est. from public tier data",
        "dazzle_angle": "Competitors loop pre-recorded video; Dazzle runs live, dynamic content",
        "dazzle_capturable_pct": 0.01,  # 1% — most want simple video loops, not programmable content
    },
    {
        "name": "AI VTuber infrastructure",
        "size_m": 5,          # Very early — mostly OSS/local
        "cagr": 1.00,         # ~100% — nascent market, doubling annually
        "customers_lo": 500,  # Active builders (not stargazers)
        "customers_hi": 1500,
        "customers_basis": "GitHub: AIRI 34K stars, Open-LLM-VTuber 6.2K, AI-Vtuber 4.3K, plus ~8 smaller frameworks. Active builders est. 1-3% of stargazers.",
        "source": "GitHub star counts: AIRI 34K, Open-LLM-VTuber 6.2K, AI-Vtuber 4.3K",
        "dazzle_angle": "Every framework requires local OBS + GPU; Dazzle eliminates both",
        "dazzle_capturable_pct": 0.03,  # 3% — small base but high need for cloud streaming
    },
    {
        "name": "Developer streaming / build-in-public",
        "size_m": 10,         # Twitch Science & Tech + Just Chatting dev streams
        "cagr": 0.50,         # ~50% — driven by AI coding tool adoption (95% of devs)
        "customers_lo": 5000,   # Twitch Science & Tech streamers + indie hacker builders
        "customers_hi": 15000,
        "customers_basis": "Twitch Science & Technology: est. 3K-5K active monthly streamers. AI coding agent users who stream: Claude Code ~18.9M MAU, Cursor 360K+ subscribers — even 0.01% = 2K-5K potential streamers.",
        "source": "Twitch Science & Technology category; Claude Code 18.9M MAU (DemandSage); Cursor 360K+ subs (GetPanto)",
        "dazzle_angle": "AI coding agents (Claude Code, Cursor) create new content type",
        "dazzle_capturable_pct": 0.02,  # 2% — many will try, few will stick
    },
    {
        "name": "Creative coding / generative art streaming",
        "size_m": 5,          # Twitch Art + YouTube generative streams
        "cagr": 0.20,         # ~20% — growing but niche
        "customers_lo": 2000,   # Twitch Art: 4.1M followers but ~2K-5K regular streamers
        "customers_hi": 5000,
        "customers_basis": "Twitch Art category: 4.1M followers, est. 2K-5K monthly active streamers. Generative art subset (code-based, not painting/drawing) est. 500-1,500.",
        "source": "Twitch Art category (4.1M followers); three.js 108K GitHub stars, p5.js community",
        "dazzle_angle": "GPU stages run shaders at 30 FPS without local hardware",
        "dazzle_capturable_pct": 0.02,  # 2% — most creative coders work locally
    },
]

# --- SOM: What Dazzle can realistically capture in year 1-2 ---
# Derived from persona analysis (see Persona Validation section)
SOM_YEAR1_USERS_LO = 113     # from persona stick totals
SOM_YEAR1_USERS_HI = 200
SOM_YEAR2_MULTIPLIER = 3     # organic + 1-2 framework partnerships

# Platform context
TWITCH_MONTHLY_STREAMERS = 7_060_000     # 7.06M unique channels went live (2026)
TWITCH_CONCURRENT_CHANNELS = 97_200      # avg concurrent (2026)
TWITCH_CRYPTO_CONCURRENT = 25_800        # Crypto + Crypto & Trading categories
AI_CODING_TOOL_ADOPTION = 0.95           # 95% of devs use AI tools weekly (2026)
CLAUDE_CODE_MOST_LOVED = 0.46            # 46% "most loved" rating among devs

# ============================================================================
# CPU density sweep
# ============================================================================

CPU_DENSITY_SWEEP = [
    (6,  "Conservative — heavy workloads"),
    (8,  "720p baseline"),
    (10, "Optimistic — lighter workloads"),
    (12, "Aggressive — needs profiling"),
]

# GPU density sweep
GPU_DENSITY_SWEEP = [
    (1, "Solo tenant worst case"),
    (2, "50% pack"),
    (3, ""),
    (4, "Full node"),
]

# Scale economics user counts
SCALE_USER_COUNTS = [5, 10, 25, 50, 100, 250, 500]

# GPU adoption sensitivity (at N paying users)
GPU_SENSITIVITY_AT = 50
GPU_SENSITIVITY_RATES = [0.30, 0.45, 0.60]

# ============================================================================
# DERIVED VALUES
# ============================================================================

def d(x):
    """Format dollar amount."""
    if x >= 1000:
        return f"${x:,.0f}"
    if x == int(x):
        return f"${x:.0f}"
    if abs(x) < 0.005:
        return "$0"
    # For values like 0.019, 0.029 — show 3 decimals
    if abs(x) < 0.1 and x != round(x, 2):
        return f"${x:.3f}"
    # For values like 0.15, 0.04, 0.60, 0.90 — show 2 decimals
    return f"${x:.2f}"

def pct(x):
    """Format percentage."""
    return f"{x:.0f}%"

def compute():
    fixed_total = sum(v["cost"] for v in FIXED_COSTS.values())

    cpu_cost_hr = CPU_NODE_COST_MO / HOURS_PER_MONTH / CPU_STAGES_PER_NODE
    cpu_cost_mo = CPU_NODE_COST_MO / CPU_STAGES_PER_NODE
    gpu_cost_blended = GPU_NODE_COST_HR / GPU_PACK_DENSITY

    # Starter margins
    starter_cpu_cost = cpu_cost_mo * (STARTER_CPU_HRS / HOURS_PER_MONTH)
    starter_base_margin = (STARTER_PRICE - starter_cpu_cost) / STARTER_PRICE
    starter_after_tax = starter_base_margin * (1 - TAX_RATE)

    # Pro margins
    pro_cpu_cost = cpu_cost_mo * (PRO_CPU_HRS / HOURS_PER_MONTH)
    pro_base_margin = (PRO_PRICE - pro_cpu_cost) / PRO_PRICE
    pro_after_tax = pro_base_margin * (1 - TAX_RATE)

    # Typical PAYG
    starter_typical_payg = GPU_ADOPTION_RATE * STARTER_AVG_GPU_HRS * STARTER_GPU_RATE
    pro_overage_rev = PRO_OVERAGE_RATE * HOURS_PER_MONTH * PRO_CPU_OVERAGE
    pro_gpu_payg = GPU_ADOPTION_RATE * PRO_AVG_GPU_HRS * PRO_GPU_RATE
    pro_typical_payg = pro_overage_rev + pro_gpu_payg

    # Typical total
    starter_typical_total = STARTER_PRICE + starter_typical_payg
    pro_typical_total = PRO_PRICE + pro_typical_payg

    # Free tier cost
    free_cost = FREE_CPU_HRS * cpu_cost_hr + (GPU_TRIAL_HRS * gpu_cost_blended / 12)  # amortized trial

    # Overage trap
    overage_trap_cost = HOURS_PER_MONTH * STARTER_CPU_OVERAGE

    # Target revenue (40% after-tax → pre-tax = 1 - TAX_RATE needs margin of target/(1-tax))
    target_after_tax = 0.40
    target_pre_tax = target_after_tax / (1 - TAX_RATE)  # ~51.3%
    target_cpu_rev = cpu_cost_mo / (1 - target_pre_tax)
    target_gpu_blended = gpu_cost_blended / (1 - target_pre_tax)
    target_gpu_solo = GPU_NODE_COST_HR / (1 - target_pre_tax)

    # Pro CPU overage margin
    pro_overage_margin = (PRO_CPU_OVERAGE - cpu_cost_hr) / PRO_CPU_OVERAGE
    starter_overage_margin = (STARTER_CPU_OVERAGE - cpu_cost_hr) / STARTER_CPU_OVERAGE

    # Free tier CAC
    free_conv_low, free_conv_high = 0.15, 0.25
    cac_low = free_cost / free_conv_high  # higher conversion = lower CAC
    cac_high = free_cost / free_conv_low

    # GPU always-on cost (for VTuber persona note)
    gpu_always_on_mo = PRO_GPU_RATE * HOURS_PER_MONTH

    out = []
    def w(s=""):
        out.append(s)

    # ========================================================================
    # HEADER
    # ========================================================================
    w("# Dazzle Pricing Model — 3-Month Launch Plan")
    w()
    w(f"<!-- Generated by scripts/pricing-model.py — do not edit by hand -->")
    w()

    # ========================================================================
    # PRICING TIERS TABLE
    # ========================================================================
    w("## Pricing Tiers")
    w()
    w(f"| | Free | Starter ({d(STARTER_PRICE)}/mo) | Pro ({d(PRO_PRICE)}/mo) |")
    w("|---|---|---|---|")
    w(f"| CPU hours included | {FREE_CPU_HRS} hrs/mo | {STARTER_CPU_HRS} hrs/mo (~{STARTER_CPU_HRS // HOURS_PER_MONTH} always-on stage) | {PRO_CPU_HRS} hrs/mo (~{PRO_CPU_HRS // HOURS_PER_MONTH} always-on stages) |")
    w(f"| CPU overage | — | {d(STARTER_CPU_OVERAGE)}/hr | {d(PRO_CPU_OVERAGE)}/hr |")
    w(f"| GPU ({GPU_TRIAL_HRS} hrs free trial) | then blocked | then {d(STARTER_GPU_RATE)}/hr | then {d(PRO_GPU_RATE)}/hr |")
    w(f"| Resolution | 720p | 720p | 720p |")
    w(f"| Stage limit | {FREE_STAGE_LIMIT} | {STARTER_STAGE_LIMIT} | {PRO_STAGE_LIMIT} |")
    w(f"| Destinations | {FREE_DESTINATIONS} | {STARTER_DESTINATIONS} | {PRO_DESTINATIONS} |")
    w(f"| Privacy | Public | Public | Private |")
    w(f"| **Base margin** | cost center | {pct(starter_base_margin * 100)} pre-tax ({d(STARTER_PRICE - starter_cpu_cost)} on {d(STARTER_PRICE)}) | {pct(pro_base_margin * 100)} pre-tax ({d(PRO_PRICE - pro_cpu_cost)} on {d(PRO_PRICE)}) |")
    w(f"| **Typical PAYG** | — | ~{d(starter_typical_payg)}/mo ({pct(GPU_ADOPTION_RATE * 100)} of users × avg {STARTER_AVG_GPU_HRS} GPU hrs) | ~{d(pro_typical_payg)}/mo (avg {PRO_OVERAGE_RATE:.0%} overage stage + {PRO_AVG_GPU_HRS} GPU hrs) |")
    w(f"| **Typical total/user** | -{d(free_cost)}/mo | ~{d(starter_typical_total)}/mo ({d(STARTER_PRICE)} base + {d(starter_typical_payg)} PAYG) | ~{d(pro_typical_total)}/mo ({d(PRO_PRICE)} base + {d(pro_typical_payg)} PAYG) |")

    # Blended margins
    starter_blended_cost = starter_cpu_cost + GPU_ADOPTION_RATE * STARTER_AVG_GPU_HRS * gpu_cost_blended
    starter_blended_margin = (starter_typical_total - starter_blended_cost) / starter_typical_total
    pro_blended_cost = pro_cpu_cost + PRO_OVERAGE_RATE * HOURS_PER_MONTH * cpu_cost_hr + GPU_ADOPTION_RATE * PRO_AVG_GPU_HRS * gpu_cost_blended
    pro_blended_margin = (pro_typical_total - pro_blended_cost) / pro_typical_total
    w(f"| **Typical blended margin** | — | ~{pct(starter_blended_margin * 100)} (thin base + healthy PAYG) | ~{pct(pro_blended_margin * 100)} (strong base + healthy PAYG) |")
    w()

    w(f"Every user gets a **{GPU_TRIAL_HRS}-hour free GPU trial** (one-time, expires after 1 year). After the trial, free users are blocked; paid users pay per hour at their plan rate. Base subscription covers CPU; GPU is billed separately.")
    w()
    w("**Billing granularity:** Usage is tracked per-second internally and billed per-minute. Overage is reported to Stripe in hourly increments (ceil of metered minutes / 60).")
    w()
    w("#### How blended estimates are computed")
    w()
    w("The \"Typical PAYG\", \"Typical total\", and \"Blended margin\" rows above are estimates, not contractual. They model an average user on each plan:")
    w()
    w(f"- **Base margin** = `(plan price − CPU cost) / plan price`. CPU cost = `{d(CPU_NODE_COST_MO)}/mo node ÷ {CPU_STAGES_PER_NODE} stages × (included hrs ÷ {HOURS_PER_MONTH} hrs/mo)`.[^1]")
    w(f"- **Typical PAYG (Starter)** = `GPU adoption ({pct(GPU_ADOPTION_RATE * 100)}) × avg GPU hrs ({STARTER_AVG_GPU_HRS}) × Starter GPU rate ({d(STARTER_GPU_RATE)})` = {d(starter_typical_payg)}/mo.[^2]")
    w(f"- **Typical PAYG (Pro)** = CPU overage component + GPU component:")
    w(f"  - CPU overage: `{pct(PRO_OVERAGE_RATE * 100)} of Pro users run 1 extra always-on stage × {HOURS_PER_MONTH} hrs × {d(PRO_CPU_OVERAGE)}/hr` = {d(pro_overage_rev)}/mo averaged across all Pro users.[^3]")
    w(f"  - GPU: `{pct(GPU_ADOPTION_RATE * 100)} adoption × {PRO_AVG_GPU_HRS} avg hrs × {d(PRO_GPU_RATE)}/hr` = {d(pro_gpu_payg)}/mo.")
    w(f"  - Total Pro PAYG = {d(pro_overage_rev)} + {d(pro_gpu_payg)} = {d(pro_typical_payg)}/mo.")
    w(f"- **Blended margin** = `(typical total − total cost) / typical total`, where total cost includes actual CPU hours used (not included budget) + GPU hours at blended node cost ({d(gpu_cost_blended)}/hr at {GPU_PACK_DENSITY}/{GPU_MAX_STAGES_PER_NODE} packing).[^4]")
    w(f"- **Free tier cost** = `{FREE_CPU_HRS} CPU hrs × {d(cpu_cost_hr)}/hr + one-time {GPU_TRIAL_HRS}-hr GPU trial amortized over 12 months` = {d(free_cost)}/mo.[^5]")
    w()
    w(f"[^1]: Starter CPU cost: {d(CPU_NODE_COST_MO)} ÷ {CPU_STAGES_PER_NODE} × ({STARTER_CPU_HRS} ÷ {HOURS_PER_MONTH}) = {d(starter_cpu_cost)}. Pro: {d(CPU_NODE_COST_MO)} ÷ {CPU_STAGES_PER_NODE} × ({PRO_CPU_HRS} ÷ {HOURS_PER_MONTH}) = {d(pro_cpu_cost)}.")
    w(f"[^2]: {GPU_ADOPTION_RATE} × {STARTER_AVG_GPU_HRS} × {STARTER_GPU_RATE} = {starter_typical_payg:.2f}. This assumes {pct(GPU_ADOPTION_RATE * 100)} of Starter users use GPU at all, and those who do average {STARTER_AVG_GPU_HRS} hrs/mo.")
    w(f"[^3]: The {pct(PRO_OVERAGE_RATE * 100)} overage rate means ~1 in 3 Pro users runs a 3rd always-on stage. The overage cost ({d(HOURS_PER_MONTH * PRO_CPU_OVERAGE)}/mo) is averaged across all Pro users: {PRO_OVERAGE_RATE} × {d(HOURS_PER_MONTH * PRO_CPU_OVERAGE)} = {d(pro_overage_rev)}/mo.")
    w(f"[^4]: Blended margin uses *actual* infra cost, not the included budget. Starter blended cost = actual CPU ({d(starter_cpu_cost)}) + GPU ({GPU_ADOPTION_RATE} × {STARTER_AVG_GPU_HRS} × {d(gpu_cost_blended)}) = {d(starter_cpu_cost + GPU_ADOPTION_RATE * STARTER_AVG_GPU_HRS * gpu_cost_blended)}. Margin = ({d(starter_typical_total)} − {d(starter_cpu_cost + GPU_ADOPTION_RATE * STARTER_AVG_GPU_HRS * gpu_cost_blended)}) / {d(starter_typical_total)} = {pct(starter_blended_margin * 100)}.")
    w(f"[^5]: Free tier GPU amortization: {d(GPU_TRIAL_HRS * gpu_cost_blended)} one-time ÷ 12 months = {d(GPU_TRIAL_HRS * gpu_cost_blended / 12)}/mo. Total: {d(FREE_CPU_HRS * cpu_cost_hr)} + {d(GPU_TRIAL_HRS * gpu_cost_blended / 12)} = {d(free_cost)}/mo.")
    w()

    # ========================================================================
    # GRANTS MODEL
    # ========================================================================
    w("### Grants Model")
    w()
    w("All usage budgets and metering are modeled as **usage grants** — rows in the `usage_grants` table. Three grant shapes:")
    w()
    w("| Shape | minutes | rate | expires | Example |")
    w("|---|---|---|---|---|")
    w(f"| **Prepaid** | {GPU_TRIAL_HRS * 60} | $0 | 1 year | GPU signup trial ({GPU_TRIAL_HRS} hrs) |")
    w(f"| **Budget** | {STARTER_CPU_HRS * 60:,} | $0 | period end | Starter monthly CPU ({STARTER_CPU_HRS} hrs) |")
    w(f"| **Metered** | unlimited | $X/hr | never | GPU PAYG @ {d(STARTER_GPU_RATE)}/hr |")
    w()
    w("Grants are consumed FIFO (free first, then cheapest metered). On plan change, old metered grants expire and new ones are created at the new plan's rate. Prepaid grants (trials, promos) survive plan changes and cancellations.")
    w()

    # ========================================================================
    # STRATEGY
    # ========================================================================
    w("### Strategy: Pro-Led Growth")
    w()
    w(f"Starter is priced near break-even as an **acquisition funnel** — {d(STARTER_PRICE)} is impulse-purchase territory. Real margin comes from Pro and usage-based revenue (GPU + CPU overage).")
    w()
    w("**Why this works:**")
    w(f"- **${STARTER_PRICE:.0f} converts hobbyists to paying users.** At $29 they think about it. At {d(STARTER_PRICE)} they just do it. More users in the funnel → more Pro conversions.")
    w(f"- **Pro's {d(PRO_CPU_OVERAGE)}/hr CPU overage makes scaling cheap.** {PRO_CPU_HRS} included hours covers {PRO_CPU_HRS // HOURS_PER_MONTH} always-on stages. A 3rd stage costs ~{d(HOURS_PER_MONTH * PRO_CPU_OVERAGE)}/mo in overage — still {pct(pro_overage_margin * 100)} margin at {d(cpu_cost_hr)} cost. Users scale up without hitting walls.")
    w(f"- **Unlimited Pro stages creates open-ended expansion revenue.** No cap means power users grow into the product instead of outgrowing it.")
    w(f"- **Starter's 1-stage limit drives upgrades.** A Starter user wanting a 2nd stage must upgrade to Pro — there's no overage path. Pro at ${PRO_PRICE:.0f} includes {PRO_CPU_HRS // HOURS_PER_MONTH} always-on stages with cheap {d(PRO_CPU_OVERAGE)}/hr overage for more.")
    w(f"- **GPU revenue is independent of tier margins.** Every GPU hour is billed, so GPU packing density only affects GPU margin — it never erodes the base subscription.")
    w()

    # ========================================================================
    # WHY THESE PRICES
    # ========================================================================
    w("### Why These Prices")
    w()
    w(f"Prices are derived from infrastructure costs. Starter targets near break-even (~{pct(starter_base_margin * 100)} pre-tax). Pro targets 40%+ after-tax margin. GPU and CPU overage provide high-margin incremental revenue.")
    w()
    w("**Per-stage cost at different packing densities:**")
    w()
    w("| Stages/node | CPU cost/stage/mo | CPU cost/stage/hr | Notes |")
    w("|---|---|---|---|")
    for density, note in CPU_DENSITY_SWEEP:
        cost_mo = CPU_NODE_COST_MO / density
        cost_hr = cost_mo / HOURS_PER_MONTH
        w(f"| {density} | {d(cost_mo)} | {d(cost_hr)} | {note} |")
    w()

    w("| Stages/node | GPU cost/stage/hr | Notes |")
    w("|---|---|---|")
    for density, note in GPU_DENSITY_SWEEP:
        cost_hr = GPU_NODE_COST_HR / density
        label = f"{density}"
        if note:
            label += f" ({note})"
        w(f"| {label} | {d(cost_hr)} | |")
    w()

    w("**Target revenue:**")
    w(f"- CPU 720p ({d(cpu_cost_mo)} cost): {d(cpu_cost_mo)} / {target_pre_tax:.3f} = **{d(target_cpu_rev)}/stage/mo** ({pct(target_pre_tax * 100)} pre-tax for 40% after-tax)")
    w(f"- GPU 50% pack ({d(gpu_cost_blended)} cost): {d(gpu_cost_blended)} / {target_pre_tax:.3f} = **{d(target_gpu_blended)}/hr**")
    w(f"- GPU solo ({d(GPU_NODE_COST_HR)} cost): {d(GPU_NODE_COST_HR)} / {target_pre_tax:.3f} = **{d(target_gpu_solo)}/hr**")
    w()

    w("**Pricing decisions:**")
    w(f"- **{d(STARTER_PRICE)} Starter** — covers {STARTER_CPU_HRS} CPU hrs at {d(starter_cpu_cost)} cost. {pct(starter_base_margin * 100)} pre-tax / {pct(starter_after_tax * 100)} after-tax — intentionally thin. Starter's job is acquisition, not profit. {d(STARTER_PRICE)} is impulse-purchase for indie devs.")
    w(f"- **{d(PRO_PRICE)} Pro** — covers {PRO_CPU_HRS} CPU hrs at {d(pro_cpu_cost)} cost. {pct(pro_base_margin * 100)} pre-tax / {pct(pro_after_tax * 100)} after-tax — this is where margin lives. Pro users who scale to 3+ stages pay {d(PRO_CPU_OVERAGE)}/hr overage (still {pct(pro_overage_margin * 100)} margin), creating expansion revenue.")

    # GPU margins at different packing
    gpu_starter_margin_blended = (STARTER_GPU_RATE - gpu_cost_blended) / STARTER_GPU_RATE
    gpu_pro_margin_blended = (PRO_GPU_RATE - gpu_cost_blended) / PRO_GPU_RATE
    gpu_starter_margin_solo = (STARTER_GPU_RATE - GPU_NODE_COST_HR) / STARTER_GPU_RATE
    gpu_pro_margin_solo = (PRO_GPU_RATE - GPU_NODE_COST_HR) / PRO_GPU_RATE
    w(f"- **{d(STARTER_GPU_RATE)}/{d(PRO_GPU_RATE)} GPU (Starter/Pro)** — at 50% GPU pack ({d(gpu_cost_blended)} cost): {pct(gpu_starter_margin_blended * 100)}/{pct(gpu_pro_margin_blended * 100)} margin. At solo node ({d(GPU_NODE_COST_HR)} cost): {pct(gpu_starter_margin_solo * 100)}/{pct(gpu_pro_margin_solo * 100)} margin. Solo-node is below target but every GPU hour is revenue-positive. Packing improves with user growth.")
    w(f"- **{d(STARTER_CPU_OVERAGE)} Starter CPU overage** — {d(cpu_cost_hr)} cost = {pct(starter_overage_margin * 100)} margin. High rate intentional: it makes Pro upgrade math obvious.")
    w(f"- **{d(PRO_CPU_OVERAGE)} Pro CPU overage** — {d(cpu_cost_hr)} cost = {pct(pro_overage_margin * 100)} margin. Cheap enough that power users scale without friction, but still healthy margin.")
    w("- **Private stages on Pro** gates a high-value capability (client data, pre-launch content)")
    w("- **Unlimited Pro stages** — no artificial cap. Revenue scales with usage via overage.")
    w(f"- **Free tier** is an acquisition funnel — one-time {GPU_TRIAL_HRS} GPU hrs creates the \"holy crap\" moment with urgency (doesn't renew monthly), {FREE_CPU_HRS} CPU hrs runs out mid-month and triggers upgrade")
    w()

    # ========================================================================
    # UPGRADE PATH
    # ========================================================================
    w("### Upgrade Path")
    w()
    w(f"- **Free → Starter ({d(STARTER_PRICE)})**: Driven by hitting the {FREE_CPU_HRS}-hr CPU cap and wanting external destinations (Twitch/YouTube). {d(STARTER_PRICE)} is an impulse buy.")
    w(f"- **Starter → Pro ({d(PRO_PRICE)})**: Driven by the 1-stage cap — any user wanting a 2nd stage must upgrade. Pro includes {PRO_CPU_HRS // HOURS_PER_MONTH} always-on stages, private visibility, 5 destinations, cheaper GPU ({d(PRO_GPU_RATE)} vs {d(STARTER_GPU_RATE)}), and unlimited stages via {d(PRO_CPU_OVERAGE)}/hr overage.")
    w("- **Pro → Enterprise**: Future tier (post 3-month launch). Driven by SOC 2, team/org support, SLA, volume committed pricing.")
    w()

    # ========================================================================
    # INFRASTRUCTURE COST BASIS
    # ========================================================================
    w("## Infrastructure Cost Basis")
    w()
    w(f"### Fixed Costs (~{d(fixed_total)}/mo — always running)")
    w()
    w("| Component | Spec | Qty | Monthly Cost |")
    w("|---|---|---|---|")
    for name, info in FIXED_COSTS.items():
        qty_str = str(info["qty"]) if info["qty"] else ""
        w(f"| {name} | {info['spec']} | {qty_str} | ~{d(info['cost'])} |")
    w(f"| **Total** | | | **~{d(fixed_total)}/mo** |")
    w()

    w("### Variable Costs")
    w()
    w("| Resource | Unit Cost | Notes |")
    w("|---|---|---|")
    w(f"| ccx43 worker node | {d(CPU_NODE_COST_MO)}/mo ({d(CPU_NODE_COST_MO / HOURS_PER_MONTH)}/hr) | 16 dedicated vCPU / 64 GB RAM |")
    w(f"| CPU stage density | {CPU_STAGES_PER_NODE} stages/node (720p) | Mix of active and light workloads |")
    w(f"| Effective cost per CPU stage | ~{d(cpu_cost_mo)}/mo (~{d(cpu_cost_hr)}/hr) | {CPU_STAGES_PER_NODE} stages/node at 720p |")
    w(f"| GPU hour (RunPod SECURE) | {d(GPU_NODE_COST_HR)}/hr | RTX 4090, raw node cost |")
    w(f"| GPU hour (blended) | {d(gpu_cost_blended)}/hr | Avg across {GPU_PACK_DENSITY}/{GPU_MAX_STAGES_PER_NODE} node packing |")
    w(f"| R2 storage | ~{d(R2_PER_STAGE_MO)}/stage/mo | Negligible |")
    w(f"| Stripe fees | {STRIPE_PERCENT * 100:.1f}% + {d(STRIPE_FLAT)}/txn | |")
    w(f"| Tax rate | {pct(TAX_RATE * 100)} on income | C-corp |")
    w()

    # ========================================================================
    # GPU NODE ECONOMICS
    # ========================================================================
    w("### GPU Node Economics (RunPod SECURE)")
    w()
    w(f"GPU nodes are ephemeral — spin up on stage activation, drain after 5 min idle. Multi-tenant: up to {GPU_MAX_STAGES_PER_NODE} stages per RTX 4090 node. Scheduler packs stages onto lowest-utilization node first.")
    w()
    w(f"| Stages on RTX 4090 | Our cost/stage-hr | Revenue @ {d(STARTER_GPU_RATE)} (Starter) | Revenue @ {d(PRO_GPU_RATE)} (Pro) | Margin (Starter) | Margin (Pro) |")
    w("|---|---|---|---|---|---|")
    for density, note in GPU_DENSITY_SWEEP:
        cost = GPU_NODE_COST_HR / density
        m_starter = (STARTER_GPU_RATE - cost) / STARTER_GPU_RATE
        m_pro = (PRO_GPU_RATE - cost) / PRO_GPU_RATE
        label = f"{density}"
        if note:
            label += f" ({note})"
        w(f"| {label} | {d(cost)} | {d(STARTER_GPU_RATE)} | {d(PRO_GPU_RATE)} | **{pct(m_starter * 100)}** | **{pct(m_pro * 100)}** |")
    w()
    w("Solo-node GPU margins are thin at launch but every hour is revenue-positive. Margins improve rapidly as packing density increases with user growth.")
    w()

    # GPU vs CPU comparison
    gpu_cost_mo = GPU_NODE_COST_HR * HOURS_PER_MONTH
    gpu_stage_hr_full = GPU_NODE_COST_HR / GPU_MAX_STAGES_PER_NODE
    gpu_stage_mo_full = gpu_stage_hr_full * HOURS_PER_MONTH
    w("#### GPU vs CPU cost comparison")
    w()
    w(f"RunPod SECURE RTX 4090 node costs ~{d(GPU_NODE_COST_HR)}/hr. For reference:")
    w()
    w("| | GPU (RTX 4090) | CPU (ccx43) |")
    w("|---|---|---|")
    w(f"| Node cost | {d(GPU_NODE_COST_HR)}/hr (~{d(gpu_cost_mo)}/mo) | {d(CPU_NODE_COST_MO)}/mo ({d(CPU_NODE_COST_MO / HOURS_PER_MONTH)}/hr) |")
    w(f"| Stages per node | {GPU_MAX_STAGES_PER_NODE} | {CPU_STAGES_PER_NODE} |")
    w(f"| Cost per stage-hour (full node) | {d(gpu_stage_hr_full)} | {d(cpu_cost_hr)} |")
    w(f"| Cost per always-on stage-month | {d(gpu_stage_mo_full)} | {d(cpu_cost_mo)} |")
    w()
    gpu_vs_cpu = gpu_stage_hr_full / cpu_cost_hr
    w(f"GPU is ~{gpu_vs_cpu:.0f}x more expensive per stage-hour than CPU, which is why GPU is metered hourly (not always-on) and priced at a significant premium.")
    w()

    # ========================================================================
    # CPU STAGE POD RESOURCES (static — not computed)
    # ========================================================================
    w("### CPU Stage Pod Resources")
    w()
    w("| Container | CPU Request | CPU Limit | RAM Request | RAM Limit |")
    w("|---|---|---|---|---|")
    w("| Streamer (Chrome + Xvfb) | 500m | 3500m | 2Gi | 14Gi |")
    w("| Sidecar (app logic) | 100m | 500m | 128Mi | 512Mi |")
    w("| Init (restore) | 100m | 500m | 64Mi | 256Mi |")
    w("| **Total** | **700m** | **4500m** | **2.2Gi** | **~15Gi** |")
    w()

    # ========================================================================
    # PER-PLAN MARGIN ANALYSIS
    # ========================================================================
    w("## Per-Plan Margin Analysis")
    w()

    def margin_row(label, revenue, cost):
        pre_tax = (revenue - cost) / revenue if revenue > 0 else 0
        after_tax = pre_tax * (1 - TAX_RATE)
        return f"| {label} | {d(revenue)} | {d(cost)} | **{pct(pre_tax * 100)}** | **{pct(after_tax * 100)}** |"

    # Starter scenarios
    w(f"### Starter ({d(STARTER_PRICE)}/mo — {STARTER_CPU_HRS} CPU hrs included, near break-even)")
    w()
    w("| Scenario | Revenue | Cost | Pre-tax margin | After-tax ({pct(TAX_RATE * 100)}) |".replace("{pct(TAX_RATE * 100)}", pct(TAX_RATE * 100)))
    w("|---|---|---|---|---|")

    # CPU only
    w(margin_row("CPU only, no GPU", STARTER_PRICE, starter_cpu_cost))
    # CPU + 10 GPU (blended)
    gpu10_rev = STARTER_PRICE + 10 * STARTER_GPU_RATE
    gpu10_cost = starter_cpu_cost + 10 * gpu_cost_blended
    w(margin_row(f"CPU + 10 GPU hrs ({GPU_PACK_DENSITY}/{GPU_MAX_STAGES_PER_NODE} pack)", gpu10_rev, gpu10_cost))
    # CPU + 10 GPU (solo)
    gpu10_solo_cost = starter_cpu_cost + 10 * GPU_NODE_COST_HR
    w(margin_row("CPU + 10 GPU hrs (solo node)", gpu10_rev, gpu10_solo_cost))
    # CPU + 50 GPU (blended)
    gpu50_rev = STARTER_PRICE + 50 * STARTER_GPU_RATE
    gpu50_cost = starter_cpu_cost + 50 * gpu_cost_blended
    w(margin_row(f"CPU + 50 GPU hrs ({GPU_PACK_DENSITY}/{GPU_MAX_STAGES_PER_NODE} pack)", gpu50_rev, gpu50_cost))
    # 2nd stage overage
    overage_rev = STARTER_PRICE + overage_trap_cost
    overage_cost = starter_cpu_cost * 2
    w(margin_row(f"2nd stage overage ({HOURS_PER_MONTH} hrs × {d(STARTER_CPU_OVERAGE)})", overage_rev, overage_cost))
    w()
    w(f"The last row is hypothetical — Starter is capped at {STARTER_STAGE_LIMIT} active stages, so a 4th stage requires upgrading to Pro. If a user somehow ran overage (e.g. the stage ran past their {STARTER_CPU_HRS}-hr budget), they'd pay {d(STARTER_CPU_OVERAGE)}/hr.")
    w()

    # Pro scenarios
    w(f"### Pro (${PRO_PRICE:.0f}/mo — {PRO_CPU_HRS} CPU hrs included, margin engine)")
    w()
    w("| Scenario | Revenue | Cost | Pre-tax margin | After-tax ({pct(TAX_RATE * 100)}) |".replace("{pct(TAX_RATE * 100)}", pct(TAX_RATE * 100)))
    w("|---|---|---|---|---|")

    # 2 CPU stages
    w(margin_row("2 CPU stages, no GPU", PRO_PRICE, pro_cpu_cost))
    # 2 CPU + 30 GPU (blended)
    pro_gpu30_rev = PRO_PRICE + 30 * PRO_GPU_RATE
    pro_gpu30_cost = pro_cpu_cost + 30 * gpu_cost_blended
    w(margin_row(f"2 CPU + 30 GPU hrs ({GPU_PACK_DENSITY}/{GPU_MAX_STAGES_PER_NODE} pack)", pro_gpu30_rev, pro_gpu30_cost))
    # 2 CPU + 30 GPU (solo)
    pro_gpu30_solo_cost = pro_cpu_cost + 30 * GPU_NODE_COST_HR
    w(margin_row("2 CPU + 30 GPU hrs (solo node)", pro_gpu30_rev, pro_gpu30_solo_cost))
    # 3 CPU (1 overage)
    pro_3cpu_overage = HOURS_PER_MONTH * PRO_CPU_OVERAGE
    pro_3cpu_rev = PRO_PRICE + pro_3cpu_overage
    pro_3cpu_cost = cpu_cost_mo * 3
    w(margin_row(f"3 CPU (1 overage @ {d(PRO_CPU_OVERAGE)} × {HOURS_PER_MONTH} hrs)", pro_3cpu_rev, pro_3cpu_cost))
    # 5 CPU (3 overage)
    pro_5cpu_overage = 3 * HOURS_PER_MONTH * PRO_CPU_OVERAGE
    pro_5cpu_rev = PRO_PRICE + pro_5cpu_overage
    pro_5cpu_cost = cpu_cost_mo * 5
    w(margin_row("5 CPU (3 overage)", pro_5cpu_rev, pro_5cpu_cost))
    # Heavy: 3 CPU + 100 GPU
    pro_heavy_rev = PRO_PRICE + pro_3cpu_overage + 100 * PRO_GPU_RATE
    pro_heavy_cost = cpu_cost_mo * 3 + 100 * gpu_cost_blended
    w(margin_row(f"Heavy: 3 CPU + 100 GPU hrs ({GPU_PACK_DENSITY}/{GPU_MAX_STAGES_PER_NODE} pack)", pro_heavy_rev, pro_heavy_cost))
    w()
    w(f"Every Pro scenario exceeds 40% after-tax. The {d(PRO_CPU_OVERAGE)}/hr overage creates smooth expansion revenue without hitting walls.")
    w()

    # Free tier
    w("### Free Tier")
    w()
    w("| | |")
    w("|---|---|")
    w(f"| Cost per free user | ~{d(free_cost)}/mo ({FREE_CPU_HRS} CPU hrs × {d(cpu_cost_hr)} + one-time GPU amortized) |")
    w(f"| Expected conversion rate | {pct(free_conv_low * 100)}-{pct(free_conv_high * 100)} to paid within 60 days (higher at ${STARTER_PRICE:.0f} price point) |")
    w(f"| Effective CAC via free tier | {d(cac_low)}-{d(cac_high)} per converted user |")
    w()
    w(f"Free tier conversion rate is higher than the $29 model because {d(STARTER_PRICE)} is an impulse buy. Effective CAC drops accordingly.")
    w()

    # ========================================================================
    # SCALE ECONOMICS
    # ========================================================================
    w("## Scale Economics")
    w()
    w(f"Fixed costs: **{d(fixed_total)}/mo**. Variable cost per CPU stage: ~{d(cpu_cost_mo)}/mo ({CPU_STAGES_PER_NODE}/node density). GPU: {d(GPU_NODE_COST_HR)}/hr raw (improves with packing).")
    w()
    w("### Revenue per user by plan mix")
    w()
    w(f"Assumes {pct(GPU_ADOPTION_RATE * 100)} GPU adoption (avg {STARTER_AVG_GPU_HRS} hrs Starter, {PRO_AVG_GPU_HRS} hrs Pro), {pct(PRO_OVERAGE_RATE * 100)} Pro CPU overage (1 extra stage).")
    w()
    w("**How each cell is computed:**")
    w(f"- **Plan mix**: {pct(PLAN_MIX_STARTER * 100)} Starter / {pct(PLAN_MIX_PRO * 100)} Pro. Free users = {FREE_TO_PAID_RATIO}× paid users.")
    w(f"- **MRR** = `(n_starter × {d(starter_typical_total)}) + (n_pro × {d(pro_typical_total)})`, using typical total/user from the Pricing Tiers table.")
    w(f"- **Infra cost** = fixed ({d(fixed_total)}) + extra CPU nodes beyond the 2 already in fixed costs (`ceil(total_stages / {CPU_STAGES_PER_NODE}) − 2` × {d(CPU_NODE_COST_MO)}) + GPU hours (`n × adoption × avg_hrs × {d(gpu_cost_blended)}/hr`).")
    w(f"- **Total stages** = Starter users × 2 + Pro users × 2 + Pro overage ({pct(PRO_OVERAGE_RATE * 100)} × 1 extra) + Free users × ({FREE_CPU_HRS}/{HOURS_PER_MONTH}).")
    w(f"- **Pre-tax margin** = `(MRR − infra cost) / MRR`.")
    w()
    w("| Paying users | Free | Starter | Pro | MRR | Infra cost | Pre-tax margin | ARR |")
    w("|---|---|---|---|---|---|---|---|")

    for n_paid in SCALE_USER_COUNTS:
        n_free = round(n_paid * FREE_TO_PAID_RATIO)
        n_starter = round(n_paid * PLAN_MIX_STARTER)
        n_pro = n_paid - n_starter

        # Revenue
        starter_rev = n_starter * starter_typical_total
        pro_rev = n_pro * pro_typical_total
        mrr = starter_rev + pro_rev

        # Infrastructure cost
        # CPU: each paid user uses ~1 stage on avg, free users use partial
        # Simplify: count always-on stages
        total_stages = n_starter * 2 + n_pro * 2 + n_free * (FREE_CPU_HRS / HOURS_PER_MONTH)
        # Add Pro overage stages
        total_stages += n_pro * PRO_OVERAGE_RATE
        cpu_nodes_needed = math.ceil(total_stages / CPU_STAGES_PER_NODE)
        cpu_infra = cpu_nodes_needed * CPU_NODE_COST_MO

        # GPU cost
        gpu_hrs_total = (n_starter * GPU_ADOPTION_RATE * STARTER_AVG_GPU_HRS +
                         n_pro * GPU_ADOPTION_RATE * PRO_AVG_GPU_HRS)
        gpu_cost = gpu_hrs_total * gpu_cost_blended

        infra_cost = fixed_total + cpu_infra + gpu_cost

        # Some cpu infra is already in fixed costs (2 worker nodes)
        # The fixed costs already include 2 worker nodes, so subtract those
        base_worker_nodes = 2
        if cpu_nodes_needed <= base_worker_nodes:
            cpu_infra = 0  # already in fixed costs
        else:
            cpu_infra = (cpu_nodes_needed - base_worker_nodes) * CPU_NODE_COST_MO
        infra_cost = fixed_total + cpu_infra + gpu_cost

        margin = (mrr - infra_cost) / mrr if mrr > 0 else -1
        arr = mrr * 12

        # Format ARR
        if arr >= 1000:
            arr_str = f"${arr / 1000:.0f}K"
        else:
            arr_str = d(arr)

        w(f"| {n_paid} | {n_free} | {n_starter} | {n_pro} | {d(mrr)} | {d(infra_cost)} | **{pct(margin * 100)}** | {arr_str} |")

    w()

    # ARPU
    blended_arpu = (PLAN_MIX_STARTER * starter_typical_total + PLAN_MIX_PRO * pro_typical_total)
    w(f"Mix: {pct(PLAN_MIX_STARTER * 100)} Starter / {pct(PLAN_MIX_PRO * 100)} Pro. Free: {FREE_TO_PAID_RATIO}× paid users. ARPU: ~{d(blended_arpu)}/mo blended (base + PAYG).")
    w()

    # Find break-even
    for n in range(1, 100):
        n_starter = round(n * PLAN_MIX_STARTER)
        n_pro = n - n_starter
        n_free = round(n * FREE_TO_PAID_RATIO)
        mrr = n_starter * starter_typical_total + n_pro * pro_typical_total
        total_stages = n_starter * 2 + n_pro * 2 + n_free * (FREE_CPU_HRS / HOURS_PER_MONTH) + n_pro * PRO_OVERAGE_RATE
        cpu_nodes = math.ceil(total_stages / CPU_STAGES_PER_NODE)
        extra_nodes = max(0, cpu_nodes - 2)
        gpu_hrs = n_starter * GPU_ADOPTION_RATE * STARTER_AVG_GPU_HRS + n_pro * GPU_ADOPTION_RATE * PRO_AVG_GPU_HRS
        cost = fixed_total + extra_nodes * CPU_NODE_COST_MO + gpu_hrs * gpu_cost_blended
        if mrr >= cost:
            break_even = n
            break
    else:
        break_even = "100+"

    # Find $100K ARR
    for n in range(1, 2000):
        n_starter = round(n * PLAN_MIX_STARTER)
        n_pro = n - n_starter
        mrr = n_starter * starter_typical_total + n_pro * pro_typical_total
        if mrr * 12 >= 100000:
            arr_100k = n
            break
    else:
        arr_100k = "2000+"

    # Find $500K ARR
    for n in range(1, 10000):
        n_starter = round(n * PLAN_MIX_STARTER)
        n_pro = n - n_starter
        mrr = n_starter * starter_typical_total + n_pro * pro_typical_total
        if mrr * 12 >= 500000:
            arr_500k = n
            break
    else:
        arr_500k = "10000+"

    w(f"**Break-even: ~{break_even} paying users.** $100K ARR at ~{arr_100k} users. $500K ARR at ~{arr_500k}.")
    w()

    # GPU sensitivity
    w(f"### GPU adoption sensitivity (at {GPU_SENSITIVITY_AT} paying users)")
    w()
    w("| GPU adoption | MRR | Pre-tax margin |")
    w("|---|---|---|")
    for rate in GPU_SENSITIVITY_RATES:
        n_paid = GPU_SENSITIVITY_AT
        n_starter = round(n_paid * PLAN_MIX_STARTER)
        n_pro = n_paid - n_starter
        n_free = round(n_paid * FREE_TO_PAID_RATIO)

        s_payg = rate * STARTER_AVG_GPU_HRS * STARTER_GPU_RATE
        p_payg = PRO_OVERAGE_RATE * HOURS_PER_MONTH * PRO_CPU_OVERAGE + rate * PRO_AVG_GPU_HRS * PRO_GPU_RATE
        mrr = n_starter * (STARTER_PRICE + s_payg) + n_pro * (PRO_PRICE + p_payg)

        total_stages = n_starter * 2 + n_pro * 2 + n_free * (FREE_CPU_HRS / HOURS_PER_MONTH) + n_pro * PRO_OVERAGE_RATE
        cpu_nodes = math.ceil(total_stages / CPU_STAGES_PER_NODE)
        extra_nodes = max(0, cpu_nodes - 2)
        gpu_hrs = n_starter * rate * STARTER_AVG_GPU_HRS + n_pro * rate * PRO_AVG_GPU_HRS
        cost = fixed_total + extra_nodes * CPU_NODE_COST_MO + gpu_hrs * gpu_cost_blended

        margin = (mrr - cost) / mrr
        label = "conservative" if rate == 0.30 else "moderate" if rate == 0.45 else "baseline"
        w(f"| **{pct(rate * 100)}** ({label}) | {d(mrr)} | **{pct(margin * 100)}** |")
    w()
    w("Base subscriptions cover fixed costs on their own at ~20 paying users. GPU revenue is upside, not a dependency.")
    w()

    # ========================================================================
    # PERSONA VALIDATION
    # ========================================================================
    w("## Persona Validation")
    w()
    w("GPU usage scales with **production value**, not persona type. Shaders, particle effects, bloom, raymarching all require GPU. CPU handles DOM, CSS, Canvas 2D, and WebGL geometry. The GPU upgrade path is about content quality.")
    w()
    w(f"The CPU budget is sized for 24/7 ({STARTER_CPU_HRS} hrs/mo), but most users don't run 24/7. Event-based, part-time, and development use cases pay the full subscription but use a fraction of the budget. **This underutilization is margin we capture** — it's a core part of the pricing strategy.")
    w()

    w("### Personas")
    w()
    w("Each persona is grounded in a specific user, how they discover Dazzle, what their first two weeks look like, and how usage stabilizes. Year-1 estimates assume organic growth only (no paid acquisition).")
    w()

    for i, p in enumerate(PERSONAS, 1):
        w(f"#### {i}. The {p['name'].title()} — \"{p['description']}\"")
        w()
        w(f"**Who:** {p['who']}")
        w()
        w(f"**Discovery:** {p['discovery']}")
        w()

        # Format week1/steady_state with dynamic values
        week1 = p['week1']
        steady = p['steady_state'].format(
            cpu_stage_cost_mo=cpu_cost_mo,
            gpu_rate_pro=d(PRO_GPU_RATE),
            hours_per_month=HOURS_PER_MONTH,
            gpu_always_on_mo=gpu_always_on_mo,
        )

        w(f"**Week 1:** {week1}")
        w()
        w(f"**Steady state:** {steady}")
        w()
        w(f"**llms.txt usage:** {p['llms_txt']}")
        w()

        # Usage table
        cpu_lo, cpu_hi = p['cpu_hrs']
        gpu_lo, gpu_hi = p['gpu_hrs']

        def persona_bill(cpu_hrs, gpu_hrs, plan_name):
            if "Free" in plan_name and "Starter" not in plan_name:
                return 0, 0
            if "Pro" in plan_name:
                base = PRO_PRICE
                gpu_rate = PRO_GPU_RATE
                overage_rate = PRO_CPU_OVERAGE
                included = PRO_CPU_HRS
            else:
                base = STARTER_PRICE
                gpu_rate = STARTER_GPU_RATE
                overage_rate = STARTER_CPU_OVERAGE
                included = STARTER_CPU_HRS

            gpu_cost_user = gpu_hrs * gpu_rate
            cpu_overage = max(0, cpu_hrs - included) * overage_rate
            total = base + gpu_cost_user + cpu_overage
            actual_cpu_cost = cpu_hrs * cpu_cost_hr
            actual_gpu_cost = gpu_hrs * gpu_cost_blended
            actual_cost = actual_cpu_cost + actual_gpu_cost
            return total, actual_cost

        if cpu_lo == cpu_hi and gpu_lo == gpu_hi:
            # Single row
            util = cpu_lo / STARTER_CPU_HRS if "Starter" in p['plan'] else cpu_lo / PRO_CPU_HRS if "Pro" in p['plan'] else cpu_lo / FREE_CPU_HRS
            bill, cost = persona_bill(cpu_lo, gpu_lo, p['plan'])
            cpu_label = f"{cpu_lo}" + (" (24/7)" if cpu_lo >= 720 else "")
            gpu_label = str(gpu_lo)
            w("| CPU hrs/mo | GPU hrs/mo | Utilization | Plan | Bill | Effective margin |")
            w("|---|---|---|---|---|---|")
            if bill > 0:
                margin = (bill - cost) / bill
                w(f"| {cpu_label} | {gpu_label} | {pct(util * 100)} CPU | {p['plan']} | **{d(bill)}** | {pct(margin * 100)} |")
            else:
                w(f"| {cpu_label} | {gpu_label} | {pct(util * 100)} CPU | {p['plan']} | **$0** | — |")
        else:
            # Two rows (low/high)
            w("| CPU hrs/mo | GPU hrs/mo | Utilization | Plan | Bill | Effective margin |")
            w("|---|---|---|---|---|---|")
            for cpu, gpu, label_plan in [(cpu_lo, gpu_lo, p['plan'].split("/")[0].strip() if "/" in p['plan'] else p['plan']),
                                          (cpu_hi, gpu_hi, p['plan'].split("/")[-1].strip() if "/" in p['plan'] else p['plan'])]:
                if "Free" in label_plan and "Starter" not in label_plan:
                    included = FREE_CPU_HRS
                elif "Pro" in label_plan:
                    included = PRO_CPU_HRS
                else:
                    included = STARTER_CPU_HRS
                util = min(cpu / included, 1.0)  # cap at 100% for display
                bill, cost = persona_bill(cpu, gpu, label_plan)
                cpu_label = f"{cpu}" + (" (24/7)" if cpu >= 720 else "") + (" (dev)" if cpu <= 60 and cpu_hi >= 720 else "")
                gpu_label = str(gpu) + (" (streams)" if gpu >= 40 else "") + (" (dev)" if gpu <= 15 and gpu_hi >= 20 else "") + (" (trial)" if gpu <= 2 and "Free" in p['plan'] else "")
                if bill > 0:
                    margin = (bill - cost) / bill
                    w(f"| {cpu_label} | {gpu_label} | {pct(util * 100)} CPU | {label_plan} | **{d(bill)}** | {pct(margin * 100)} |")
                else:
                    w(f"| {cpu_label} | {gpu_label} | {pct(util * 100)} CPU | {label_plan} | **$0** | — |")
        w()
        w(f"**Year-1 funnel:** {p['try_yr1'][0]}-{p['try_yr1'][1]} try it → {p['stick'][0]}-{p['stick'][1]} stick (3+ months). {p['funnel_note']}")
        w()

    # Summary table
    w("### Summary")
    w()
    w("| Persona | Try (yr 1) | Stick (3+ mo) | Monthly ARPU | Monthly rev | Best margin driver |")
    w("|---|---|---|---|---|---|")

    total_try = [0, 0]
    total_stick = [0, 0]
    total_rev = [0, 0]

    for p in PERSONAS:
        cpu_avg = sum(p['cpu_hrs']) / 2
        gpu_avg = sum(p['gpu_hrs']) / 2
        # Use the higher-end plan for ARPU
        plan_for_arpu = p['plan'].split("/")[-1].strip() if "/" in p['plan'] else p['plan']
        if "Free" in plan_for_arpu and "Starter" not in plan_for_arpu:
            bill_lo, _ = persona_bill(p['cpu_hrs'][0], p['gpu_hrs'][0], "Free")
            bill_hi, _ = persona_bill(p['cpu_hrs'][1], p['gpu_hrs'][1], "Starter")
        else:
            bill_lo, _ = persona_bill(p['cpu_hrs'][0], p['gpu_hrs'][0], p['plan'].split("/")[0].strip() if "/" in p['plan'] else p['plan'])
            bill_hi, _ = persona_bill(p['cpu_hrs'][1], p['gpu_hrs'][1], plan_for_arpu)

        if bill_lo == bill_hi:
            arpu_str = d(bill_lo)
        else:
            arpu_str = f"{d(bill_lo)}-{d(bill_hi)}"

        rev_lo = p['stick'][0] * bill_lo
        rev_hi = p['stick'][1] * bill_hi

        total_try[0] += p['try_yr1'][0]
        total_try[1] += p['try_yr1'][1]
        total_stick[0] += p['stick'][0]
        total_stick[1] += p['stick'][1]
        total_rev[0] += rev_lo
        total_rev[1] += rev_hi

        w(f"| {p['name'].title()} | {p['try_yr1'][0]}-{p['try_yr1'][1]} | {p['stick'][0]}-{p['stick'][1]} | {arpu_str} | {d(rev_lo)}-{d(rev_hi)} | {p['margin_driver']} |")

    blended_arpu_lo = total_rev[0] / total_stick[0] if total_stick[0] else 0
    blended_arpu_hi = total_rev[1] / total_stick[1] if total_stick[1] else 0
    blended_arpu_avg = (blended_arpu_lo + blended_arpu_hi) / 2
    w(f"| **Total** | **{total_try[0]}-{total_try[1]}** | **{total_stick[0]}-{total_stick[1]}** | **~{d(blended_arpu_avg)} blended** | **{d(total_rev[0])}-{d(total_rev[1])}** | |")
    w()

    arr_lo = total_rev[0] * 12
    arr_hi = total_rev[1] * 12
    w(f"**Organic year-1 estimate: {d(arr_lo / 1000)}K-{d(arr_hi / 1000)}K ARR.** Not $500K. The path to $500K requires either (a) a partnership that makes Dazzle the default streaming backend for a framework (AIRI, Browser Use), or (b) an API/platform tier where other products build on top of Dazzle stages.")
    w()

    # Key dynamics
    w("### Key dynamics")
    w()
    w(f"- **Crypto dashboard operators are the best unit economics.** They pay ${PRO_PRICE:.0f}/month, cost {d(cpu_cost_mo)}, barely touch the product after setup, and don't churn because the stream generates value for them.")
    w(f"- **Claude Code streamers are the volume play** but low ARPU ({d(STARTER_PRICE)}/mo) and churn-prone. The question is whether \"streaming your agent\" becomes a *habit* or a *novelty*.")
    w(f"- **Generative art loopers are high-value but tiny.** Great for marketing — visible, shareable content — but the addressable market is 30-50 people.")
    w(f"- **AI VTubers are the dream but setup cost is brutal.** A framework partnership (AIRI, Open-LLM-VTuber) that bundles Dazzle as the default streaming backend would change the economics entirely.")
    w(f"- **\"Build in public\" is a trap.** Huge top-of-funnel, terrible retention. Content quality is too inconsistent to keep viewers, so there's no feedback loop keeping the streamer engaged.")
    w(f"- **Underutilization is the long tail.** Claude Code streamers pay {d(STARTER_PRICE)} for {STARTER_CPU_HRS}hrs but use 60 — CPU cost is ~{d(60 * cpu_cost_hr)}, not {d(starter_cpu_cost)}. Build-in-public users pay {d(STARTER_PRICE)} for 30hrs — cost is ~{d(30 * cpu_cost_hr)}. This is how gym memberships work.")
    w(f"- **The 1-stage cap works**: Starter users wanting a 2nd stage must upgrade to Pro ({d(PRO_PRICE)}). No overage workaround — the limit is hard.")
    w(f"- **The missing persona is the platform builder** — someone building *on top of* Dazzle (a SaaS using stages as infrastructure). That's the path to $500K ARR, but it's an API customer, not an llms.txt user.")
    w()

    # ========================================================================
    # TAM / SAM / SOM
    # ========================================================================
    w("## Market Sizing (TAM / SAM / SOM)")
    w()
    w("Bottom-up market sizing grounded in verified competitor data and persona analysis. Top-down analyst figures provided for context but not used as inputs — they're too broad to be actionable.")
    w()

    # TAM
    tam_total = sum(m["size_b"] for m in TAM_MARKETS)
    w("### TAM — Total Addressable Market")
    w()
    w(f"The total spend across markets where Dazzle's technology is relevant. **{d(tam_total)}B** combined in 2026 — but Dazzle doesn't compete for most of this.")
    w()
    w("| Market | 2026 Size | CAGR | 2029 Projected | Source | Relevance to Dazzle |")
    w("|---|---|---|---|---|---|")
    tam_2029_total = 0
    for m in TAM_MARKETS:
        size_2029 = m["size_b"] * (1 + m["cagr"]) ** 3
        tam_2029_total += size_2029
        w(f"| {m['name']} | ${m['size_b']:.1f}B | {pct(m['cagr'] * 100)} | ${size_2029:.1f}B | {m['source']} | {m['note']} |")
    w(f"| **Total TAM** | **${tam_total:.1f}B** | | **${tam_2029_total:.0f}B** | | |")
    w()
    w(f"**AI agent infrastructure is the fastest-growing TAM segment** at {pct(TAM_MARKETS[1]['cagr'] * 100)} CAGR — from ${TAM_MARKETS[1]['size_b']:.1f}B (2026) to ${TAM_MARKETS[1]['size_b'] * (1 + TAM_MARKETS[1]['cagr']) ** 3:.0f}B (2029). This is the tailwind Dazzle rides: as more agents are deployed, more need a way to show their work visually.")
    w()
    w("The TAM is large but misleading. Dazzle doesn't compete with Twitch itself or enterprise signage hardware — it competes for a thin slice: **developers and creators who want programmatic, always-on streaming without managing infrastructure.**")
    w()

    # SAM
    sam_total = sum(s["size_m"] for s in SAM_SEGMENTS)
    w("### SAM — Serviceable Addressable Market")
    w()
    w(f"Segments where Dazzle directly competes or creates a new category. **~{d(sam_total)}M** in annual spend (2026).")
    w()
    w("| Segment | 2026 Spend | CAGR | 2029 Projected | Dazzle's angle |")
    w("|---|---|---|---|---|")
    sam_2029_total = 0
    for s in SAM_SEGMENTS:
        size_2029 = s["size_m"] * (1 + s["cagr"]) ** 3
        sam_2029_total += size_2029
        w(f"| {s['name']} | ~${s['size_m']}M | {pct(s['cagr'] * 100)} | ~${size_2029:.0f}M | {s['dazzle_angle']} |")
    w(f"| **Total SAM** | **~${sam_total}M** | | **~${sam_2029_total:.0f}M** | |")
    w()

    # SAM growth narrative
    fastest_sam = max(SAM_SEGMENTS, key=lambda s: s["cagr"])
    w(f"**The SAM nearly {sam_2029_total / sam_total:.0f}x's by 2029** — from ~${sam_total}M to ~${sam_2029_total:.0f}M. The fastest-growing segment is {fastest_sam['name']} ({pct(fastest_sam['cagr'] * 100)} CAGR), driven by {fastest_sam['source'].split(';')[0]}.")
    w()
    w(f"**Key insight:** The SAM is small today (~${sam_total}M) because these are early, fragmented markets. Cloud browsers (~${SAM_SEGMENTS[0]['size_m']}M) is the largest segment but Dazzle differentiates by adding streaming output — no competitor does browser + broadcast. The 24/7 streaming automation segment (~${SAM_SEGMENTS[1]['size_m']}M) is the most direct competitor space, but incumbents loop pre-recorded video while Dazzle runs live content.")
    w()

    # SAM customer counts
    sam_customers_lo = sum(s["customers_lo"] for s in SAM_SEGMENTS)
    sam_customers_hi = sum(s["customers_hi"] for s in SAM_SEGMENTS)
    w("#### SAM in customers (not just dollars)")
    w()
    w(f"The SAM contains an estimated **{sam_customers_lo / 1000:.0f}K-{sam_customers_hi / 1000:.0f}K active customers/builders** today. Not all are reachable — most cloud browser users don't need streaming, most 24/7 streamers want simple video loops. The \"capturable\" column estimates what % would switch to or add Dazzle.")
    w()
    w("| Segment | Active customers (2026) | Basis | Capturable for Dazzle | Capturable count |")
    w("|---|---|---|---|---|")
    total_capturable_lo = 0
    total_capturable_hi = 0
    for s in SAM_SEGMENTS:
        cap_lo = int(s["customers_lo"] * s["dazzle_capturable_pct"])
        cap_hi = int(s["customers_hi"] * s["dazzle_capturable_pct"])
        total_capturable_lo += cap_lo
        total_capturable_hi += cap_hi
        w(f"| {s['name']} | {s['customers_lo']:,}-{s['customers_hi']:,} | {s['customers_basis']} | {pct(s['dazzle_capturable_pct'] * 100)} | {cap_lo}-{cap_hi} |")
    w(f"| **Total** | **{sam_customers_lo / 1000:.0f}K-{sam_customers_hi / 1000:.0f}K** | | | **{total_capturable_lo}-{total_capturable_hi}** |")
    w()
    w(f"**{total_capturable_lo}-{total_capturable_hi} capturable customers** aligns with the persona-based SOM of {SOM_YEAR1_USERS_LO}-{SOM_YEAR1_USERS_HI} year-1 users — the bottom-up (persona funnels) and top-down (SAM penetration) estimates converge, which increases confidence in the range.")
    w()

    # Rollout model
    w("#### Rollout model: Year 1-2 customer acquisition")
    w()
    w("Quarter-by-quarter projection grounded in launch sequence (directories → communities → partnerships):")
    w()

    # Quarterly rollout
    quarters = [
        {"q": "Q1 (launch)", "new_lo": 15, "new_hi": 30,
         "channel": "Directories (TAAFT, Toolify) + Show HN + r/SideProject",
         "note": "Early adopters from AI/dev communities. Mostly Claude Code streamers + build-in-public."},
        {"q": "Q2", "new_lo": 25, "new_hi": 50,
         "channel": "Word-of-mouth + Reddit (r/creativecoding, r/AI_Agents) + Product Hunt",
         "note": "Creative coders discover GPU stages. First crypto dashboard operators. Churn stabilizes."},
        {"q": "Q3", "new_lo": 35, "new_hi": 60,
         "channel": "SEO matures + first framework partnership (AIRI or Browser Use)",
         "note": "Partnership drives VTuber builders. Crypto dashboards grow via visible streams."},
        {"q": "Q4", "new_lo": 40, "new_hi": 70,
         "channel": "Second partnership + newsletter features + organic compound",
         "note": "Pro tier adoption increases as 24/7 users discover overage trap. ARPU shifts up."},
        {"q": "Q5 (Y2Q1)", "new_lo": 50, "new_hi": 90,
         "channel": "Framework integrations live + API/platform tier attracts first SaaS builder",
         "note": "Platform customer could equal 20-50 individual users in stage count."},
        {"q": "Q6", "new_lo": 55, "new_hi": 95,
         "channel": "Organic + partnerships compound",
         "note": "SAM itself has grown ~40% from launch. More cloud browser users discover streaming use case."},
        {"q": "Q7", "new_lo": 55, "new_hi": 95,
         "channel": "Steady state organic + 2-3 active partnerships",
         "note": "Retention improves as product matures. GPU packing density improves margins."},
        {"q": "Q8 (Y2Q4)", "new_lo": 60, "new_hi": 100,
         "channel": "Enterprise tier early access + API customers",
         "note": "First enterprise deal could add $2K-5K MRR from single customer."},
    ]

    w("| Quarter | New paying users | Cumulative (est.) | Acquisition channel | Notes |")
    w("|---|---|---|---|---|")
    cum_lo = 0
    cum_hi = 0
    churn_rate = 0.10  # 10% quarterly churn on cumulative base
    for q in quarters:
        # Apply churn to existing base, then add new
        cum_lo = int(cum_lo * (1 - churn_rate)) + q["new_lo"]
        cum_hi = int(cum_hi * (1 - churn_rate)) + q["new_hi"]
        w(f"| {q['q']} | {q['new_lo']}-{q['new_hi']} | {cum_lo}-{cum_hi} | {q['channel']} | {q['note']} |")
    w()

    # Year-end summaries
    # Y1 end = Q4
    y1_cum_lo = 0
    y1_cum_hi = 0
    for i, q in enumerate(quarters[:4]):
        y1_cum_lo = int(y1_cum_lo * (1 - churn_rate)) + q["new_lo"]
        y1_cum_hi = int(y1_cum_hi * (1 - churn_rate)) + q["new_hi"]

    y2_cum_lo = cum_lo
    y2_cum_hi = cum_hi

    w(f"**Assumes {pct(churn_rate * 100)} quarterly churn** on the cumulative base (new users added after churn is applied). This is conservative — crypto dashboard operators and 24/7 streamers churn much less, while build-in-public users churn much more.")
    w()
    w(f"**Year-end snapshots:** Year 1: {y1_cum_lo}-{y1_cum_hi} paying users. Year 2: {y2_cum_lo}-{y2_cum_hi} paying users.")
    w()

    # Use scale economics ARPU for rollout ARR estimates
    rollout_arpu = PLAN_MIX_STARTER * starter_typical_total + PLAN_MIX_PRO * pro_typical_total
    y1_arr_lo = y1_cum_lo * rollout_arpu * 12
    y1_arr_hi = y1_cum_hi * rollout_arpu * 12
    y2_arr_lo = y2_cum_lo * rollout_arpu * 12
    y2_arr_hi = y2_cum_hi * rollout_arpu * 12
    w(f"**ARR at year-end** (at {d(rollout_arpu)}/mo blended ARPU[^6]): Year 1: {d(y1_arr_lo / 1000)}K-{d(y1_arr_hi / 1000)}K. Year 2: {d(y2_arr_lo / 1000)}K-{d(y2_arr_hi / 1000)}K.")
    w()
    w(f"[^6]: Blended ARPU = `{pct(PLAN_MIX_STARTER * 100)} Starter × {d(starter_typical_total)} + {pct(PLAN_MIX_PRO * 100)} Pro × {d(pro_typical_total)}` = {d(rollout_arpu)}/mo. This is the scale economics ARPU including typical PAYG (GPU + overage). Early quarters skew lower (more Free/Starter), later quarters skew higher (more Pro + partnerships).")
    w()

    # Platform context
    w("#### Platform context")
    w()
    w(f"- **{TWITCH_MONTHLY_STREAMERS / 1e6:.1f}M** unique Twitch channels went live monthly (2026)")
    w(f"- **{TWITCH_CONCURRENT_CHANNELS / 1e3:.1f}K** average concurrent Twitch channels")
    w(f"- **{TWITCH_CRYPTO_CONCURRENT / 1e3:.1f}K** concurrent viewers in Twitch/Kick crypto categories")
    w(f"- **{pct(AI_CODING_TOOL_ADOPTION * 100)}** of developers use AI coding tools weekly")
    w(f"- **{pct(CLAUDE_CODE_MOST_LOVED * 100)}** of developers rate Claude Code as \"most loved\" AI coding tool")
    w(f"- **Browserbase**: $4.4M ARR, 1,000+ paying customers, $300M valuation (68x ARR) — validates cloud browser demand")
    w(f"- **three.js**: 108K GitHub stars — large creative coding ecosystem, but most creators work locally")
    w()

    # SOM
    som_arpu_lo = total_rev[0] / total_stick[0] if total_stick[0] else 0
    som_arpu_hi = total_rev[1] / total_stick[1] if total_stick[1] else 0
    som_yr1_arr_lo = total_rev[0] * 12
    som_yr1_arr_hi = total_rev[1] * 12
    som_yr2_users_lo = SOM_YEAR1_USERS_LO * SOM_YEAR2_MULTIPLIER
    som_yr2_users_hi = SOM_YEAR1_USERS_HI * SOM_YEAR2_MULTIPLIER
    som_yr2_arr_lo = som_yr2_users_lo * som_arpu_lo * 12
    som_yr2_arr_hi = som_yr2_users_hi * som_arpu_hi * 12

    w("### SOM — Serviceable Obtainable Market")
    w()
    w("What Dazzle can realistically capture, derived bottom-up from persona analysis (see Persona Validation).")
    w()
    w("| | Year 1 (organic) | Year 2 (organic + partnerships) |")
    w("|---|---|---|")
    w(f"| Paying users | {SOM_YEAR1_USERS_LO}-{SOM_YEAR1_USERS_HI} | {som_yr2_users_lo}-{som_yr2_users_hi} |")
    w(f"| Blended ARPU | ~{d(som_arpu_lo)}-{d(som_arpu_hi)}/mo | ~{d(som_arpu_lo)}-{d(som_arpu_hi)}/mo (shifts toward Pro) |")
    w(f"| ARR | {d(som_yr1_arr_lo / 1000)}K-{d(som_yr1_arr_hi / 1000)}K | {d(som_yr2_arr_lo / 1000)}K-{d(som_yr2_arr_hi / 1000)}K |")
    w(f"| SAM penetration | {som_yr1_arr_hi / (sam_total * 1e6) * 100:.2f}% | {som_yr2_arr_hi / (sam_total * 1e6) * 100:.1f}% |")
    w()

    w("#### Year-1 breakdown by persona")
    w()
    w("| Persona | Stick users | ARPU | Monthly rev | Annual rev |")
    w("|---|---|---|---|---|")
    yr1_total_arr_lo = 0
    yr1_total_arr_hi = 0
    for p in PERSONAS:
        plan_for_arpu = p['plan'].split("/")[-1].strip() if "/" in p['plan'] else p['plan']
        if "Free" in plan_for_arpu and "Starter" not in plan_for_arpu:
            bill_lo, _ = persona_bill(p['cpu_hrs'][0], p['gpu_hrs'][0], "Free")
            bill_hi, _ = persona_bill(p['cpu_hrs'][1], p['gpu_hrs'][1], "Starter")
        else:
            bill_lo, _ = persona_bill(p['cpu_hrs'][0], p['gpu_hrs'][0], p['plan'].split("/")[0].strip() if "/" in p['plan'] else p['plan'])
            bill_hi, _ = persona_bill(p['cpu_hrs'][1], p['gpu_hrs'][1], plan_for_arpu)
        rev_lo = p['stick'][0] * bill_lo
        rev_hi = p['stick'][1] * bill_hi
        yr1_total_arr_lo += rev_lo * 12
        yr1_total_arr_hi += rev_hi * 12
        if bill_lo == bill_hi:
            arpu_str = d(bill_lo)
        else:
            arpu_str = f"{d(bill_lo)}-{d(bill_hi)}"
        w(f"| {p['name'].title()} | {p['stick'][0]}-{p['stick'][1]} | {arpu_str} | {d(rev_lo)}-{d(rev_hi)} | {d(rev_lo * 12)}-{d(rev_hi * 12)} |")
    w(f"| **Total** | **{SOM_YEAR1_USERS_LO}-{SOM_YEAR1_USERS_HI}** | | | **{d(yr1_total_arr_lo)}-{d(yr1_total_arr_hi)}** |")
    w()

    w("#### Year-2 growth assumptions")
    w()
    w(f"Year 2 assumes {SOM_YEAR2_MULTIPLIER}x user growth from:")
    w("- **1-2 framework partnerships** (AIRI, Open-LLM-VTuber, or Browser Use) that bundle Dazzle as default streaming backend")
    w("- **Word-of-mouth** from visible streams (generative art, crypto dashboards attract organic discovery)")
    w("- **SEO/directory presence** established in year 1 (Product Hunt, HN, AI directories)")
    w("- **No paid acquisition assumed** — partnerships and organic only")
    w()

    w("#### Upside scenario: Platform/API tier")
    w()
    w("The SOM above covers individual users. The path to $500K+ ARR requires **platform customers** — companies building on top of Dazzle stages as infrastructure (digital signage SaaS, AI streaming platforms, interactive broadcast tools). One platform customer with 50-100 stages could equal 50+ individual users. This segment isn't modeled in the persona analysis because it requires an API/enterprise tier that doesn't exist yet.")
    w()

    w("### TAM → SAM → SOM Summary")
    w()
    w("```")
    w(f"TAM  ${tam_total:.0f}B → ${tam_2029_total:.0f}B (2029)    Adjacent markets")
    w(f"  ↓")
    w(f"SAM  ~${sam_total}M → ~${sam_2029_total:.0f}M (2029)   Segments where Dazzle competes")
    w(f"  ↓")
    w(f"SOM  ${som_yr1_arr_lo / 1000:.0f}K-${som_yr1_arr_hi / 1000:.0f}K   Year 1 (organic, {SOM_YEAR1_USERS_LO}-{SOM_YEAR1_USERS_HI} users)")
    w(f"     ${som_yr2_arr_lo / 1000:.0f}K-${som_yr2_arr_hi / 1000:.0f}K  Year 2 (organic + partnerships, {som_yr2_users_lo}-{som_yr2_users_hi} users)")
    w("```")
    w()
    w(f"**SAM penetration at year 2: {som_yr2_arr_hi / (sam_total * 1e6) * 100:.1f}%.** But the SAM is a moving target — it grows to ~${sam_2029_total:.0f}M by 2029. Cloud browsers alone grew from ~$0 to ~$50M in 18 months (Browserbase: $0 → $4.4M ARR in 16 months). Dazzle's streaming differentiation could expand the SAM further by creating demand that doesn't exist yet (agent broadcasting, programmatic live streams).")
    w()

    # ========================================================================
    # LONG-TERM SCALE
    # ========================================================================
    w("## Long-Term Scale (With Future Enterprise Tier)")
    w()
    w("Enterprise tier ($40/stage committed, $0.45/hr GPU) is the long-term margin engine. Not included in the 3-month plan — prerequisites:")
    w()
    w("- SOC 2 Type II (~3-6 months, ~$20-50K)")
    w("- Team/org support with RBAC")
    w("- SLA with uptime guarantee (99.9%)")
    w("- Audit logging")
    w("- Dedicated capacity / namespace isolation")
    w()

    # Long-term scale table with enterprise mix
    ent_stage_price = 40
    ent_gpu_rate = 0.45
    lt_mix = {"starter": 0.45, "pro": 0.35, "enterprise": 0.20}
    lt_users = [14, 50, 100, 500, 1000]

    w("| Scale | Paying Users | Revenue/mo | Infra Cost/mo | Net (after tax)/mo | Net Margin |")
    w("|---|---|---|---|---|---|")
    for n in lt_users:
        n_s = round(n * lt_mix["starter"])
        n_p = round(n * lt_mix["pro"])
        n_e = n - n_s - n_p

        rev = (n_s * starter_typical_total +
               n_p * pro_typical_total +
               n_e * (ent_stage_price * 2 + GPU_ADOPTION_RATE * 40 * ent_gpu_rate))

        total_stages = n_s + n_p * 2 + n_e * 2 + n_p * PRO_OVERAGE_RATE
        cpu_nodes = math.ceil(total_stages / CPU_STAGES_PER_NODE)
        extra = max(0, cpu_nodes - 2)
        gpu_hrs = (n_s * GPU_ADOPTION_RATE * STARTER_AVG_GPU_HRS +
                   n_p * GPU_ADOPTION_RATE * PRO_AVG_GPU_HRS +
                   n_e * GPU_ADOPTION_RATE * 40)
        cost = fixed_total + extra * CPU_NODE_COST_MO + gpu_hrs * gpu_cost_blended
        net = (rev - cost) * (1 - TAX_RATE)
        margin = net / rev if rev > 0 else 0
        w(f"| {n} | {n} | {d(rev)} | {d(cost)} | {d(net)} | {pct(margin * 100)} |")

    w()
    w(f"(Assumes {pct(lt_mix['starter'] * 100)} Starter / {pct(lt_mix['pro'] * 100)} Pro / {pct(lt_mix['enterprise'] * 100)} Enterprise mix at maturity, with GPU and overage usage scaling proportionally.)")
    w()

    # Milestones
    for target, label in [(100000, "$100K"), (500000, "$500K"), (1000000, "$1M")]:
        for n in range(1, 20000):
            n_s = round(n * lt_mix["starter"])
            n_p = round(n * lt_mix["pro"])
            n_e = n - n_s - n_p
            rev = (n_s * starter_typical_total +
                   n_p * pro_typical_total +
                   n_e * (ent_stage_price * 2 + GPU_ADOPTION_RATE * 40 * ent_gpu_rate))
            if rev * 12 >= target:
                break
    # Just recalculate all three
    milestones = {}
    for target, label in [(100000, "100K"), (500000, "500K"), (1000000, "1M")]:
        for n in range(1, 20000):
            n_s = round(n * lt_mix["starter"])
            n_p = round(n * lt_mix["pro"])
            n_e = n - n_s - n_p
            rev = (n_s * starter_typical_total +
                   n_p * pro_typical_total +
                   n_e * (ent_stage_price * 2 + GPU_ADOPTION_RATE * 40 * ent_gpu_rate))
            if rev * 12 >= target:
                milestones[label] = n
                break

    parts = [f"${k} ARR at ~{v} users" for k, v in milestones.items()]
    w(f"**Key milestones:** {'. '.join(parts)}.")
    w()

    # ========================================================================
    # WHAT NEEDS TO BE BUILT (static)
    # ========================================================================
    w("## What Needs to Be Built")
    w()
    w("### Phase 1: Paid Launch (~4-6 weeks)")
    w()
    w("1. **Stripe Integration** (~1-2 weeks)")
    w("   - Stripe Checkout for plan signup")
    w("   - Stripe Billing for metered usage (GPU hours + CPU overage)")
    w("   - Webhook handler (subscription lifecycle events)")
    w("   - New DB: `subscriptions` table")
    w()
    w("2. **Usage Metering** (~1 week)")
    w("   - Track stage active duration (`activated_at` / `deactivated_at`)")
    w("   - Track CPU hours consumed per user per billing period")
    w("   - Track GPU hours consumed per user per billing period")
    w("   - New DB: `usage_events` table")
    w("   - Hourly rollup job reporting to Stripe Billing Meters (CPU + GPU reported independently)")
    w()
    w("3. **Plan Enforcement** (~3-5 days)")
    w("   - New `plan` column on users table (free/starter/pro)")
    w(f"   - Free tier: enforce {FREE_CPU_HRS} CPU hrs/mo budget + one-time {GPU_TRIAL_HRS} GPU hr trial")
    w(f"   - Starter: {STARTER_STAGE_LIMIT} stage limit, {STARTER_CPU_HRS} CPU hrs/mo, {d(STARTER_CPU_OVERAGE)}/hr CPU overage, {d(STARTER_GPU_RATE)}/hr GPU")
    w(f"   - Pro: unlimited stages, {PRO_CPU_HRS} CPU hrs/mo, {d(PRO_CPU_OVERAGE)}/hr CPU overage, {d(PRO_GPU_RATE)}/hr GPU")
    w(f"   - Destination limit per plan (free: 1 external, starter: 1, pro: 5)")
    w()
    w("4. **Stage Privacy** (~2-3 days)")
    w("   - New `visibility` column on stages: `public` or `private`")
    w("   - Modify ListStages to respect visibility")
    w("   - Modify HLS proxy to check auth for private stages")
    w("   - Free/Starter: public only. Pro: private option.")
    w()
    w("5. **Billing UI** (~1 week)")
    w("   - Plan selection / upgrade page")
    w(f"   - Current usage display (CPU hrs used vs {STARTER_CPU_HRS}/{PRO_CPU_HRS} included, GPU hrs + cost this period)")
    w("   - Overage rate shown per plan (Starter users see the Pro upgrade math)")
    w("   - Stripe Customer Portal link (payment method, invoices)")
    w("   - Plan badge in navigation")
    w()
    w("### Already Built (Leveraged for Billing)")
    w()
    w("- Per-user quotas: `max_stages`, `max_active_cpu_stages`, `max_active_gpu_stages`")
    w("- GPU vs CPU tier differentiation (separate providers, pod specs, encoding)")
    w("- Resolution configurable via `SCREEN_WIDTH`/`SCREEN_HEIGHT` env vars")
    w("- External destination limit (hardcoded to 3 — change to per-plan)")
    w("- Stage lifecycle state machine")
    w("- API key auth (Clerk JWT + `dzl_` API keys)")
    w()
    w("### Phase 2: Post-Launch Improvements (~4-6 weeks)")
    w()
    w("- Annual billing discount (2 months free = 17% discount)")
    w("- Webhook notifications (stage health, stream drops)")
    w("- SLA + status page")
    w("- GPU idle drain window extension (5 min → 15-20 min)")
    w("- GPU prepaid packs (buy 50 hrs at discount, no expiry)")
    w()
    w("### Phase 3: Enterprise Tier (~3-6 months)")
    w()
    w("- SOC 2 Type II")
    w("- Team/org support with RBAC")
    w("- Audit logging")
    w("- Volume committed pricing ($40/stage)")
    w("- Dedicated capacity / namespace isolation")
    w("- Custom domains / white-label")
    w()

    # ========================================================================
    # SOURCES
    # ========================================================================
    w("## Sources")
    w()
    w("### TAM — Analyst reports")
    w()
    w("| Market | Source | Link |")
    w("|---|---|---|")
    w("| Live streaming ($97B, 27% CAGR) | Mordor Intelligence, Live Streaming Market 2026-2031 | [mordorintelligence.com](https://www.mordorintelligence.com/industry-reports/live-streaming-market) |")
    w("| AI agent infrastructure ($11.8B, 41% CAGR) | Fortune Business Insights, Agentic AI Market 2026-2034 | [fortunebusinessinsights.com](https://www.fortunebusinessinsights.com/agentic-ai-market-114233) |")
    w("| Digital signage software ($14.3B, 12% CAGR) | The Business Research Company, Digital Signage Software 2026 | [thebusinessresearchcompany.com](https://www.thebusinessresearchcompany.com/report/digital-signage-global-market-report) |")
    w("| VTuber market ($3.1B, 10% CAGR) | Mordor Intelligence, VTuber Market 2026-2031 | [mordorintelligence.com](https://www.mordorintelligence.com/industry-reports/vtuber-market) |")
    w()
    w("### SAM — Competitor and category data")
    w()
    w("| Data point | Source | Link |")
    w("|---|---|---|")
    w("| Browserbase $4.4M ARR, 1K+ customers, $300M valuation | Latka (Jul 2025), Contrary Research | [getlatka.com](https://getlatka.com/companies/browserbase.com), [research.contrary.com](https://research.contrary.com/company/browserbase) |")
    w("| Browserbase $40M Series B, $300M valuation | UpstartsMedia (Jun 2025) | [upstartsmedia.com](https://www.upstartsmedia.com/p/browserbase-raises-40m-and-launches-director) |")
    w("| E2B $21M Series A, $32M total | PRNewswire (Jul 2025) | [prnewswire.com](https://www.prnewswire.com/news-releases/e2b-raises-a-21m-series-a-to-offer-cloud-for-ai-agents-to-fortune-100-302514540.html) |")
    w("| LiveReacting $20-350/mo | LiveReacting pricing page | [livereacting.com/pricing](https://www.livereacting.com/pricing) |")
    w("| Gyre.pro $49-289/mo | Gyre pricing page | [gyre.pro/pricing](https://gyre.pro/pricing) |")
    w("| ScreenCloud $21M revenue | ScreenCloud pricing page | [screencloud.com/pricing](https://screencloud.com/pricing) |")
    w("| AIRI 34K stars, Open-LLM-VTuber 6.2K stars | GitHub (Mar 2026) | github.com/proj-airi, github.com/Open-LLM-VTuber |")
    w("| three.js 108K GitHub stars | GitHub (Mar 2026) | github.com/mrdoob/three.js |")
    w("| LiveReacting 10K+ creators | LiveReacting website | [livereacting.com](https://www.livereacting.com) |")
    w("| Browserbase 1K+ orgs, 20K+ devs, 50M sessions | Contrary Research (Aug 2025) | [research.contrary.com](https://research.contrary.com/company/browserbase) |")
    w("| Claude Code 18.9M MAU | DemandSage (2026) | [demandsage.com](https://www.demandsage.com/claude-ai-statistics/) |")
    w("| Cursor 360K+ subscribers, 1M+ DAU | GetPanto (2026) | [getpanto.ai](https://www.getpanto.ai/blog/cursor-ai-statistics) |")
    w("| Twitch Art category 4.1M followers | Awisee (2026) | [awisee.com](https://awisee.com/blog/twitch-categories-for-twitch-streamers/) |")
    w("| Neuro-sama 162K Twitch subscribers (largest streamer) | Dexerto (Jan 2026) | [dexerto.com](https://www.dexerto.com/twitch/an-ai-powered-vtuber-is-now-the-most-popular-twitch-streamer-in-the-world-3300052/) |")
    w()
    w("### Platform context")
    w()
    w("| Data point | Source | Link |")
    w("|---|---|---|")
    w("| Twitch 7.06M monthly streamers, 97.2K concurrent | TwitchTracker, StreamScheme (2026) | [twitchtracker.com](https://twitchtracker.com/statistics), [streamscheme.com](https://www.streamscheme.com/twitch-statistics/) |")
    w("| Twitch/Kick crypto 25.8K concurrent | StreamsCharts (2026) | [streamscharts.com](https://streamscharts.com/channels?game=crypto) |")
    w("| 95% of devs use AI tools weekly | Builder.io, DEV Community surveys (2026) | [builder.io](https://www.builder.io/blog/cursor-vs-claude-code) |")
    w("| Claude Code 46% \"most loved\" | Developer surveys (2026) | [builder.io](https://www.builder.io/blog/cursor-vs-claude-code) |")
    w()
    w("### Infrastructure costs")
    w()
    w("| Data point | Source | Link |")
    w("|---|---|---|")
    w("| Hetzner CCX43 $112/mo | Hetzner pricing, SpareCores | [sparecores.com](https://sparecores.com/server/hcloud/ccx43) |")
    w("| Hetzner price adjustment Apr 2026 | Hetzner docs | [docs.hetzner.com](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) |")
    w("| RunPod SECURE RTX 4090 $0.60/hr | RunPod pricing (Mar 2026) | [runpod.io](https://www.runpod.io/pricing) |")
    w("| Cloudflare R2 pricing | Cloudflare docs | [developers.cloudflare.com](https://developers.cloudflare.com/r2/pricing/) |")
    w()
    w("### SAM CAGR methodology")
    w()
    w("SAM segment CAGRs are estimates, not analyst-sourced figures. Methodology:")
    w()
    w("| Segment | CAGR | Basis |")
    w("|---|---|---|")
    w("| Cloud browsers (80%) | Browserbase grew from $0 to $4.4M ARR in 16 months; category has 4+ funded startups (Browserbase, E2B, Steel, Hyperbrowser). 80% reflects early-stage hypergrowth that will decelerate. |")
    w("| 24/7 streaming (15%) | Mature segment (LiveReacting est. 2018, Gyre est. 2020). Growth tracks overall live streaming market (~27%) but discounted for incumbency. |")
    w("| AI VTuber (100%) | Nascent market — AIRI grew from 0 to 34K GitHub stars in ~12 months. Open-LLM-VTuber similar trajectory. Doubling annually is conservative for a new category. |")
    w("| Dev streaming (50%) | Driven by AI coding tool adoption (95% of devs weekly, up from ~40% in 2024). New content type that didn't exist before Claude Code/Cursor. |")
    w("| Creative coding (20%) | Stable niche growing with WebGL ecosystem (three.js 108K stars). Growth tracks broader creative tools market. |")

    return "\n".join(out) + "\n"


if __name__ == "__main__":
    content = compute()
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    out_path = os.path.join(repo_root, "docs", "pricing-model.md")
    with open(out_path, "w") as f:
        f.write(content)
    print(f"Generated {out_path}")
    print(f"  {len(content)} bytes, {content.count(chr(10))} lines")
