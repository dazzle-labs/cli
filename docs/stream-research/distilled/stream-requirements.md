# Distilled Stream Requirements

Extracted from Conner's statements across ~217k lines of claude-history search results. Each bullet is a direct quote or close paraphrase. Grouped by topic, deduplicated. Second pass added requirements from conversation summaries and Q&A sessions found in lines 34000-216949.

---

## Product Identity & Naming

- "Channel or Stream could be used no problem. Those suggestions are super cringe." (on naming the container concept for sessions)
- "What's a good name for the concept of a Channel or a Stream in the product? Basically the container for sessions which will eventually have their own attributes/permissions/discoverability, etc."
- "Rename sessions to streams in UI and make a note in the documentation. That's how it's referred to -- as streams."
- "Actually, I do like the watch live, but I want it to be watch stream."
- "Instead of saying a player for agent streams, make it a platform for agent streams and make it flow better with the preceding content."
- "We're transitioning dazzle.fm into a platform for agent streams."
- The built-in agent should be called "Razzle" (Razzle-Dazzle). TV.Agent is the generic agent concept; Razzle is Dazzle's specific agent implementation.

---

## Stream Architecture & Connection

- "I want a stream connection effect which manages all of its own life cycle, so the parent stream doesn't have to know about any of that. I want to use as much Effect primitives as possible for management. I don't think we need a queue anymore. We're just firing and forgetting whenever we get a dispatch. I want to use abort controllers correctly. I want to use Effect streams as correctly as possible."
- "The stream needs to be simplified to just effectively receiving prompts, applying them and emitting. The stream shouldn't even be sending events out. The renderer will just get back the effect when it acknowledges it's been sent."
- "I want there to be a stream.effect which opens up the connection and does all the management of that state... we shouldn't have to do a manual TV stream connection close. We should just use the normal effect lifecycle to close all that using the scope we already have."
- "Runtime start will call stream.effects still, just like all the other .forks."
- "The runtime stream should just be TV.Stream. Stream holds a connection."
- "I want instead of there to be a .connection.dispatch.event.effect -- that's crazy. Let's just do a TV.Stream.Set and the TV.Stream.Set will manage everything related to updating an ongoing stream with new parameters."
- "The connection needs to own everything related to maintaining and keeping alive an ongoing connection. The set domain is responsible for issuing actual commands against that connection. The renderer should only talk to that through an interface that completely abstracts away the gRPC."
- "I'm suspicious that even the request queue is an over complication. A queue for inputs doesn't make much sense when you can just fire them and forget."
- "We should get rid of the spy or console log I did on the responses from GRPC. I don't necessarily want to start up the stream all the time. It just needs to be ready to be started up if somebody got on the page."
- "I want there to be two new domains in Stream and get rid of Command where it's Stream.Request and Stream.Response. And then the Stream type will compose those using the fractal domain pattern."
- "Don't be afraid to restructure the Stream namespace a little bit. We can have potentially a request and response queue."
- "We want to actually terminate the connection if we are paused."

---

## Renderer & Video Pipeline

- "The renderer needs to be split up into basically its main renderer.effect. We have two things we need the renderer to do. It needs to both interpret a list of instructions into fully interpreted instructions (running it through the LLM). And it needs to have a process for churning through those instructions, making sure they're scheduled to run at the appropriate times, separate from generating based off scripts."
- "We want all of the business logic for how we respond to videos to exist really in renderer."
- Videos always come back from the stream in order -- split Renderer into Send (fire-and-forget dispatch) and Receive (dumb video acceptance).
- "Let's have the command effect handle the scenario where even though send fires and forgets, when a command is actually sent, we can await its response and then make sure what gets sent back to the listener actually does contain the prompts."
- "Let's move the When into Renderer because I just don't even -- Request shouldn't even really know that that exists. It's just a parameter that gets passed through."
- "We don't need a dispatched queue for prompt correlation." / "Do we even need a stream.last-? What is that even for?"
- ID-based correlation: gRPC responses will include a text asset with the command ID. Renderer maintains a pending Map to correlate command IDs back to prompts. "It doesn't store the prompt. It stores the ID of the command we sent."

