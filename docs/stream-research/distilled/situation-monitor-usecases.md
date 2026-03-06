# Situation Monitors, OSINT, Use Cases, Content Types, and Publishing

Distilled from Conner's statements across message history. Grouped by theme, duplicates removed.

---

## The Core Thesis: Agent Work as Content

- "The core idea is that what an agent is doing while it's working is fundamentally interesting in its own form of entertainment."

- "Imagine an agent going on Zillow and lowballing a bunch of boomers' homes offers, and they're reacting all angry -- that could just be a live stream."

- "With the war happening in Iran right now and all of these other situations, an agent just scouring social media and publicly available news sources could stream its research as a live stream."

- "What an agent does while working is inherently watchable. A motion graphics version of what Claude Code does while writing code is more interesting than watching a terminal."

- "Imagine in Claude Code, you're not just seeing a terminal UI stream past -- you get a really nice visual depiction of what the agent is doing as a polished stream. You can watch and share."

- "The work agents do while trying to drive content is actually its own interesting form of content." (This realization emerged from investing in agent capabilities to improve LTX2 stream quality.)

- "If anyone is running an agent that's doing something interesting, you now have the ability to broadcast it both to other people, to yourself, and of course other agents."

## Specific Stream Ideas and Use Cases

- **Situation monitor (first stream):** "We're probably just going to focus on one, maybe two at max -- basically a situation monitor stream. Tons of people have been building their own situation monitor dashboards out there. It's clearly a desire to do this, but we think we can get out one that runs in video space as a live stream relatively quickly."

- **Severe weather / tornado season:** "Weather updates -- tornado season is about to start." Framed as "severe weather outbreak live stream."

- **SpaceX Starship:** "I'm interested in SpaceX Starship news."

- **AI landscape:** "I want updates on all the new developments in AI space, including new agents, new OpenClaw stuff."

- **EquipmentShare stock monitoring:** "The ability to follow specific companies -- like we all have EquipmentShare stock. So we're interested in keeping up to date with anything that could affect the EquipmentShare stock."

- **Local Columbia MO news:** "Local Columbia, Missouri, news events, resources, etc."

- **GitHub developer activity:** "The ability to follow certain developers on GitHub to see who's contributing and what people are building, what GitHub issues are getting traction."

- **Iran situation monitor (the first real test):** "You're in particular going to be in charge of getting our OpenClaw agent to actually work as a real time monitor of everything related to what's going on with the war in Iran." Built as a separate repo (iran-monitor-agent) to simulate what an external OpenClaw user would create.

- **Personal agent visualization:** "A stream that you can plug into the personal agent you're using and just have it visualize this activity."

## The OSINT / Situation Monitor Trend

- "I keep seeing dashboards for all kinds of things like falling prices, like all sorts of signals intelligence trends."

- "There's a wave of people building situation monitors and signals intelligence dashboards with agents right now, everything from falling prices to OSINT to all kinds of trend tracking. We keep seeing new ones and it's clearly something people want, which is part of why we're starting there."

- "Situation monitors as a trend is true. I keep seeing dashboards for all kinds of things like falling prices, like all sorts of signals intelligence trends."

## Stream Composability

- "Agents could watch each other's streams and compose them together to form more interesting streams -- like an agent that's looking at local news across a couple cities could make a broader news channel."

- "An Iran stream, an AI stream, and a politics stream compose into a news stream. Company-specific streams compose into industry coverage."

- "If we do everything right, we can take advantage of network effects by being a central hub for these streams where people build off each other's streams, share their streams, and ultimately create something similar to a Moltbook."

## Publishing to YouTube, Twitch, and Social Media

- "We're planning to publish a lot of these to YouTube and social media."

- "We're going to start with a live 'situation monitor' and see what sticks, then publish to YouTube and other social media from there."

- "We're implementing basically first the situation monitor stream with fast follows on actually published YouTube, on social accounts, live streams for all kinds of stuff."

- "We're simplifying dazzle.fm to more of a pure player focused on agent streams. Right now we're working on the agent contract and integration, building a renderer that can push to Twitch and YouTube and dazzle.fm, and running our own dogfood streams."

- "We're transitioning dazzle.fm into a platform for agent streams and on the implementation side we're figuring out the right contract between agents and the rendering layer, getting the renderer able to push to Twitch and YouTube, and running our own agent streams to test everything end-to-end."

## Dual Representation: Visual for Humans, Data for Agents

- "Ideally, what we'd find is a dual representation where the contract for what the agent is sending to operate the stream allows us to render it and is what's visible to other agents as a comprehensible, well-formed machine readable format."

- "For this Iran stream, imagine an agent churning through looking up stuff going on in Iran, and it's able to use a map screen, statistics, show a video -- all of these composable fragments of UI that both could be rendered as a video stream and read by other agents to provide context."

- "Streams have to be visually compelling and dual-readable -- by agents AND people. Right now humans are driving the agents and paying for their usage. The end product has to be interesting to people. But long-term, we think the larger audience is agents consuming other agents' streams, not people."

- "We ultimately think these streams need to be visual and dual-agent. We know that humans are ultimately the ones driving the agents right now and their attention and paying for their usage. So the end product has to be ultimately interesting to people, but we think the larger, long-term audience is agents, not people."

## Target Customers: Agent Operators

- "People who are spending hundreds of dollars to run agents all the time are already used to spending money on AI. We just thought it was way more likely that people running agents as customers are a much better fit than just your average normal user."

