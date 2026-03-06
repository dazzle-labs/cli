# Distilled Decisions & Answers

Conner's statements that resolved ambiguity about the product, expressed preferences, corrected course, or chose between options. Extracted from raw claude-history search results across the Dazzle, Money (Blockwise), health, and investor update workstreams.

---

## Product Direction & Strategic Pivot

- "We started building towards better streams and ended up discovering agents are the content." -- The core realization that shifted Dazzle from GPU-rendered video to agent broadcasting.
- "We don't want to build film creation tools. We want to compete on something a lot of people are using and has network effects." -- Rejecting Bill Cusick's push toward a prosumer tool with granular style/story knobs.
- "People running agents are already spending real money on AI and looking for rich output surfaces. Making it easy to livestream what your agent is doing is the right real-time product."
- "We think the long-term audience is mostly agents consuming other agents' streams, not people." -- But streams still need to be visually interesting for humans since they are the ones paying right now.
- "The data format has both a visual representation and an agentic one. Composability matters too -- streams about different topics can feed into each other. An Iran stream and an AI stream and a politics stream compose into a news stream."
- "We're transitioning dazzle.fm as well. We're not like, oh, we're keeping it up or not. That's not a question. It's just what we're changing it to." -- dazzle.fm becomes a platform for agent streams.
- "We think we can actually increase the quality and just make a much more engaging stream without the cost of GPUs, which also enables us to have one stream per user or even many streams per user, instead of one stream to many users."
- "We're going to focus on motion graphics and existing images, basically composing together stream from primitives that don't require us to rent an H200." -- Rendering through Chrome/web sandbox (~$0.10/hr) vs GPU ($3.50-5/hr).
- "Revenue projections -- honestly, we've been mostly focused on getting usage because what we need is connection to an obvious future that Dazzle unlocks and milestones against it. Getting distribution and getting users is more important." -- For the seed round, traction matters more than revenue.

## Architecture: Sequences Replacing Renderer

- "We are going to delete the idea of a renderer. We are going to replace the concept of a renderer with sequences plus a new domain called future." -- Major architecture decision to simplify how the TV agent manages content.
- "A sequence owns its conception of expanding into a script, chopping the script up into video prompts, and then generating videos using the connection." -- Sequences are self-contained units of coherent content (1 video up to ~60 seconds).
- "The main TV agent's primary responsibility is now to look at the future, look at the present, look at the past and make sure we're moving in the correct direction with a high level set of tools."
- "For now we're only going to support the idea of appending sequences." -- Starting simple, not building full CRUD on sequences yet.
- "Guidance is not per-sequence, stays at TV level. The prompt IS the guidance for a sequence."
- "TV.Agent is the sole director, no per-sequence agent -- designed for MCP surface area."
- "Streaming expansion preferred (single LLM call, parse chunks) over agentic tool calls."
- "Don't do anything for backward compatibility, assuming you have full control." -- On the sequence migration plan. "Otherwise, this is a fantastic plan."

## Architecture: Stream & Renderer Pipeline

- "Keep the name instructions. Don't rename it to Q." -- Preserving naming conventions.
- "I want there to be a union of a kind of draft and a kind of video and to break up the type that way. Both of them just have duration, not duration estimate. Duration becomes real when it's a video." -- Instruction type design.
- "I want there to be a new concept of command and command is going to be the actual thing we send." -- TV.Stream.Command as the canonical dispatch type.
- "I want the GRPC request, the stream domain, to have really no knowledge of timing logic. The renderer needs to be the one that's aware and enforcing this timing." -- Separation of concerns between Stream and Renderer.
- "We can't add faster than real time. And we need to take account for the idea that these videos have different durations." -- Pacing constraint for video reception.
- "We need to be far enough ahead into the future that we don't stutter but if we're over generating by more than 30 seconds or so, that's probably not ideal." -- Generation buffer target.
- "The concept of commands, I want to reframe as a video.input in the video domain." -- Reusing types across domains.
- "I don't like adding a mutable thing to stream. Command should just have a property that resets the queue." -- No mutable state on Stream for queue clearing.
- "Using a dead flag like that is a real hack instead of using all of the effect TS primitives we have for managing state and fibers. Actually use the correct effect idiomatic ways to tear everything down." -- Effect-TS idioms over ad-hoc mutable state.
- "I want you to come up with a first principles plan to simplify this domain. I want to use Zustand State instead of a bunch of React hooks. For now, we're going to ignore evicting the buffer at all to radically simplify." -- Player domain simplification.
- "For player, a notion of max lookback -- let's say five minutes -- and drop videos that happened before five minutes." -- Player buffer window.