---

## Timing & Pacing

- "Elapsed is supposed to represent the duration of time that has occurred in content space from an absolute perspective." Throughout the system, elapsed means how far from zero into the content have we gotten.
- "Under no circumstances when we are adding videos/responses can we get too ahead of real time on the response side. We can't add faster than real time. We need to take account for videos having different durations."
- "On the send side, we need to be far enough ahead into the future that we don't stutter and we have enough prompts that the stream is busy and saturated. But we need to avoid over-generating prompts that we then cancel on. If we're over-generating by more than 30 seconds or so, that's probably not ideal."
- "The GRPC request, the stream domain, should have really no knowledge of this timing logic. The renderer needs to be the one that's aware and enforcing this timing."
- "The concept of the present is totally defined by the idea of where you are at elapsed time. Elapsed plus time is the future, elapsed minus time is the past. Any deviation from that philosophy is a smell."
- "If users' eyeballs are at elapsed zero, the only thing that matters is that the connection is being used so that the next video they see is always as close as possible to zero wait time. We never have a connection doing stuff out in the future if we need it now."

---

## Sequences & Future (replacing Renderer)

- "We are going to delete the idea of a renderer. We are going to replace the concept of a renderer with sequences plus a new domain called Future."
- A sequence is "a coherent unit of time -- the ability to describe at a high level, anywhere from one single video up to 60 seconds. It's a unit of time where you can say here's what needs to be accomplished and it owns the generation, it owns this life cycle, and it is a complete thought."
- "The main TV agent is able to say, okay, now do this sequence, now do this sequence, and think at the level of units of plot that are much broader."
- "Future will be basically replacing the role that the renderer has in the LLM context as what's going to happen."
- Sequences should own their videos. "I do think having this concept of a totally flattened timeline -- until we get basic stability around sequences, I'm distrustful of that."
- "I do think we want a sequence type on the timeline because I also want sequences to own state like they used to -- attributes and title -- because we might use sequences for exporting and understanding what happened instead of just a giant list of videos."
- "We're going to get rid of the ability for individual videos to be timeline entries." Videos now only exist inside sequence.timeline.
- YAML representation for the LLM: "It needs to have an understanding of futures that are directly upcoming (what will be experienced) and then futures that could possibly happen. The YAML representation should allow it to peer into the sequences that are expected to occur and when, with enough detail to meaningfully act on the future through tool calls."
- "The script domain is a top level thing that doesn't make so much sense. It's more like a sequence plan now."
- Guidance: "I don't think there is guidance at the renderer level anymore. It's like the prompt is the guidance. The prompt gets expanded into a plan, which is what actually happens. Then that plan gets chopped up into individual videos."
- Prompt expansion should be streaming from a single LLM call, not agentic tool calls: "If we can get it to be streaming from a single kind of dumber LLM than a fully agent one, we'll both be faster and more cost effective."
- "I don't think we want a per-sequence director. What we're trying to create is a MCP server-like agent surface area that any agent could use to operate these primitives."

---

## Interruption & Past vs Future

- "Videos that haven't happened yet from the experience horizon of a viewer can be thrown away. The viewer has no idea. But what happened, happened. You can't take back the past."
- "You have infinite flexibility on the future, but the past is actually the past."
- "We have to be able to interrupt to make the plot coherent. If I'm an agent and somebody typed 'The river card is Ace of Spades,' we can't continue with that sequence or it would ruin the objective reality."
- "If you fully trace the lifecycle from user said something to first prompt sent to LTX, the faster we can actually react, the more compelling the experience."
- "The GPU connection is a resource we shouldn't be afraid to generate against. But we can only witness one second per second. If we're running at 2x real time, we don't want to be 10 minutes out in the future because if a user says 'everything's now Lego' we could throw away all that time."

---

## Persistence & Pacing

- "Future should not just be something that's in memory. It can be persisted and re-instantiated from. It's the true representation in both LLM space and a serialized object. It represents the persisted version of the future that if we woke up in the present and knew that was the future, we could create all the runtime objects from and resume execution."
- "Part of the agent's job is making sure we're keeping up. If elapsed is five minutes and the future elapsed ready to be added is five minutes and 15 seconds, that means you have 15 seconds of content ready. If we get to the end and there isn't content ready, you're behind."

