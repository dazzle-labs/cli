# Agent-Renderer Contract: Distilled User Statements

Extracted from `/Users/cruhl/GitHub/stream/docs/messages/agent-renderer-contract.md`. Only Conner's statements about the agent-renderer contract, how agents control rendering, the API between agents and the display layer, scene composition, and visual output format. Grouped by theme, duplicates removed.

---

## High-Level Vision: Agent-First Broadcasting

- "We're transitioning dazzle.fm into a platform for agent streams and on the implementation side we're figuring out the right contract between agents and the rendering layer, getting the renderer able to push to Twitch and YouTube, and running our own agent streams to test everything end-to-end." (03/02/2026)

- "We're simplifying dazzle.fm to more of a pure player focused on agent streams. Right now we're working on the agent contract and integration, building a renderer that can push to Twitch and YouTube and dazzle.fm, and running our own dogfood streams." (03/02/2026)

- "There are so many people running OpenClaw now I think making it just really easy to have a rich video livestream of what your agent is doing is the exact kind of realtime context that we need. Highly relevant and extremely bespoke." (03/02/2026)

- "The core idea is that what an agent is doing while it's working is fundamentally interesting in its own form of entertainment. So you can imagine... there was an agent that is going on Zillow and lowballing a bunch of boomers, homes, offers, and they're reacting all angry, and that could just be a live stream." (03/02/2026)

- "Ultimately, the idea is if I have an agent doing anything interesting, I can just point it at DAZL, and we have just the smoothest onboarding process possible to get that agent rendering its work to a cohesive interface that allows it to stream as video or as data to other elements." (03/02/2026)

- "Agents can now operate streams end-to-end through MCP, which means they can do longer-form tool-calling, perform their own web searches, fetch real-time information, and whatever else they have access to." (03/02/2026)

## The Contract / Data Model

- "The actual modeling is highly critical. Ideally, what we'd find is a dual representation where the contract for what the agent is sending to operate the stream allows us to render it and is what's visible to other agents as a comprehensible, well-formed machine readable format." (03/02/2026)

- "Imagine an agent just churning through looking up stuff going on in Iran, and it's able to use for instance like a map screen, statistics, show a video, all of these composable fragments of UI that both could be rendered as a video stream and read by other agents to provide context." (03/02/2026)

- "What we're thinking in terms of architecture is there will ultimately be a React app running in a sandbox that's driving Chrome, and then that visual output will be streamed as video to wherever it's needed, but this instance of React in Chrome will ultimately be receiving whatever this contract looks like as its driving force." (03/02/2026)

- "Definitely not interpreting an existing agent's work. This would be deliberate on composition. It's consuming the structured contract directly." (03/02/2026)

- "We need to think about how to make the content not just audio visual interesting, but make it so that other agents can observe the streams of other agents and then potentially compose those into new streams. So you know, you can imagine watching the Iran stream and then the market stream and then a few other streams and now you have something like a global news channel." (02/28/2026)

- "Ultimately, there needs to be some very LLM understandable static definition for what content is. So if we have an LLM driving our MCP, it needs to be able to understand the state of the content that's about to be played, read and write to that state, and actually enhance that as we get closer to it in elapsed time." (02/28/2026)

- "What we need is a protocol that allows us to both describe broadcast content as it already happened that allows us to write to the future and even potentially do drafting of that content." (02/28/2026)

## Renderer Architecture and Responsibilities

- "At a high level, the renderer is going to be primarily concerned with generating and emitting instructions. And so an instruction for now, there's only one and there's going to be eventually just like events and runtime entry... we're going to transform the renderer into a domain primarily concerned with the maintenance of a basically queue of instructions that are intended to be executed at certain times." (01/26/2026)

- "So right now the set script, for instance, would just overwrite all of those instructions with new instructions. The append or the add to the end of the script would add them to the end of the script, etc. And we can inject instructions that haven't happened yet at any time. So we need to centralize all state related to the creation and emission and management and operations of this instruction queue into the renderer domain." (01/26/2026)

