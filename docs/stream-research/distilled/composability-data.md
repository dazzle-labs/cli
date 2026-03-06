# Composability & Data - Distilled Requirements

Extracted from `/Users/cruhl/GitHub/stream/docs/messages/composability-data.md`. Only user (Conner's) statements expressing requirements, decisions, specifications, or preferences.

---

## Fractal Domain Composition

- "Code has to live in the domain that owns the concept. This ownership is the most important thing. Other domains can compose together from domains where the business logic lives to make more complicated behavior, but the leaves of code, the leaves on the tree must always, always, always be located in the domains that own them"
- "If any business logic is happening related to a domain at all that is outside of that domain, there must be extreme justification. Enforce this rule violently in the CLAUDE.md and cursor rules"
- MCP follows same fractal pattern as tRPC: each domain owns its own .mcp() inline, not centralized
- TV.Agent = generic agent concept; TV.Razzle = Dazzle's specific agent
- Razzle uses same MCP interface as external agents (dogfooding)
- 15 MCP tools: 13 core + 2 conditional chat tools

## MCP Integration

- Connect/disconnect semantics, not start/stop
- /connect page redesign for MCP connections
- Consistency audit requirements across MCP integration
- Agents can operate Dazzle streams end-to-end through MCP: longer-form tool calling, web searches, real-time information, bring whatever capabilities they have
- "Dazzle's internal agent shares the same interface as external agents now, so we're dogfooding our own integration"
- Usage-based billing with Stripe so anyone can pay for stream time

## Command Domain Promotion

- Reframe Chat.Command as TV.Command (just text, no source field)
- Command event kind changed from "Chat.Command" to "Command"
- "Instead of command: true, make it commands: true" -- YAML options field name

## Prompt Caching

- Namespaced prompt cache keys: "TV.Agent", "TV.Chat.Agent"
- "For prompt cache key, just use the domain as is like TV.HUD.agent"

## Session Architecture

- Multi-session support via URL params (/sessions/$sessionID)
- Session.Get.Input shared type: "{ sessionID: ID } Like this should be Session.Get.Input i.e. type Input = zInfer<..."
- Map-based pending in Runtime.Start (not called "pending map")
- "runtime.stream should just be TV stream. Stream holds a connection"
- Chat.Runtime.initial() namespace for delegating initialization to domains

## YAML System

- Timeline YAML options: commands: boolean field
- YAML options composition follows fractal pattern
- Tasks option: { completed: boolean } | false (not just boolean)
- Channel YAML expanded from 3 to 9 options: name, subtitle, description, prompt, status, permissions, thumbnail, cover, gradient
- "I don't know why you said timeline entry YAML returned nothing for both chat message and task. Obviously go make those real YAML gets"

## Scheduler and Loops

- "Murder loops and all related code" -- delete Server/Scheduler entirely
- Delete all loop-related code from Server.index
- No DB migration for this change

## Renderer Pipeline Architecture

- Renderer Send/Receive split replacing unified Execution
- Latch-driven execution model
- "The concept of commands, I want to reframe as a video dot input in the video domain"
- Video.Input: { prompt, duration, transition } with transition definitions (match, cut, extend)
- Instruction.Video: { kind: "Video", prompt: AI.Prompt (original), input: TV.Video.Input (expanded) }
- "No I do not like Prompt and expanded it should absolutely not be doing that. prompt represents the prompt for the video. You can keep prompt on instruction"
- Pending map should be Map<ID, Instruction.Video> -- full instruction, not just prompt
- Derive "when" from pending.size === 0, eliminate nextWhen mutable state
- Stream.Request: thin wrapper, just takes StreamGenerateRequest, rename offer to effect
- "Maybe while is fine" for Receive loops

## Timing and Elapsed Management

- Elapsed = absolute content time from start
- "We're constantly stuttering, so there must be something that's hot updating the stream" -- no per-frame video seeking during playback
- Timing stop/start management for video generation

## Script Generation

- Renderer prompting must be "very clear that its job is to interpret the instructions into videos"
- "It's not using transitions well enough. We really need to emphasize some first principles about how to do transitions. Like extend should literally only be used if the camera is just not moving"
- "Think about this in terms of what the camera is doing and give much stronger guidance"
- "I think we've eliminated too much context from script generation prompting... evaluate that and decide what you think is the most important things we lost and re-inject them"
- Script domain should have its own budget, isolated from renderer pipeline

## Task Domain

- New TV.Task domain following fractal domain patterns
- Tasks are independent timeline entries (not snapshots)
- Each task operation creates its own entry
- Task.Set operates on singular task with operations: add, update, complete, delete
- "expected" field: relative duration from agent, server converts to absolute elapsed
- "Can't provide optionals with LLM tools" -- use sentinel values
- Guidance refocused to long-term memory: "the why behind decisions, themes, viewer intent"
- "NOT for plans, to-dos, or activity management -- that's what Tasks own"

## HUD Domain

- TV.HUD for dynamic UI controlled by LLM
- Title, and eventually buttons (above chat bar like choice games)
- "In all of the export const initials, stop defining variables like const scheduler equals yield scheduler create. Just do it in line in the object"
- "For the HUD agent system prompt, we're doing too much description in the system prompt and we need to do more of it in the tool calls like the other agents"
- "We need to be careful with this one not to just continue updating the UI for no reason. Often it's good to do nothing"
- "Interact namespace... why the fuck is interact inside the index for HUD that should be in its own namespace"
- "TRPC mutations should only be thin wrappers around effects"
- "The pending deferred... I'm very suspicious of what got changed there. Make sure that that's actually doing what we're expecting"
- Wake after elapsed not real clock time: "We don't care if a bunch of time has passed if the elapsed has stopped progressing"
- Use ternaries instead of full if blocks

## Composer Redesign

- Use Theme.Glass for the composer, get rid of hard lines
- Start Stream as primary button; when running, primary with live dot ("In Stream" or "Stop Stream")
- Full theme button for stream controls
- "The composer should hover when cleanly the background, when we haven't started a stream yet, animate that"
- "The buttons are on the wrong side of the composer now"
- "When it's in big button mode, the composer has it scale like theme.button does when it's clicked"

## Layout and UI

- Video glow and effects must extend past video element underneath both sidebars
- Page must not be scrollable; composer must always be accessible
- Chat scrollable area needs mask to blend out top as you scroll
- "Way too much padding around it when I'm just in a normal state"
- "You've completely fucked up the layout" -- effects no longer extend, page is scrollable, padding wrong

## Cherry-Pick Process (from HUD branch)

- Include: CLAUDE.md updates, TV.Command promotion, prompt caching, Chat.Runtime.initial(), multi-session, Session.Get.Input, renderer/script prompt changes, Go Live, ManagedMediaSource Safari fix, delete Scheduler, Player Instance cleanup
- Exclude: MCP, Sidebar, HUD, consolidated YAML/DevTools, userID on sessions, source field on Command, Session.List/Create procedures, Channel deletion, DevTools deletion
- "Keep everything on main" for deletions
- Skip DB migration entirely

## Code Style and Architecture Rules

- "DOMAIN OWNERSHIP IS ABSOLUTE" as Critical Rule #1
- No SCREAMING_SNAKE_CASE (use functions)
- No `as` or `!` assertions
- Fractal domain ownership pattern
- "Don't export all as sidebars or import all as sidebar store"
- "Instead of prop_drilling session_id everywhere, we should be having a tv.session.use_id"
- "userID is not a string. It's the global ID type. That's got to be true everywhere else. Like z.string is id.schema"
- Prefer .optional() over .default() in Zod schemas
- "Stop littering comments everywhere that aren't domain documentation"
- Tool names use nounVerb pattern (titleSet, thumbnailGenerate, etc.)

## Investor Update (February)

- Cash: $145,712.09
- Not "AI-generated television" but "AI-generated experiences for streaming"
- Emphasize product is in production, people can try it
- "We have a moat beyond just speed, we're actually doing some clever stuff to make this work as a stream"
- Main page as "front door that shows off the capabilities and is an invitation to try it"
- Public channels in addition to private and semi-private
- "It's usage based streaming really" for the pricing model
- "We don't think we would share the exact costs... but we're debating like, do we estimate the cost per hour?"
- "There's tension between whether creating a UI around the single player fine tuned experience... is in tension to the sort of open ended infinite nature of streaming generated content"
- "We're more interested personally in that dynamic" -- the interactive Twitch-style model
- "Following the same discord strategy... we're still figuring out exactly who that might be"
- Acknowledge current flaws with LTX2: audio quality harsh, prompt adherence not great, but open source community improving it
- "The idea that people could use their agents, like now that we've seen this whole open claw agent explosion, I think there is a real potential market"
- "There's a way to market this towards agents as users that I think we need to explore a bit more"

## Dev Evaluation Harness

- MCP harness for evaluating LLM-driven content
- Content specification research
- Evaluation criteria for test runs of Dazzle streams