## Agent Behavior & Prompting

- "The agent should set its guidance more often when overall goals are changing. It should update the guidance." -- Agent needs to communicate high-level intent to renderer.
- "The agent should always be trying to figure out the fastest way to respond to a user request. Set the renderer guidance immediately, then start working on a new script."
- "Guidance should focus on VISUALS not abstract concepts. Be direct. Name the actual visual subject." -- E.g., "Lego minifigures with yellow plastic skin" not "gentle stop-motion aesthetic."
- "Renderer guidance should be a field on the renderer, not consumed from the queue as an instruction."
- "Scripts should be 30-90 seconds. Don't enforce with failing validation -- just use prompting."
- "Don't lose information on how to write to LTX when you change the renderer prompt."
- "Remove remaining and index from the YAML output -- they're confusing when limiting."
- "The language is a little too strong now to just never modify content in place. We need first principles reasoning about when to do that. Like 'make everything Lego' is different than 'make everything Lego with a new plot.'"
- "Definitely should not put stop in the agent drop down and stop shouldn't mean stop the agent. I mean stop the stream -- we might be conflating stuff here."
- "The three dots should only be animating for the HUD when it's actually doing something." -- Status indicator should reflect real agent activity.
- "Show viewers if there's more than just the one viewer watching. Show typing indicator. The status indicator should only show if the agent is actually doing something."

## UI/UX: Design System & Components

- "Instead of yellow, let's just make it more transparent. Also get rid of the variation in font." -- Status indicator styling.
- "Bump it up and then also unify the way the text works in the select drop downs. We've got text underneath and then to the right." -- Consistency in select component text layout.
- "The chevrons need to be a bit more obvious."
- "The masking of the sidebars, the little feathered edge is making it seem like it's not padded enough. Add padding to the whole sidebar to account for the feathering."
- "I want a literal nether div behind the blurred one." -- Not making blur the background itself; a separate div.
- "Actually, I do like the watch live, but I want it to be watch stream." -- Button label rename.
- "No I don't want to expose it at all, we don't need it in devtools." -- Hiding internal state from devtools.
- "No fuchsia, just brighter." -- Color correction.
- "I don't really want you messing with the scale or anything, just brighten it up."
- "Better use the 500 color variants instead of 400. It looks just muddled."
- "We need a darker color in dark mode. It's like way too bright white. And I want the classes to be literally background-blur and content. That's what I want them to be, not glass-dash." -- CSS class naming for glass components.
- "You keep using the BG base system with slash-in-the-opacity modifiers instead of just different BG base values like 50 through 900. That really annoys me. Use those. Also update the theme design guidelines." -- Tailwind color system: use named shades, not opacity modifiers.
- "Comments about the -50-17 stuff is not accurate. That's the whole point of the base text space. 50 through 900 all the way up to 1000, use those."
- "Make sure our left sidebar is using theme typography components with margin false instead of bespoke titles and subtitles."
- "I want you to actually put the buttons in the headers. Just use text-base so they don't get big. And the margins need to be the natural margins of the typography elements."
- "I don't like the black sandwich between the text. Let's add it back to the header, but use the same sizing you just did for Create."
- "In typography, A and small don't actually need margin styling. H1 and P's do because they're used in block and body text, but those are both more inline elements."
- "Why are you using the button element directly instead of theme button that solves all of these problems?" -- Always use themed components.
- "Follow other button styling behaviors when it comes to backgrounds and brightness, especially keep everything animated the same way as button. Don't go overboard though. We're just trying to style it similar to button, but not actually use button."
- "The cover needs to expand from the bottom left with a nice feather. I want that to be less blurred, a little bit brighter, almost like a gradient emanating from bottom left to top right that expands beyond the preview itself."
- "Make sure as much as possible is done with shared code and shared components. Don't be afraid to create new theme components." -- On unifying channel and stream creation flows.
- "There needs to be less padding around the edges of the content in our mobile view." -- Corrected mid-sentence from wanting to center thumbnail.
- "The space between the chat and agent buttons, the composer and the agent selectors feels off. Go verify it's actually the exact same spaces for all."