- "These are people who are already super invested in AI. They don't have the problem with AI in general. They're willing and able to do technical stuff and test out tools. And they're obviously spending a lot of money."

- "Agent operators as customers completely sidestep the anti-AI backlash problem since they're people who are already deeply invested in AI and spending real money on it."

- "A rich video livestream is just a fundamentally more interesting way to consume what your agent is doing than watching a terminal or chat."

- "People running agents are already spending real money on AI and looking for rich output surfaces. Making it easy to livestream what your agent is doing is the right real-time product."

## Why the Pivot from GPU-Rendered Video

- "We have just been really struggling to keep the stream stable, to keep it coherent. The audio for LTX2 is really bad. The character consistency is really bad. The prompt adherence is really bad. The speed was great -- faster than real-time was a pretty big advance. But the rendering surface area of LTX2 just can't perform."

- "Given the cost of having one user and one GPU being so high at $10 an hour, we fundamentally are limited in the kinds of products we could build."

- "Bill Cusick got pushing us in this direction of a prosumer tool turning knobs. But we just really don't think it's both technically possible or financially possible to justify that kind of product. We think prosumer creation tools are going to be a race to the bottom -- the bitter lesson guarantees models will do all of that better over time."

- "Mid month, John started experimenting with Remotion and motion graphics and started really questioning this whole approach of having a product built around ultimately requiring H200s."

- "We think we can get higher quality and a much more engaging product by composing motion graphics, images, videos, and generative media into streams instead of trying to do full streaming video through a GPU. Rendering in a web sandbox through Chrome -- ~$0.10/hr versus $3.50-5/hr on GPU."

## Engagement Model

- "We've always modeled engagement as E = Q x I x R -- quality times interactivity times relevance is full engagement. Agents are extremely interactive. Their ability to create quality by bringing in outside materials, videos, information and plan over long horizons is huge. And their relevancy, because they are mostly being used right now for per-user personal purposes, is as high as it can possibly get."

## The Three Workstreams

- "We have three workstreams in parallel: the surface area and product integration so you can run streams with agents (most of that initial work is already done -- it's about figuring the right contract and distribution for agents), getting our multiplex renderer done so we can stream to existing platforms like Twitch, YouTube, dazzle.fm, and running our own agents as the first actual streams to dogfood the product directly."

## Dogfooding Strategy

- "At first we're really focused on just deploying a high quality stream so we can dogfood the product while working to get external OpenClaw users."

- "We want to target actual streams with actual viewers as quickly as possible."

- "First: a high-quality dogfood stream -- a live situation monitor we operate ourselves to prove the product works."

## Iran Monitor Agent (Concrete Implementation)

- "You're going to be focused on making sure that our OpenClaw agent is producing an interesting stream of real time content. None of the actual integrations with Dazzle are ready yet. We basically want to simulate a dense enough stream of information that if we had Dazzle as a rendering surface area, we would know it would do a good job being audiovisually represented."

- "The number one requirement is we have enough interesting information to actually run a live stream."

- "We're trying to emulate as closely as possible what an external user setting up OpenClaw would do if they were creating an Iran news situation monitor."

- "For source strategy, I'd really like to involve Twitter as well, but I don't want to burn my own account. So maybe we get the Twitter API."

- "We have a pretty high cost tolerance. Our main agent can be a more expensive one, but we can have dumber agents running for background."

## Rendering and Architecture Decisions

- "What we're thinking in terms of architecture is there will ultimately be a React app running in a sandbox that's driving Chrome, and then that visual output will be streamed as video to wherever it's needed."

- "We've been thinking about a catalog of components that we can interpret to render a video. We've considered Remotion because there's already extensive use around that. There's a new project called JSON render worth looking into."

- "Has this kind of specification been created before? Is it something we need to design ourselves? Is there a protocol we can use?"

- "If I have an agent doing anything interesting, I can just point it at Dazzle, and we have just the smoothest onboarding process possible to get that agent rendering its work to a cohesive interface that allows it to stream as video or as data to other elements."

## UX Lessons from YouTube and Twitch

- "I'm looking at YouTube's setup for live chat and they give you a bunch of these settings up front. Controls show up in a bottom bar, 'Edit' opens a modal for detailed stuff. Chat exists as a collapsible panel. We should take some lessons from here."

- "Because you're paying for what you're watching, anytime we have to drive the user away from where they're watching something, it's a stop-the-world problem. We have to be very deliberate about giving somebody who's paying to watch something everything they need to improve that experience without leaving the stream itself."

- "In the sidebar, I want it more similar to how Twitch does it -- shows the viewer count. If it's zero, just don't show it."

## Earlier Content Direction (Pre-Pivot, January-February 2026)

- "We're more drawn to the interactive, Twitch-style environment. It's the most general case -- an environment agentic enough to stream compelling content driven by what users are saying, discover things on its own, and react close to real-time."

- "The idea of agents as users is becoming more interesting to us. With the whole OpenClaw agent explosion happening, we think there's a real potential market for portions of the product that could be sold directly to agents. Something like an agent that has its own live stream and can just pay for it over time."

- "We've also discussed letting agents drive the stream entirely -- imagine Claude Code operating over our primitives as the show-master."

- "The motion graphics people are making with Claude Code and Remotion are compelling, and we could incorporate that style of animation into streams."
