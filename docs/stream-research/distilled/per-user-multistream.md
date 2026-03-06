# Per-User Multistream - Distilled Requirements

Extracted from `/Users/cruhl/GitHub/stream/docs/messages/per-user-multistream.md`. Only user (Conner's) statements expressing requirements, decisions, specifications, or preferences.

---

## Stream Domain Refactoring

- Create a new top-level TV.Stream domain; centralize stream code out of TV.Player.Stream and TV.Video.Generation.Stream
- Stream type holds a Connection; MSE pulled up to TV.Stream
- "TV.Stream.Set will manage everything related to updating an ongoing stream with new parameters... the renderer's going to be able to call stream set effect that effectively hides away all of the details of how it's actually working"
- "The renderer should only talk to that through an interface that completely abstracts away the DRPC in actual request style that DRPC expects"
- "runtime start will call stream.effects still, just like all the other .forks"
- "I want there to be a stream.effect which opens up the connection and does all the management of that state... we shouldn't have to do a manual TV stream connection close. We should just use the normal effect lifecycle to close all that using the scope we already have"
- "TV.Stream.Connection.Dispatch.Event.effect -- That's crazy. Let's just do a TV stream set"

## Connection Domain

- Connection must own everything related to maintaining and keeping alive an ongoing connection
- "I really don't like the way this one effect is written. I think you should be using effect primitives and not trying to do like while loops and setting a stream connection to undefined... We need the nested effect.gens and effect.forever"
- "I only want there to be one effect that does everything for connection" -- no separate connect() helper, no managed() function
- "I don't want logs" in the connection lifecycle
- Queue for inputs may be over-complication: "I want you to evaluate the way things work now... figure out if there's a better effect set of parameters we can use to inject instructions into GRPC versus having another queue"
- Connection effect should be pause-aware: disconnect gRPC when paused, reconnect when unpaused, self-contained in Connection domain

## Consensus and Multi-User Behavior

- "When it's a single user or even two users, we have to respect some idea of consensus, but if it's a single user, obviously we send that stuff through as quickly as humanly possible"
- "When it's multiple users, we need to be a little bit more careful about balancing, but we bias towards what would be the most entertaining and enjoyable outcome for a group of people in a chat room trying to steer the stream"
- Design interaction behaviors thinking about "what would be annoying, what would be frustrating" for a shared stream

## Sidebar and Navigation

- Split channel previews into groups: Live first (channels with active sessions you can see), then Your Channels (sorted by most recent activity)
- Both groups use channels.previews for rendering
- Sessions page and channels page instead of "show more" links; reusable grid collections component for both
- "Break up into sections... there needs to be a way to show everything. Session stream should only be yours. Name subtitle for sure. Life status would be useful. Stream count maybe"
- "I like the blurred gradient effect at the bottom to make it readable"
- "Some kind of view all or everything that takes you out and then get rid of the functionality to expand them in the sidebar"
- Sidebar widths: Left 300px, Right 420px
- Sidebar.Content wrapper with px-6 py-4 padding for consistent spacing
- Sidebar.Title component for shared section title styling
- No horizontal dividers in sidebars
- "Do it as tv.sidebar.content. Don't import from the fucking relative"

## Stream Titles and Previews

- "We need to really adjust how stream titles work. I have like a session title and preview image for your streams. These previews on the left hand side need to be improved... more in line with how channels work"
- Stream previews need a subtitle line and gradient styling like channels

## Dual Audience Model

- "The dual audience, either you're able to operate the stream or you're not"
- "The owner is the one that sees everything. If there is no chat enabled, we should probably just not even show that tab"
- Streaming responses for chat would be nice but evaluate complexity first
- "Nothing can wait. We're getting this all done"

## Session Architecture

- Sessions powered by URL parameters with route /sessions/$sessionID
- Session.Get.Input shared type for { sessionID: ID } used across all tRPC endpoints
- Session.useID from route parameters instead of Runtime.Local store
- "The default should always be the main session that's ongoing without a user_id at a given time"
- "For right now, we're only supporting one session like the whole site, so we need to enable going in the future sessions by users or potentially multiple sessions without user_ids"
- Always fresh session on server boot during beta: "whenever the server starts up, it's always a new session"
- "I don't want to delete all of the data. I just want a fresh session"
- Zod validation errors in session data should gracefully create new session instead of crashing
- "getLatest is such a smell, it's not just getting anymore. It's literally doing a get or create. Don't be flimsy about shit like that" -- renamed to getOrCreate

## Channel Domain

- Channels as a folder with CRUD operations, modeled after World domain
- Channel is a wrapper and owner of sessions, with optional userID
- Database representation based off World pattern
- "Sessions without a channel" must be possible
- Route: /channels/$channelID
- "Those should absolutely be required [created/updated fields] and I don't even want you to be using the legacy channels... They shouldn't be type checked even, just they are there to have the prompts"
- Channel.Create.Button in left sidebar, /channels/create route, basic Channel.Editor domain
- Channel.Provider pattern: self-contained, reads sessionID from route params, queries session for channelID, fetches channel, provides via context
- "Follow the pattern of having providers push this down" -- not Zustand global store
- "Export a Channel Provider, its channel dot provider" -- TV.Channel.Provider not TV.ChannelProvider
- Channel attribute generation: Thumbnail, Gradient, Cover as separate domains with Generation and Upload subdomains
- "Delete Channel.Attribute entirely, promote Gradient to Channel.Gradient"
- RESTful upload URLs like /api/v1/tv/channels/:channelID/cover/upload
- Express handlers as thin wrappers around Effects
- Generation must preserve uploaded assets via "uploaded" boolean flag
- "Don't use .shape, use .extend"
- Channel.Generation rewritten from hardcoded parallel to AI agent with tool calls using nounVerb naming (titleSet, thumbnailGenerate, etc.)
- Channel.Status domain: draft, generating, ready
- Channel.Template/Templates with ~36 presets, sample(6) on mount, shuffle capability
- Prefer .optional() over .default() in Zod schemas, use preset() pattern

## Player Redesign

- "Elapsed = absolute content time" -- Player is source of truth, MSE/video element are render targets
- Eliminate Scheduler domain, fold into Player store
- Elapsed/timing/listeners must be closure variables inside store creator, NOT on Zustand state (causes constant re-renders)
- useElapsed(ms): simple setInterval, not listener subscription
- useOnFrame(callback): low-level hook for DOM-direct updates
- "play, pause, no. Is playing desired and is playing actual could be the only things we use to communicate that"
- "setIsPlayingDesired is the only allowed mechanism for playing or pausing"
- No isAtLiveEdge spinning in RAF loop
- "Stream should be truly dumb" -- no timing logic, no elapsed restoration, no volume sync, just a video element that follows the Player
- No per-frame video seeking during playback: only seek during scrubbing and on play/resume transitions
- Volume/mute sync colocated in Controls/Volume

## MSE Buffer Management

- Buffer eviction to prevent unbounded memory growth
- 30-second back buffer target
- Eviction must not remove content within playable range
- "Don't worry about QuotaExceededError handling"
- "Stop littering comments everywhere that aren't domain documentation"

## Renderer Pipeline

- Renderer Send/Receive split (from unified Execution)
- "Video.Input as generation command": reframe commands as TV.Video.Input with { prompt, duration, transition }
- Instruction.Video: { kind: "Video", prompt (original), input: TV.Video.Input (expanded) } -- NOT intersection, a field called input
- pending map: Map<ID, TV.Renderer.Instruction.Video> -- full instruction, not just prompt
- Derive "when" from pending.size === 0 instead of mutable nextWhen state
- Stream.Request: thin wrapper taking StreamGenerateRequest directly, rename offer to effect
- "Maybe while is fine" for Receive loops -- prefer simple while loops over recursive helpers

## Task Domain

- New TV.Task domain for agent activity management, separate from Guidance
- Tasks are independent timeline entries, not snapshots; each operation creates its own entry
- Task.Set operates on singular task with operations: add, update, complete, delete
- Task has "expected" field: agent provides relative seconds from now, server converts to absolute elapsed
- Tasks YAML option must be { completed: boolean } | false, not just boolean
- "Can't provide optionals with LLM tools. So rewrite that account for that limitation" -- use sentinel values like "keep", "new", -1
- Guidance refocused to long-term memory: "the why behind decisions, themes, viewer intent, what's working"
- "NOT for plans, to-dos, or activity management -- that's what Tasks own"

## Pacer / Governor

- PID controller-based pacing system for generation buffer
- "As tight as possible" -- just-in-time dispatch, rate-limited acceptance
- Back-pressure from Send through Instructions to Agent
- Near-instant interruptions
- Pacer in its own file (TV/Runtime/Pacer.tsx)
- Script domain should have its own budget, isolated from renderer pipeline

## Domain Architecture Rules

- "Code has to live in the domain that owns the concept. This ownership is the most important thing"
- "If any business logic is happening related to a domain at all that is outside of that domain, there must be extreme justification. Enforce this rule violently"
- "DOMAIN OWNERSHIP IS ABSOLUTE" as Critical Rule #1
- Parents compose, nothing more; callers invoke, never implement
- Fractal domain composition: each domain owns its own .mcp() inline, not centralized
- "Absolutely too much logic in the TRPC. There should be an effect for that and then the TRPC just neatly wraps it"
- "Namespace MCP, we don't need a server only because it's already in the server domain"
- "For prompt cache key, just use the domain as is like TV.HUD.agent"
- "Don't export all as sidebars or import all as sidebar store... Just define the sidebar store inline inside this namespace"
- "Instead of prop_drilling session_id everywhere, we should be having a tv.session.use_id"

## HUD Domain

- TV.HUD as a new domain containing title (and eventually buttons)
- Title routed through same path as status; LLM has ability to set left-aligned title on HUD
- HUD.YAML composed same as everything else with options
- Interaction namespace should live inside HUD, not in index
- "TRPC mutations should only be thin wrappers around effects"
- "We need to be careful with this one not to just continue updating the UI for no reason. Often it's good to do nothing"
- Wake after elapsed (not real clock time): "We don't care if a bunch of time has passed if the elapsed has stopped progressing"