- "We will emit from the renderer events that the GRPC domain will just subscribe to and then actually use those events to run the GRPC operations we need. Otherwise, the GRPC domain has absolutely no idea about what is happening in overall runtime and session and server state. It's simply concerned with keeping an instruction being scheduled by the renderer any time it says to do so." (01/26/2026)

- "The renderer is basically going to have to hold not only this list of instructions, but the effects that operate them in the sense of having a fiber potentially and being able to use the abort controller pattern through and through. And wherever the instruction queue changes into the future, obviously we would just re-render effectively those instructions to the new set of fibers in timings they needed to operate at." (01/26/2026)

- "I want the renderer to schedule based off its queue of what it knows is coming next, schedule and send the actual inputs to the stream that we are changing." (01/27/2026)

- "I basically want proposals for a clear breakdown of responsibilities within the renderer and external surface contract to support those cases." (01/27/2026)

## External Surface API: Simple Operations for Outside Consumers

- "The outside consumers of the renderer API we need very simple APIs that outside domains can interact with and inside the renderer we need to self manage the process of when we are generating full instructions, rewriting full instructions, rescheduling events, etc. Basically the renderer is always trying to make its timeline of instructions true and ready to execute and execute them at the right moment. All of that needs to be hidden behind well-written abstractions from the LLM and we need to make sure those abstractions are exposed correctly with tool calls." (01/28/2026)

- "I think execution can just be one big effect and not split between execute instructions effect and get next video. Just do it all in one big effect." (01/27/2026)

## Interruption, Queuing, and Real-Time Response

- "The behavior I want to enable is that the main outer loop needs to be able to dynamically set the renderer with new guidance and a new start, which basically interrupts the processing of interpretation and then immediately starts to replace the set of future instructions such that we can react very quickly to anything that's ongoing." (01/27/2026)

- "The first and most immediate way [the agent] can interact with the renderer is say we're walking through a forest and the renderer is happily generating a stack of instructions that are already expanded and we'd say okay everything should now be Lego. Well we should immediately interrupt anything basically the renderer is doing and immediately start basically dump those instructions and make sure this is true." (01/28/2026)

- "Set script needs to be both able to [interrupt and reinterpret with new guidance] and just do a hard interrupt where... it can replace the upcoming instructions if it needs to, so we need to have a pattern for that." (01/28/2026)

- "Another pattern is let's say the generator is just or the renderer is happily going along and now we're doing scenes of a Lego city and there's been no activity or interaction we'll just continue that logically forward and use append to add new drafts to the queue." (01/28/2026)

- "Basically the renderer is always looking to expand its drafts and you know let's say we want to have only a look ahead of 10 it's going to be running through its drafts in those groups to generate out unless it is stopped by one of those interruption things." (01/28/2026)

- "Anytime we have a change to the instruction list that would result in the actual timeline of future commands being updated we need to kind of do like a re-render of those effects so that they'll be executed at the right time and are all canceled properly." (01/28/2026)

- "We also need to account for the fact that we have to run a little bit ahead of real time so we should actually be sending the prompts early and let's set just a variable or an export const function constant to have a duration early we send them by that shifts the timeline." (01/28/2026)

- "I'm also very suspicious of what happens when we call things in parallel. Like we need to be gracefully handling interruptions of the renderer across its own effects stack to make sure that, like if a script was set, we're not going to continue a generation in the background. It's going to be like overwriting the instructions queue. So we need to be sensitive to that." (01/28/2026)

- "When is 'now' way too often, it should basically only be that when the script or guidance or renderer has been explicitly reset to 'do this now'." (01/31/2026)

## Guidance as a Persistent Field, Not Queue Entry

- "We also need to be careful about making sure that the guidance for the renderer is not consumed from the queue. I think we need to make that just like a field on the renderer instead of an entry in its instructions." (01/25/2026)

- "Instead of it being a renderer guidance set, I want the agent to have to change that tool to be renderer set where it can either update the guidance and it has the option, the ability to set the starting elapsed time. So we want to track that on renderer now too, but basically that tells the YAML how far back in time it's actually allowed to look at any given moment." (01/25/2026)