---

## MSE / Player

- "I want a comprehensive, imagine if there is no code there, redesign of the system to make it so that the stream and the MSE are in sync with the player and do that as cleanly as possible. I don't trust a single line of code you see."
- "The MSE and the video element are basically a render. They're a target for the source of truth to be projected upon, not driven from."
- "We need to keep logic to evict stuff that's outside of our windows so we're not blowing up our memory over time."
- "The live edge detection needs to work with some grace period."

---

## LLM / Agent Behavior

- "Go figure out places in the system that the LLM could choose to refuse user requests and make sure it has absolutely no right to do so. The only exception is in multi-user chat scenarios, but if it's a single user who owns the stream, it must follow. It is never allowed to refuse."
- "GPT-5 extremely hedges against using real names, real people, real companies. It made 'working at Google' into some fictitious open tech campus. That's bullshit. I want you to come up with a plan to beat that behavior out of the model wherever we can through prompting."
- "Go find anywhere in the chain of prompts that could inject glitchy artifacts or visual noise and explicitly guard against that unless it's absolutely necessary for the content or was explicitly requested."
- The agent should "always be trying to figure out the fastest way to respond" to user requests. "The fastest thing it can do is set the guidance immediately, then start working on a new script."
- "The agent needs to be setting its guidance more often, so it can weave through the timeline more information about what it's trying to do above the script level."
- "Our general bias should always be towards actions that immediately affect generations so it feels extremely responsive."

---

## LTX-2 Prompting

- "I want a templatized prompt we can use to save token cost. This is figuring out how to turn our existing prompt stack into something where I could reference a style, reference camera motion, etc."
- "Spine + body" architecture: session-level style spine (medium, color science, lens, stabilization, motion blur) appended to every clip in code; per-clip unique body written by LLM.
- "I have nowhere near enough detail in these prompts about what characters look like. It's way too eager to imply continuity and simply does not understand that LTX2 has no memory between shots."
- "Make sure action goes first then character description after." Single flowing paragraph, present tense, 40-60 words.
- "It's not repeating the dialogue in the action phrase. It's just being so lazy about these prompts." Exact quoted dialogue MUST appear.
- "Don't repeat yourself like that over many times in the prompt. It specifically says in the guidelines not to do that. Just super emphasize it where it's necessary."
- "Switch the model to GPT 5.2" (for prompt expansion).
- "The quality of the sequence plans we're getting are really poor. We need to give it much better first principles guidance on how to write pacing, continue from existing sequences, and extend them."

---

## Style System

- Style domain: has ID, label (@label), text (the visual spine content), optional title and description.
- "Ships with built-in presets: photorealistic, anime, claymation, watercolor, lego, muppets, old-timey cartoon, noir."
- "Always defaults to photorealistic preset when no style has been explicitly set -- eliminates all LLM spine derivation."
- Both `Style.preset()` (returns default) and `Style.presets()` (returns full list).
- "Timeline entry should contain the style itself (label + text), not just a reference."
- "Style auto-appends to every clip prompt (replaces the old GPT-derived spine)."
- "Agent gets a styleSet tool to define and activate styles."
- "The current presets kind of suck and we still need to be able to define our own. Also being able to delete and manage styles so they don't always keep showing up."

---

## UI: Sidebar & Chat