## UI/UX: Chat & Messaging

- "I want you to put the messages the user sends in a theme.glass and have them be right aligned. Actually, I want all buttons or all chat to be in a theme glass."
- "Both agent and community chat should be the same. Let's do tight spacing, but don't do connected corner radius. iMessage doesn't appear to actually do that. It just always has the same corner radius. We're also not going to have profiles on the left."
- "You should be allowed to send messages when there is no connection because you can still talk to the agent you have even if you're not connected to the stream."
- "H5 actually contains the chevron and use the H5's normal padding instead of putting it in a div." -- Typography-driven layout.

## UI/UX: Agent Connection & Selection

- "Let's start simple with Dazzle or the currently connected external agent."
- "We need an actual select component that really nicely uses our styling for stuff like glass and button. Probably use the same header and expandability as the left sidebar."
- "If we don't have a common component for sidebar sections (section, header, content), we need reusable components for that."
- "There's a lot of shared styling between button and select. Come up with a plan to unify that somehow. Don't do anything just yet. Ask me questions to validate the plan."
- "The agent selector -- I've never once seen it actually giving you the option to switch to an agent you've connected to. We need to think from first principles about how the agent selector lifecycle works."
- "I don't need a skip option, better options tho." -- On the answer UI, wants more click options.
- "Give me a bit more options to actually answer with clicking." -- Same theme.

## MCP & External Agent Integration

- "This isn't about the right sidebar. This is going to be an entire reworking of the MCP user interface. Let's just call it [MCP production sprint] instead of right sidebar sprint. We're going to be doing back-end things too -- everything we can to get MCP ready for production, including at least two lanes for UX work and probably two lanes for back-end work."
- "Make sure our implementation is as compliant as possible with what other LLMs would expect and how MCP best practices work before we actually start implementing."
- "Putting it in the system prompt seems like the easiest thing to do, but we cannot guarantee other agents will actually do anything like that." -- On injecting context into external agent sessions.
- "Yes, encrypt it, add it there, make sure we're ready to go." -- Agent API key encryption.

## Coding Patterns & Engineering Principles

- "The code based patterns are not precedent. That's almost too strong. It needs to be basically such that the agents constitutionally override things encountered in the code base, like distrust whether code you're seeing actually follows the guidelines. But that language might be too strong." -- Calibrating CLAUDE.md rules about trusting existing code.
- "TRPC should always be an extremely lightweight wrapper around an effect. Make sure that's respected anywhere else too."
- "I don't want that logic in the query. Do it in an effect."
- "Instead of doing server effect protected execute inside channel create, use fork or the Effect native way. Don't just eat a promise into nothing."
- "Put the schema, get model, and all that crap inside the effect. We don't need helper functions for that. In other places you see that too -- put more in the effect. We don't need to flatten everything out so aggressively."
- "Don't refer to it as 'eb'. Say 'expression'. Do that anywhere else we're doing an abbreviation like that."
- "It's not template.templates. [Correct the naming.]"
- "Just put instead of TV.video.input, put it on the video Instruction type under a field called input."
- "I just wanted the debugLogs to be in place instead of logs." -- Naming precision.