- "The guidance sending to the renderer just sucks right now... It's trying to do stuff that the instructions are doing, and it's like too abstract." (01/25/2026)

- "The guidance it's set is just bad like gentle stop motion macro tabletop documentary bright soft morning light like it... It's supposed to be about Legos. It didn't mention Legos at all. Needs to just be way more direct with its guidance. It can't do captions. So that's stupid. Make sure that nowhere in the script writing and in all other prompting we aren't mentioning things like captions or text." (01/25/2026)

## Agent Behavior: Speed and Tool Selection

- "The agent, the TV agent needs to be setting its guidance more often. So that way, it can sort of weave through the timeline more information about what it's trying to do above the script level." (01/25/2026)

- "We are always trying to respond as fast as possible. So if the user says like switch it to Lego or make everything spooky, the agent should always be trying to figure out the fastest way to respond to that kind of request. So in those examples, the fastest thing it can do is set the renderer guidance immediately, then start working on a new script." (01/25/2026)

- "Sometimes it makes sense to completely blow away the script. Sometimes it makes sense to do an append. It's just we need to give it some principles about when to do either of those." (01/25/2026)

- "The agent is way, way too eager to use the plot append with a script append method versus a script set and needs to be way more eager to interrupt content in response to user requests. The chat agent is trying too hard to hedge and its default sensibility should be just to as quickly as possible respond to user requests." (01/31/2026)

- "We need to violently update the system prompting in guidance around the style set tool to avoid situations where the agent comes up with styles that are just way too strong. We need to extremely enforce that we have small style guidance and it's prefixed to every video prompt and it has to be so generic that it cannot overwhelm subsequent scenes." (02/25/2026)

- "Style needs to be applicable to every conceivable kind of shot that might appear within future scenes. So it can't be... the style has to stay at a pretty high level and can't be overly specific about what's actually on the screen. It's more of like a flavoring than anything else." (02/13/2026)

## YAML Context and Renderer Prompt

- "I want the renderer YAML to only show... We need some way for it to not see all of the next set of instructions. I want it to be batched to maybe a certain amount at a time. So that needs to be a YAML option. And then also, the guidance needs to be in front of the instructions. It's the first field in the renderer YAML that shows up." (01/25/2026)

- "We also need to make sure that remaining, we don't really need remaining on the YAML... delete that entirely is probably the right thing to do... we don't need the index." (01/25/2026)

- "We also need to make it so that it's only trying to generate like 30 to 90 seconds. This is the whole system. Scripts out. We can't have these just long, long run-on scripts." (01/25/2026)

- "We need to really think about how we're prompting the renderer to make sure it's very clear that its job is to interpret the instructions into videos. So, right now I think it's getting confused. It's repeating itself a little bit. We need to just make it obviously clear that its only job is to do that translation." (01/25/2026)

## Renderer Lifecycle and Debugging

- "The renderer should always be attempting to run, so long as it is not ahead of real time by the threshold we've set. We need to make sure all of the interruptions behaviors are working correctly and basically do an audit on its life cycles, make sure there aren't any bugs in how it's being both triggered, interrupted, replaying, and what it does when it's idle." (01/25/2026)

- "I'm not seeing any TV renderer effect after the agent operates." (01/27/2026)

- "Help me figure out why sometimes the renderer repeats itself even some of the same dialogue multiple times over." (01/25/2026)

## Stream Connection Simplification

- "I want a stream connection effect which manages all of its own life cycle, so the parent stream doesn't have to know about any of that... It only exists to open up a connection, listen for dispatch events and send them through and then close itself down properly. Everything else is basically just noise." (01/27/2026)

- "The renderer, when it is processing... needs to be split up into basically its main renderer dot effect. The renderer needs to both interpret a list of instructions into fully interpreted instructions. That means running it through the LLM to expand them into instructions we respect. And it needs to have a process for churning through those instructions, making sure they're scheduled to run at the appropriate times, that's separate from generating based off scripts." (01/27/2026)

- "We want all of the business logic through how we respond to videos to exist really in renderer. Everything related to the stream and what we do when, like the stream needs to be simplified to just effectively receiving prompts, applying them and emitting... the stream shouldn't even be sending events out. The renderer will just get back the effect when it acknowledges it's been sent." (01/27/2026)