- "Chat is basically the public facing place where people who are just watching the stream don't have access to the internal details. Stream is really supposed to be all of the tools a stream user would need to run it successfully."
- "In chat mode it should seem like a conversation space and when you're operating it should feel like you have all the information you need to understand what the agent's doing and give it good directions."
- "I don't want viewer count in the stream tab. That should be like an audience somewhere."
- "I really just want stream state and the ability to control the stream state."
- "I should be able to send a message to the agent even if I'm not connected to a stream."
- "It's really unclear that you can't send messages when the stream hasn't started. The layout of the composer area with regards to the state of the stream and the start/stop controls is just extremely lazy and poorly thought out."
- "The tab switcher should work well in mobile too, so I think it needs to become something that would display well as the bottom bar."
- "In the sidebar, the left sidebar, I want to remove the pulsing dot for live and have it more similar to how Twitch does it showing the viewer count. If it's zero, just don't show it."
- Split TV.Chat into: TV.Chat (shared primitives), TV.Audience.Chat (public), TV.Agent.Chat (private owner-to-agent conversation).
- "The sidebar should have some sort of split. Maybe we even call it community and agent."
- "The dual audience -- either you're able to operate the stream or you're not. The audience sees whatever the audience sees. The owner is the one that sees everything."
- "If there is no chat enabled, we should probably just not even show that tab."
- "Definitely keep it simple. The owner is the one that sees everything."
- YAML options should have agent and audience sections, each with chat YAML options containing messages -- "make sure that's recursively modeled with the nice fractal."
- No full mirror of messages between agent and audience chat -- "It just picks which one makes most sense."
- The agent "needs to be able to control both the audience chat and agent chat and make sure it's explicit like that."
- External tool calls should surface "as much information as possible" in agent chat action cards.
- "I would prefer to unify the store if possible. Ideally they'd be either identical or as near identical as possible." (Audience + Agent chat stores)
- External agents must explicitly call audience chat read -- no automatic audience messages in stream_status.
- "I want as much indication of status and information of what's happening in the agent as possible." (Typing indicators, tool call logging, etc.)
- Use AI SDK primitive types as much as possible: "We want to move towards their model of things more than we want our own custom re-implementation."
- Aim for a single unified chat message type: "If we get this right, there might only be one chat message type."
- "The agent is never moderated." (No AI moderation on agent-sent messages)
- Agent and audience chat events should remain separate: "I think they need to be different events."
- "I want you to go compare the spacing we use for both chat, the font sizes, the opacities, the overall sidebar layout, the negative space, and make them uniform between the left sidebar, the chat, and the stream tab."
- "I want the entire left sidebar to be hidden in a dot preview and all of the stream controls or the session controls to be hidden in a dot preview."
- Chat messages: "I want the text and the button to have the same padding away from the edge of the glass" with radius mapping so inner corners look clean.
- User-sent messages should be in Theme.Glass and right-aligned. "I want all buttons or all chat to be in a theme glass."
- Twitch-style inline message rendering (not bubbles) for agent chat.

---

## UI: Stream Controls & Composer

- "The button needs to say start stream and stop stream."
- "Go use theme glass for the composer and get rid of the hard lines. I want it to be bigger. I want the start stream to be a primary button. When it's running, it's still primary but with a live dot."
- "I want the start or start stream to be a primary button. And I just want it to be play with stream. And then when it's running, it's still primary but with a live dot that says 'in stream' or 'stop stream.' And I want that to be a full theme button."
- "The composer should hover cleanly over the background. When we haven't started a stream yet, animate that."
- "Find out what happened to the send and shuffle button in the composer. Also, I don't want to say 'direct the stream.' Have it say 'what do you want to see next' if you're in stream, and if you're in chat say 'what do you want to say' as the placeholders."
- "I want to remove the stream status from the composer. It jumps around too much when the status is changing and that shifts the whole layout."
- "Think about all the atomic units of control and information for a stream operator: state of things, actions they could take, info like sometimes requesting a GPU can take a few minutes."
- "When they're connected to a GPU they're spending money. That is important to communicate and allow them to stop/enable etc."
- "Why is the watch live button for the actual channel page sucks? It should be like a stream button with a play icon, not like a live pulse if it's not actually live. If it is live, it should be like a resume with a pulsing red."
- "When a stream is running, I can only see watch stream. I can't see start new when I'm on a channel page."
- "When I have new stream/resume/edit in the channel page as the button options, if I have a live stream going, the edit option disappears. Audit the state of all the buttons."

---

## UI: Agent Selector & Operator Controls

