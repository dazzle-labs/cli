# Rendering & Video - Distilled Requirements

Extracted from `/Users/cruhl/GitHub/stream/docs/messages/rendering-video.md`. Only user (Conner's) statements expressing requirements, decisions, specifications, or preferences.

---

## Chrome Sandbox Rendering

- Pivoting from GPU-rendered video to Chrome sandbox rendering
- Chrome tab rendering costs ~$0.10/hr vs $3.50-5/hr for GPU
- "The cost reduction changes everything about what's viable"
- Renderer needs to push to Twitch, YouTube, and dazzle.fm

## Renderer Pipeline Redesign

- Split Stream into Request/Response domains
- Split Renderer into Send/Receive (replacing unified Execution)
- Pending map for ID-based correlation between requests and responses
- Latch-driven execution: Send awaits renderer latch when no Videos available
- "The concept of commands, I want to reframe as a video dot input in the video domain"
- Video.Input = { prompt, duration, transition } where prompt is the expanded LTX-2 prompt
- Video.Input.Transition owns z.enum(["cut", "match", "extend"])
- Instruction.Video = { kind: "Video", prompt: AI.Prompt (original scene prompt), input: TV.Video.Input (expanded generation params) }
- "No I do not like Prompt and expanded it should absolutely not be doing that"
- Pending map: Map<ID, TV.Renderer.Instruction.Video> -- stores full instruction, not just prompt; use ID type not string
- Eliminate nextWhen mutable state: derive "when" from pending.size === 0
- Stream.Request: thin wrapper, takes StreamGenerateRequest directly, rename offer to effect
- Stream.initial(): inline queue creation, no separate variables
- "Maybe while is fine" for Receive.tsx loops

## Renderer Prompting

- "We need to really think about how we're prompting the renderer to make sure it's very clear that its job is to interpret the instructions into videos"
- "It's getting confused, it's repeating itself a little bit"
- "It's not using transitions well enough. We really, really need to emphasize some first principles about how to do transitions"
- "Extend should literally only be used if the camera is just not moving. It's on the same subjects, on the same person. If somebody else is talking, we obviously can't extend"
- "Think about how match would work... Think about how cut would work"
- "It's not just a previous scene, it's a previous camera shot. We really need to think about this in terms of what the camera is doing"
- "I think we've eliminated too much context from script generation prompting... evaluate that and decide what you think is the most important things we lost and re-inject them"
- "Help me figure out why sometimes the renderer repeats itself even some of the same dialogue multiple times over"
- "Make transition part of TV video transition. That's the domain."

## PID Controller / Pacer

- PID controller-based pacing system for generation buffer
- "As tight as possible" -- just-in-time dispatch, rate-limited acceptance
- "Block in Receive" approach confirmed
- Interruptions are huge: "interrupt now" or "interrupt next"
- Optimize the "when" variable going into the stream
- Back-pressure propagation from Send through Instructions to Agent
- Pacer in its own file (TV/Runtime/Pacer.tsx)
- "Put functions related to breakdown inside the breakdown namespace"
- "Remove anything using max ahead that could be using the new pacer"
- Script domain should have its own budget (90s), isolated from renderer pipeline: "That domain seems kind of isolated"
- Pacer.ensure() for lazy initialization to handle HMR: "When I issue a chat it just seems to get stuck now"

## Player Redesign

- Comprehensive audit and redesign of TV player state and timing
- "Elapsed means absolute content time"
- "MSE speaks in relative time, needs sync with absolute elapsed"
- "Player should be source of truth, MSE/video element are render targets"
- Eliminate Scheduler domain, fold into Player store
- "Stream should NOT set timing - move to Player"
- Move volume/mute sync to Controls/Volume
- Keep clock data directly on Zustand store, mutate fields directly
- Module-scope functions inside store creator closure
- useElapsed(ms) and useOnFrame hooks
- No RAF-speed React re-renders
- Elapsed/timing/listeners must be closure variables, not on store state: "put elapsed on the player store, which means it will update every all users of the state constantly you need to fix that"
- useElapsed: "should not be using a listener, just do an interval"
- "play, pause, no. Is playing desired and is playing actual could be the only things we use to communicate that"
- "setIsPlayingDesired is the only allowed mechanism for playing or pausing"
- "setIsPlayingActual should be a direct setter"
- Remove isAtLiveEdge spinning in RAF loop: "do it more like how it used to work"
- Auto-resume handled by setTiming
- "When we're playing, we're constantly stuttering, so there must be something that's hot updating the stream" -- no per-frame seeking during playback, only during scrubbing

## Stream Domain

- "Stream should be truly dumb" -- no timing logic, no elapsed restoration, no volume sync
- "We have some clip mode logic inside of the MSE or the stream hook. And I don't think we want it there. We want that either in clip or not"
- "Sometimes when I'm scrubbing, the video continues trying to play"
- "Do an audit of the stream domain and make sure that we aren't over-complicating the state here"
- Synchronize function must sync play state, volume, and position within tolerable drift ranges

## MSE Buffer Management

- Audit of MSE memory usage: unbounded growth problem
- Buffer eviction to prevent memory exhaustion
- 30-second back buffer target
- Don't evict videos within playable range
- "Don't worry about" QuotaExceededError handling
- "Stop littering comments everywhere that aren't domain documentation"
- "I don't want it attached" (MSE on Stream namespace)
- "No I don't want to expose it at all, we don't need it in devtools"
- MSE hook takes onAppend callback: "Have the MSE hook take a function that you can call on appended"
- "I don't think we need to have that callback be part of the store. Just use normal react lifecycle"

## Connection Domain

- Single Connection.effect() that does everything for connection: "I only want there to be one effect that does everything"
- Connection effect is pause-aware: disconnect gRPC when paused, reconnect when unpaused
- All lifecycle management contained in Connection domain: "I don't think the stream should know anything about killing the connection"
- Use Effect.scoped for resource management, not manual scope management: "you're abusing some odd behavior there passing around scopes using a wild loop"
- "I don't want logs" in connection lifecycle

## Sequence/Content Model

- Content specification research for agent-driven broadcast streams
- Sequences replace single-instruction rendering model
- Sequence.Prompt for per-sequence generation prompting
- "So it's not using transitions well enough" -- need stronger transition guidance in sequence prompts

## Video Generation Infrastructure

- LTX2-distilled model for video generation
- gRPC bidirectional streaming via Axis Router
- 640x384 resolution, 24fps
- Context strength mapped from transitions: cut=0, match=0.5, extend=1.0
- Image latency sub-0.4 seconds (potentially 0.2 seconds)
- ACE-Step 1.5 music model
- "Audio to video opens up categories of like re-skitting entire existing movies"
- Open source world models (Ling) running on 8 GPUs expected to be future direction
- "If we play our cards right, the infrastructure around driving real time models we're building could translate well into the ability to steer world models"

## Dev Evaluation Harness

- MCP harness for simulated user/agent interactions
- Evaluation criteria for content Dazzle produced (not the agent or user)
- Cold-start evaluation scenarios
- Content quality assessment framework

## Investor Update Content

- Cash: $145,712.09
- "Beyond just speed and cost, we think we have a real moat forming in how we make the stream actually work"
- Using techniques to "smear context through latent space to create smooth transitions, keep things consistent shot-to-shot, and extend audio forward through independent video generations"
- "The ability to run ahead of real-time has made us rethink every part of the product and effectively redesign the entire generation stack around having time to spare"
- "Previously, we were running three GPUs wide to generate futures we didn't actually use"
- "For the first time, we have a budget for things like LLM guidance of the video model"
