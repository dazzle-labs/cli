# Dazzle Platform - Distilled Requirements

Extracted from `/Users/cruhl/GitHub/stream/docs/messages/dazzle-platform.md`. Only user (Conner's) statements expressing requirements, decisions, specifications, or preferences.

---

## Platform Direction

- "We're transitioning dazzle.fm into a platform for agent streams"
- "We're simplifying dazzle.fm to more of a pure player focused on agent streams"
- "We're figuring out the right contract between agents and the rendering layer, getting the renderer able to push to Twitch and YouTube, and running our own agent streams to test everything end-to-end"
- Main page as "front door that shows off the capabilities of the product and is an invitation to try it before you go off and basically use it on your own"
- People should be able to have their own public channels too, not just private and semi-private

## Channel System

- Channel CRUD operations modeled after World domain, following fractal domain patterns
- "Channels as a folder" with Get, Create, Upsert, Deletion subdomains
- Channel is wrapper and owner of sessions, with optional userID
- Route: /channels/$channelID
- Database representation based off World domain pattern
- Sessions must be possible without a channel
- Legacy channels: "I don't even want you to be using the legacy channels... They shouldn't be type checked even, just they are there to have the prompts"
- Channel.Provider self-contained: reads sessionID from route params, queries session for channelID, provides channel via context
- "Follow the pattern of having providers push this down" -- not Zustand global store
- Channel.Create with templates: ~36 diverse presets, show 6 at a time with shuffle
- Channel.Status domain: draft | generating | ready
- Channel.Generation rewritten to AI agent with tool calls (nounVerb naming)
- Channel.Page reacts to persisted status field, polls when generating with refetchInterval(3s)
- Fix delete navigation: go to "/" not "/channels"

## Channel Visual Assets

- Thumbnail, Gradient, Cover as separate domains with Generation and Upload subdomains
- "Delete Channel.Attribute entirely, promote Gradient to Channel.Gradient"
- RESTful upload URLs: /api/v1/tv/channels/:channelID/cover/upload
- Express handlers (not tRPC) as thin wrappers around Effects
- Generation must preserve uploaded assets via "uploaded" boolean flag
- "Don't use .shape, use .extend"
- Per-asset domains: Channel.Thumbnail.Upload, Channel.Cover.Upload (not enum-based)
- Body size limits: upload routes register own Express.json({ limit: "5mb" }) before global middleware
- Parallel generation orchestrator reads once, generates in parallel, merges, one upsert

## Channel YAML

- Expanded from 3 options to 9: name, subtitle, description, prompt, status, permissions, thumbnail, cover, gradient
- Composable with fractal YAML options pattern

## Sidebar Design

- Left sidebar: channels preview split into Live (active sessions) and Your Channels (sorted by recent activity)
- Left sidebar width: 300px
- Right sidebar width: 420px
- Sidebar.Content wrapper with px-6 py-4 padding
- Sidebar.Title component for shared section title styling
- No horizontal dividers in sidebars
- "Do it as tv.sidebar.content. Don't import from the fucking relative"
- View all/everything link that takes you out, get rid of expand functionality in sidebar
- Font hierarchy: default for primary content, text-sm for secondary/metadata
- "Use first principles thinking to decide which text should actually be smaller"
- Create Channel button somewhere in left sidebar
- Channel details shown in sidebar on session pages but hidden on channel pages (redundant with hero)

## Razzle Personality

- Razzle is Dazzle's specific agent (TV.Razzle)
- Uses same MCP interface as external agents (dogfooding)
- Agent personality and behavior requirements for the internal agent

## Agent Selector UX

- Interface for selecting which agent operates a stream
- Agent selector design for the platform

## MCP Integration

- 15 MCP tools: 13 core + 2 conditional chat
- Connect/disconnect semantics (not start/stop)
- /connect page for MCP connections
- Agents operate streams end-to-end through MCP
- Usage-based billing with Stripe
- "Dazzle's internal agent shares the same interface as external agents"

## Session and Streams

- Sessions powered by URL parameters: /sessions/$sessionID
- Session.Get.Input shared type for { sessionID: ID }
- "The default should always be the main session that's ongoing without a user_id at a given time"
- Always fresh session on server boot during beta
- Stream titles and previews need improvement: "more in line with how channels work"
- Stream previews need subtitle line and gradient styling

## Mobile and Layout

- Overhauled sidebar and mobile layouts
- "Our layout is kind of fucked such that the channel page is smooched to the left instead of taking up all the side room it can"
- Channel page needs flex-1 min-w-0 overflow-y-auto on root div
- TanStack Router routing with proper outlets verified
- Keep TopBar + Sidebar + Channel Page layout

## Dual Audience Model

- "The dual audience, either you're able to operate the stream or you're not"
- "The owner is the one that sees everything"
- "If there is no chat enabled, we should probably just not even show that tab"
- Streaming responses for chat: evaluate complexity first
- Single user: send commands through as quickly as possible
- Multiple users: balance carefully, bias towards entertaining/enjoyable outcomes for group

## Pricing and Business Model

- "It's usage based streaming really"
- Not sharing exact GPU costs but debating cost estimation approach
- "The bigger question we're working through is what makes the stream interesting enough to pay for"
- "We think it's interesting enough to get at least some population of people paying for it just for the novelty"
- Tension between studio tool direction and open-ended streaming direction: "We're more interested personally in the interactive Twitch style"
- Channel ownership model additive to interactive streaming; creator benefits, sponsorships possible

## Composer

- Theme.Glass for composer, soft edges, no hard lines
- Start Stream as primary button; live dot when running
- Composer hover animation when no stream started
- Scale on click like Theme.Button
- "The buttons are on the wrong side of the composer now"
- Bigger input area

## DevTools and Development

- /dev page with Appearance, Settings, Meta sections
- 5-tap mobile activation on avatar for DevTools (developer users only)
- Ctrl+P toggles Preview mode
- "Can I remove everything except support@dazzle.fm from the contact? Like, my address is on there"
- MCP harness for evaluating content quality

## Domain Architecture

- "DOMAIN OWNERSHIP IS ABSOLUTE"
- "Code has to live in the domain that owns the concept"
- Parents compose, nothing more
- "Absolutely too much logic in the TRPC. There should be an effect for that"
- "Instead of prop_drilling session_id everywhere, we should be having a tv.session.use_id"
- No SCREAMING_SNAKE_CASE, use functions
- Prefer .optional() over .default() in Zod schemas, preset() pattern
- "Stop littering comments everywhere that aren't domain documentation"
- nounVerb tool naming pattern
- "Don't export all as sidebars... Just define the sidebar store inline inside this namespace"
- Schema defaults rule: prefer .optional() with preset() over .default()

## Investor Updates

- Cash: $145,712.09
- "We did a big product push in February alongside all of this including a channel system where you can generate channels from prompts with proper pages and permissions"
- "We got rid of the strategy because it just felt like I was repeating a bunch"
- Agentic broadcasting as core product direction
- LTX2 streams struggled: "minimum of trippy dreamlike visuals, and the output just can't carry a stream worth watching"
- Chrome rendering at $0.10/hr changes viability
- Discord live tests: "people really didn't like trying to prompt a stream together; there were constant collisions and frustration"
- Starting with situation monitor stream, planning YouTube/social media publishing
- Targeting OpenClaw agent operators