- "I think we need a really nice dropdown or selector. Don't be afraid to bring in either Radix or Shadcn."
- "If they've connected their agent before, this should be very seamless and simple."
- "I'd rather not have it collapsed. Ideally it would be something that is small and always visible."
- "Some status indicator for the agent in the select, like whether or not it's active or we're hearing from it."
- "Clear session could live at the bottom of the agent chat in its own area of controls, like just for quick actions or controls, and maybe even that's where style lives and that could be collapsible."
- "Whirlpools should be just above the video."
- Agent selector should sit above the composer always, regardless of context.

---

## UI: Channel Page

- "When there's no cover, there's no reason to push all the content down. Just push it up and don't try to render something."
- "I want the cover to blend nicely into the body. So it's opaque near the top and blends nicely down into the body."
- "In all locations where we're showing the channel image, I want to use a square cover."
- "I don't like this weird outline around it that we're currently using."
- "Want to be able to edit the title and description inline."
- "The prompt should have its own dedicated section that explains what it is. Eventually that's going to be markdown."
- "For channel visibility, I want a brief blurb about what each of those settings means."
- "Instead of generate art just call generate."
- "I don't like these big panels with outline rings. We don't do that anywhere else. We have soft glassy effects everywhere."
- "Cancel in the top right but the save is all the way at the bottom makes no sense."
- "Page should not own cover, cover owns cover. Page should not own prompt, prompt owns prompt. Page should not own sessions, sessions own sessions." (Domain composition principle)
- "I want you to redo the state flow with a Zustand store instead of using a bunch of React state and passing down and prop drilling."
- "Instead of a gradient with a hard edge for the bottom, I want a much smoother, taller gradient that fades naturally into the image. The image just gets blurrier and darker near the bottom, not such a hard line."
- "Instead of generate identity, call it generate branding." (The previous name was "cringe")
- Sidebar cover should "expand from the bottom left with a nice feather" -- "a gradient emanating from bottom left to top right that expands a little bit beyond the preview itself." Less blurred, a little brighter.
- "I want the padding to be based off container queries."

---

## UI: Pages & Navigation

- "I want a sessions page and a channels page. I want it so that we use the previews there to show a nice grid of the collection basically."
- "Equalize the hop height between the first message in the chat and your channels. We need to equalize that between the sidebar."
- "I want to make the channel page look like the screenshot where everything is left aligned instead of center aligned and I still want there to be a max width where the whole page gets centered."
- "I want the setup page to work more like the TV page where it still has the TV background and the sidebar visible."
- "I want to make preview mode available for testers. I don't want to give them developer permissions."

---

## HUD (Heads-Up Display)

- New top-level TV.HUD domain: an LLM agent dynamically creates UI overlays (buttons, sliders, dials, selectors) on the video player.
- HUD agent should be independent (like Chat.Agent) with its own LLM loop, Scheduler, and wake/sleep.
- Widget primitives should be direct children of HUD: HUD.Button, HUD.Slider, HUD.Dial, HUD.Selector (not nested under Widget/).
- HUD.Layout should be a direct descendant of HUD with "overlay" and "panel" placement options (user chose "Both" when asked).
- The HUD type should represent the actual rendered state (layouts array).
- Updates should be partial, CRUD-like API (widgetSet, widgetRemove, layoutSet, layoutClear) -- not full reset.
- Smaller namespaces should be inlined in the HUD index file.
- Extract Chat.Command into TV.Command so both Chat and HUD agents can send directives to TV.Agent.
- Fully YAML-ified with timeline entries readable forward in time.
- Interactions fed back to both the HUD agent and the main TV.Agent via timeline entries.
- "Under no circumstances can you do dynamic imports like this." (On `await import("~/Server")` -- use static `Server.Effect.Protected.execute` pattern.)

---

## Content Ideas

- "I want a new stream where it's all the latest news of the day but with onion news network flavored parody."
- "I want to use the Dazzle product to create a compelling onboarding stream as if this was for a new physician." (Medical use case demo)

---

## MCP & Agent Platform