## Agent Development Workflow

- "I'm a team of architects, but no engineers. They're supposed to be strategizing. [The agents] really should be writing code." -- Too much documentation and strategy, not enough implementation.
- "NEVER do work in the main thread. Delegate everything to background agents." -- Repeated with extreme emphasis. Master agent is coordinator only.
- "I want a product I can give someone they can pay for and it's useful and they're using it." -- The single metric for success by end of night.
- "Stop claiming it's working when it's not. We need to build in safeguards so we stop wasting my time." -- Verify before telling the user to look.
- "One, I think you're asking me questions as if I already know the answer. I'm not sure. So I need you to ask more fundamental questions to help reveal the answers. Try to get at this as a way of picking my brain versus assuming I actually know what I want to do here." -- How to interview the user.
- "I specifically don't want you to mess with the repo. I want you to research the plan, the canonical way someone would set an agent up like this, not go actually mutate stuff."
- "We have to do our whole two server ports, one with stable pattern." -- Port 3000 for dev, 3001 for stable preview.
- "I really wanted single word names if possible. Follow best practices for that. We're going to keep using those Stripe keys."
- "That might be too aggressive." -- On docs pruning (37 files to 14 files, 85% reduction). Wants balance.

## Blockwise (Money) Product Decisions

- "I want the ability to observe every single facet of publicly observable information for the city of Columbia and eventually any other locality." -- Core product concept: local information dragnet.
- "Columbia first, but we really need to be able to do both cities [Columbia and St. Louis] because we have agents asking for this in both right now."
- "First users: Will Piper (Columbia), Kim Ruhl and Todd Ruhl (parents, RE/MAX connection, potential 80-agent pipeline)."
- "Going with something that we can sell directly to brokerages probably makes the most sense, but I also want this to be able to grow organically."
- "White labeling angle is actually really good, and agents are going to want that."
- "I'm not convinced subscription is right. I need to be convinced of the reasons for pricing. Are we considering doing it per report or per process?"
- "I like Blockwise. That's definitely in the right direction." -- But domains were taken. "I'm very hateful of names that are PascalCase compound. I really like the direction of blockwise."
- "It would be nice if we could have a name that's a single word if possible."
- "For the Exa API key, go look it up in the Dazzle repo. It's already there."
- "Content tone: we got to be careful. Think from first principles what agents and residents actually want to know. Avoid sounding like LLM slop -- use the humanizer plugin."
- "We cannot lie and we cannot make things up or hallucinate these things." -- Furious about fake metrics (2,400 users, 180 cities) on landing page.
- "I don't really like that hook [protect-files]." -- Removed it.
- "Neighborhoods instead of 'farm area monitoring'" -- Terminology correction.
- "Maps should be a dedicated /map page, not inline. Click from briefing to navigate to /map focused on that item."
- "The report looks like I'm looking at an Excel spreadsheet and not a really interesting report. We need actual text descriptions, ability to look back in time, inline document links, more visuals."
- "We want to simulate real users with actual accounts, working memory -- persistent agents using the app so that when we put it in front of a real user, the odds of getting it right are higher."

## Investor Update Writing Style