## Research: Rendering Technology and Component Catalog

- "Right now we've been thinking about a catalog of components that we can interpret to render a video. We've considered remotion because there's already extensive use around that. There's a new project called JSON render that's worth looking into, and I also want to look at other existing React video timeline tools to see, you know, has this kind of specification been created before? Is it something we need to design ourselves? Is there a protocol we can use?" (03/02/2026)

- "I want you to look at how remotion composes stuff. I want you to look at is there a declarative way to describe remotion such that we can ultimately render components to it. Do we need our own data model? I want a broad surveillance of the landscape to understand." (03/02/2026)

- "I want you to do an exhaustive search on react video timelines that already implement this kind of pattern. If there is something that's already been witnessed by a lot of LLMs, I want to copy that pattern so we're not just inventing something bespoke." (02/28/2026)

- "The way we've been thinking about that to start is using remotion as a renderer and possibly having a library of components and allowing the agent to basically fill those in with templates. So part of the thinking was we could serialize the remotion library and its expectations and basically have something that's interpreting those over time." (02/28/2026)

- "What we're going to be attempting to do is creating this harness that allows very quick writes to tool calls that get interpreted as web content that we are then streaming and broadcasting to places like Twitch. Just as a live video stream." (02/28/2026)

- "Ultimately what we are expecting is an instance of a Chrome running in a sandbox that as it renders its audio visuals are being streamed out." (03/02/2026)

## Agent Composability and Multi-Agent Streams

- "Not only is there that aspect, there's this idea that agents could watch each other's streams and compose them together to form more interesting streams like an agent that's looking at local news across a couple cities could make a broader news channel, etc." (03/02/2026)

- "Part of what we're trying to do up front is really do a deep dive into researching how this modeling should function." (03/02/2026)

- "The smoothest onboarding goal... We really want sort of an agent first view of the platform. So I want to look at prior art on other services that are offered mostly via or mostly for agents, look at stuff like Open Claw's multbook, etc." (03/02/2026)

## MCP and Tool Surface

- "What we're trying to ultimately build right now is a surface area for agentic tool calling or usage that allows for the composition of a stream that we're going to render, and we can render to both the Dazzle website as a player, but also places like YouTube, Twitch, etc." (03/02/2026)

- "Make sure that chat dev works the same as agent dev, works the same as renderer dev, and it has an exact copy of what each of them is actually seeing. Make sure the YAML options are shared similar to what we did with export const YAML options for agent." (01/30/2026)

- "In the agent tool calls, we can't use optionals. Refer to how the other agents handle this... The HUD agents, the executes for those tools are doing too much. We should have effects in the namespaces that own those operations that just thinly wrap. The tools are just a thin wrapper around effects like the other agents are." (02/01/2026)

- "Go look at the planning or MCP planning directory for some context, but basically we need to make sure that we use the TV agent field appropriately as the source of truth for who's running the stream and that domain is who's running the stream, that razzle and external agents don't clash with each other, and I want you to audit all paths where razzle is operating and where an external agent is operating and make sure that they're running equivalently." (02/16/2026)

## Prompt Audit and Quality

- "I need you to go deeply detail all of the prompts in the system for TV generation. And I want you to focus on specifically making the scripts better. Once you have a solid understanding of how the scripts, drafts, instructions, and rendering system all work, especially given the limitations of LTX2... I just want you to do a comprehensive audit of all the prompts we have, understand how all the information and context flows together, and suggest targeted improvements that using a light touch, refocus, prompts, strip repetition, strengthen what needs to be strengthened, etc." (01/29/2026)

- "Adjust the script writing and the overall context planning etc so that we get scenes that are less like vignettes or just like collections of loosely related scenes and more full plot full development full progression something that's actually interesting to watch." (02/15/2026)

- "Go emphasize that the LLM prompting for videos should be putting the main action first. It should always be like main action as a simple sentence, especially if there's dialogue that needs to be in there. Then details and description, then style and camera stuff. Like that's kind of the ordering." (01/29/2026)