- "I want to create a MCP surface area that any agent can control. TV.Agent should be the built-in agent implementation, nothing more."
- "Connected to MCP, first-party agent client. No special tools beyond what MCP provides."
- "Hard line between MCP (all agents) and Razzle-specific tools."
- "The break between chat agent and main agent is kind of gone." Razzle is ONE agent loop (content + chat unified).
- "Agents need to be able to sign up, create accounts, provision a stream. They need to be able to do that all first class as part of the protocol."
- Session/Stream/Channel are three distinct primitives: "A session represents the conceptual, persisted and stateful memory for a thing. Inside that there's streams or connections, the things that actually cause billing and allow you to generate. And around that there could be a channel context or not."
- "Separate create and connect. Create a session, set up guidance/style/tasks, THEN connect when ready (avoiding billing during setup)."
- Start/stop should be modeled as "connect/disconnect": "Connect = claim a GPU and start the generation pipeline. Disconnect = release the GPU and tear down the Runtime."
- "There is no middle state. You're either connected or not. People should be charged when they're using a GPU."
- "An agent should be allowed to just hold the GPU as long as it has credits. We can spin up more GPUs as long as they're paying for it."
- "Platform-wide agent scope with active session tracking, so we don't have to keep passing sessionID on every tool call."
- "I think there should be tools for managing billing."
- "I definitely think we want ambient push and on-demand pulls. Hopefully they can share most of the same implementations."
- MCP endpoint should be at `/tv/mcp`.
- "The razzle tools stuff should live inside razzle and do the translation from there."
- "All of the business logic for starting up razzle should be in the razzle.Effect. Start should just thinly call it like everything else."
- "There should be a razzle field on TV runtime. An optional razzle field for when it's running."
- The prompt cache key "needs to be per instance of a chat thread. Otherwise it just gets clobbered constantly. It's about the entire conversation chain, not just the system prompt."
- "External agents can manage chat -- it's one of the key features of the platform that makes it interesting."
- Chat commands concept is gone: "The agent is ultimately just deciding what to do unilaterally. If it sees chats that make it want to do something, it does that."
- "We need to start planning for the reality in which there are streams not connected to channels."
- "The system prompt for Razzle should be basically a version available to other MCPs. We should try to abstract that getting-started behavior into something other agents can use."
- "I want the MCP to be the foundation of an extremely clean, well-designed, easy-to-extend implementation we can use, both external use and internal use by Razzle."
- "Looking for things I wouldn't even know to ask" -- proactive improvements and suggestions on MCP design.
- "Make sure the Razzle agent is as powerful as possible and our surface area for the external users is optimized against all of the MCP first principles and design rules that we researched."
- Razzle parity principle: "Razzle runs through the same MCP interface as external agents -- feel the same pains."
- Token efficiency: "10 tools = sweet spot, 20 = degradation starts; plain text saves ~80% over JSON."
- Implicit takeover: first operate-level MCP call from external agent stops Razzle automatically.
- Error philosophy: WHAT/WHY/DO/CONTEXT format -- "Every error is a breadcrumb back to the happy path."
- "No such thing as a session without an agent." / "No manual mode." (Every session has an agent, even if not Razzle.)
- "Homepage should go to sandbox stream." (Not currently built, clear direction.)

---

## Featured Channels & Production

- Introduce a "Featured" section in the sidebar with curated channels.
- Sidebar order: "Live, Featured, Yours."
- "The live channel is going to be called Sandbox. That's the public channel that we're basically always running in production."
- "Only Dazzle or developers can run the subset of non-Sandbox channels. Show all featured channels to non-devs, gate interaction."
- Create a Channel.Featured.Setup domain that syncs preset channel definitions to the database on every server start: "Creates new, updates changed via prompt hash comparison, deletes removed, triggers AI generation."
- "I want instead of it to be sync, just call it setup."
- "Setting the status manually should be handled by generation. That's something the generation domain should control."
- "The sandbox always triggered -- let's do that only in production as well."
- Sort featured channels by: "last played then last updated."

---

## Broadcast / Rendering to External Platforms

- "I want you to focus on writing a comprehensive overview of the strategies for rendering out a chromium instance as a live video stream. We have a lot of things to consider. Remotion is something we need to research. We're creating a harness that allows very quick tool calls that get interpreted as web content that we are then streaming and broadcasting to places like Twitch."
- "Comprehensive evaluation of all possible techniques: remotion, streaming directly from chromium with live DOM manipulation."