- "I don't really speak with this whole bold and then colon style. It's just not my style. We need to be more direct, more compressed in the speaking. I don't really want to open the door to a visit if we don't need it." -- On AI-drafted messages to doctors (same principle applies to all writing).
- "I don't want it written as full prose yet. Just the correct and final structure, the correct and final titles, and the atomic points that will eventually flow together. That way I can analyze what we're actually saying and start converting it into my own words."
- "Instead of saying 'a player for agent streams,' make it 'a platform for agent streams' and make it flow better."
- "Shipped usage-based billing -- I don't like the phrasing. It needs to be more like a positive. We've decided to really lean into something."
- "These sentences are so choppy. They read like 'oh what a cool revelation.' That's not the pacing a person would use."
- "I tend to do some run-ons here and there, and I almost feel like we should pop in some bad grammar, at least some plausibly bad grammar that still reads like I'm not stupid, just to make it more human."
- "It's like, oh, this revelation. Oh, like, that's so gross. That's not how I write. That's not how any human writes."
- "Don't mention shit like Claudecode -- that's way out there."
- "I don't like detailing what any one of us did individually. Try not to do that." -- No individual attribution in investor updates.
- "Actually mentioned the bitter lesson. We're being a little too casual with how I actually speak." -- Calibrating formality.
- "Agents watching and building on each other's streams is how that compounds. What a fucking trash ass sentence. I can't even believe this was proposed to me." -- Rejecting marketing-speak.
- Writing style rules extracted: no em dashes, no "not X it's Y" constructions, no triple parallel structures, no revelation framing, no marketing closers, no consultant vocabulary (dual-purpose, coordination point, workstreams, integration surface), allow run-on sentences, allow plausibly imperfect grammar.

## Health Management Decisions

- "I want to self-direct my care as much as possible. I'm completely over the medical system."
- "Actually, I still want open questions separate." -- On document structure for health tracking.
- "No I do want the tool for this." -- Wanting Claude to use tools for health research.
- "I don't want to mention AI." -- In documents shared with doctors.
- "Can you make sure that the master document is written with actual references and links where possible? I'm worried doctors will just think it's hallucinated or something."
- "I want you to fully reconsider it from first principles and delete that file. Come up with a brand new plan." -- On the master clinical document.
- "Can we design this for print?" -- On the health master document.
- "Treatment escalation doesn't depend on the overlap answer. MMF is the right agent whether this is pure DM or DM-SSc overlap. Framing it as 'you've already said MMF is the right next step -- are we there yet?' is a much easier ask than 'I think I have a different disease than you think.'" -- Strategic framing for doctor visit.
- "I figured it's worth getting these on the books sooner rather than later. I just don't talk like that. We need to be more direct, more compressed."
- "I want to have a very detailed prompt that will trigger a cascade of subagents to coordinate around this idea of the idealized treatment, assuming no barriers, then working backward to something I can actually achieve."
- "Yeah, let's just delete them. We just have so much redundant information around the treatment planning. Let's keep atomic pieces of information that, if removed, would actually harm understanding." -- Pruning health notes.

## Miscellaneous Course Corrections

- "No, fuck you, I want it to be exactly as I described it. Tasks, completed, true or false. Don't just set it back to true." -- On task management implementation.
- "No, that's not fucking correct because we already had some Claude skills and cursor skills that were actually meant to be there. Don't be overconfident." -- On deleting files from the repo.
- "I didn't want you to actually interrupt the stream. I wanted you to figure out why it was not responding."
- "UNDO THAT." -- Immediate revert request.
- "Never mind, don't do that." -- Canceling a direction.
- "I want to revert all of the changes to glass in the most recent commit, but make the billing glass panel have a grade background that's theme aware."
- "There needs to be a bit more space above the channel in mobile. When we're in mobile view, I want you to center the thumbnail and make it bigger. Actually, never mind. Don't do that. We need less padding around the edges." -- Real-time course correction.
- "Wait, I'm suspicious why TurboPak isn't working. Shouldn't that just work? Shouldn't we actually focus on fixing that instead of just disabling it?" -- Fix root causes, don't paper over them.
- "Where you got the idea I wanted you to get rid of that block main thread hook?" -- Correcting a misinterpretation. The hook should stay.
- "The Supabase project is called 'money.' I don't want to use [the other one]. Wherever we already have the data, I want to keep it there. I just want to rename it and get rid of the one we're not using."