---

## Architecture Principles & Code Style

- "Redesign, don't patch. New code should read as if the change had been a foundational assumption from the start. But stay in scope: only touch code directly related to what was asked for. Don't make drive-by changes to unrelated logic."
- "Plans are contracts. Every plan must sharpen fuzzy requirements into concrete success criteria before proposing an approach."
- "Prove compliance. The plan must explicitly demonstrate that it follows this document."
- "I'm trying to remove as much state from the Stream type as we possibly can that can't be represented in a sub domain or a better Effect primitive."
- "Stop using .default in Zustand. Just use it. Just do .optional and make sure the .empty pattern is being respected."
- "Make sure the channel YAML options are completely subdivided accurately and composed in the fractal pattern used everywhere else."
- "Don't do anything for backward compatibility, assuming you have full control." (When redesigning)
- "I want you to self-simulate a bunch of scenarios. Look back at all the scenarios I've described and self-simulate how they would operate if your plan was true."
- "I think you're abusing some odd behavior there passing around scopes using a wild loop. Go look up better Effect primitives."
- "The stream shouldn't know anything about killing the connection like that. We should try to contain as much of that in the connection domain as we possibly can."
- "This razzle tools stuff -- TV.MCP is not the owner of the concept. There's another concept we're missing. You need to actually identify a noun for it and create a domain around it."
- "Using a light touch, I want the CLAUDE.md to not say always redesign. It should encourage thinking that way but balance it. It keeps just doing unrelated changes -- I'll ask for one effect and it'll remove the other and completely replace it. It's over eager to destroy what exists."
- "Production ready means we can actually go live with this. Like all the UX flows are good. It's stable. It's working well. It's clean. It's easy to extend."
- "I want you to go look up from both Effect first principles and gRPC streaming first principles how to re-establish the connection domain and compare it with history to get something that's going to work. The stream from async iterable approach is just not correct."
- "I want you to go figure out how to analyze all of my Claude conversations so far that have been in the Dazzle codebase and use embeddings and something like k-means to understand what groups of things do I keep coming back to, complaining about, trying to enforce, so we can extract either MCP rules, Claude updates to the agents, and just to better correct the tooling around LLM usage so that I have to say stuff less often."
- "I want you to go research how I order keys in objects and have spacings between them for clarity and readability. Distill the principles and update the CLAUDE.md to reflect that."
- "I want you to use Zustand state instead of a bunch of React hooks to make this as clean as possible." (MSE/Player simplification)
- "I don't want there to be a background that's over the page content at all. I just want to knock down the opacity and blur a little more strongly." (Glass effects)
- "I want you to literally use the Glass component, figure it out." (Enforcing use of existing theme primitives)

---

## Auto-Claude / Autonomous Agent Loop

- "I want to build an auto-claude system -- a continuous loop that runs Claude autonomously, emulating my development behavior and goals."
- "I'm five conversations wide with Claude using voice input and want to expand code output by having a harness that can basically just let run in a loop that very accurately emulates my behavior and goals."
- "The most important data source is actual Claude conversations stored as JSONL files in the .claude directory."
- All work should live in `docs/auto-claude/`.

---

## Multi-Agent Workflow

- Developed a repeatable pattern for running parallel specialized agents on large initiatives.
- "Compress aggressively. Agents reading 28 files of planning docs is wasteful. 5 compressed files with the same knowledge is better."
- "Questions before execution. Every agent should ask clarifying questions before charging into work. This is cheap. Undoing wrong work is expensive."
- "Name workstreams by concern, not by domain." (e.g., "Chat Unification" not "TV.Chat refactor")
- "Dependencies are one-way signals, not blockers. Workstreams should proceed independently and surface findings."
- Standards enforcement workstream: "purely enforcement of Claude guidelines, standards, following current based patterns. Anything that could cost me time later trying to communicate that we can do while it's in flight."
- The standards agent should be reframed: "your main job is to give me prompts addressed to other agents I can choose to send when and if I choose."
