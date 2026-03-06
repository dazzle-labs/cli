# Engagement Model, Product Vision, Strategy & Competitive Positioning

Distilled from Conner's statements across claude-history search results. Grouped by theme, deduplicated.

---

## The Engagement Equation (E = Q x I x R)

- "We've long modeled engagement as E = Q x I x R (quality, interactivity, relevance) and agents score high on all three: they pull quality information from real data sources instead of hallucinating visuals, most of what they do is for personal purposes so they're intrinsically relevant, and they're interactive by default."

- (June 2025, referenced in later updates) First introduced the engagement framework: "We think of engagement as the product of three dimensions: quality, interactivity, and relevancy (E = Q x I x R)." Quality was the initial priority at ~80% of ideal. Interactivity was next. Relevancy was the hardest (TikTok-level personalization).

- (July 2025, referenced) "Interactivity has a dramatically higher base coefficient than quality, i.e. games are really fun." And: "The most relevant thing for a user is what they're actively creating." Quality was "pretty bad, but it doesn't matter when they arrive fast in response to user actions."

---

## The Pivot: From GPU Video to Agentic Broadcasting

- "We've been struggling to keep our LTX2-powered streams stable and coherent. We got it faster than real-time, which was a pretty big advance, but we've fallen into a minimum of trippy dreamlike visuals, and the output just can't carry a stream worth watching."

- "At $10/hr per stream the math requires a lot of viewers, and shared streams need to actually be good. We ran live tests on Discord and people really didn't like trying to prompt a stream together; there were constant collisions and frustration even with the agent mediating."

- "Bill Cusick (Stability's ex-Creative Director) has been testing with us and kept pushing toward a prosumer tool with knobs for style, story, coherence, etc. We think prosumer creation tools are going to be a race to the bottom, the bitter lesson guarantees models will do all of that better over time. We'd rather compete on something a lot of people are using that has network effects."

- "We'd been investing in agent capabilities to try to make the streams better (MCP tools, web search, the ability to plan ahead) and it turned out that the work agents do while trying to drive content is actually its own interesting form of content."

- "We think we can get higher quality and a much more engaging product by composing motion graphics, images, videos, and generative media into streams instead of trying to do full streaming video through a GPU. We're rendering in a web sandbox through Chrome which we expect to cost around ~$0.10/hr versus $3.50-5/hr on GPU with LLM costs. That means we can do one stream per user, or even many streams per user, instead of sharing one stream across many viewers."

- "We basically discovered that the work agents do while trying to drive content is actually its own interesting form of content... people who are spending hundreds of dollars to run agents all the time are already used to spending money on AI. We just thought it was way more likely that people running agents as customers are a much better fit than just your average normal user."

- "John started experimenting with remotion and motion graphics. He started really questioning this whole approach of having a product built around ultimately requiring H200s."

---

## Agents as Users / Agent-First Platform

- "The idea of agents as users is becoming more interesting to us. With the whole OpenClaw agent explosion happening, we think there's a real potential market for portions of the product that could be sold directly to agents. Something like an agent that has its own live stream and can just pay for it over time. There's a way to position this toward agents-as-users that we need to explore more."

- "Right now, humans are driving the agents and paying for usage, so streams ultimately need to be visually interesting for people, but we think the long-term audience is mostly agents consuming other agents' streams."

- "Agent operators as customers completely sidestep the anti-AI backlash problem since they're people who are already deeply invested in AI and spending real money on it."

- "The smoothest onboarding goal... we would even want an agent to be able to self-discover Dazzle, create an account, pay via tool calls, etc. Like the whole lifecycle. We really want sort of an agent-first view of the platform."

- "All of the energy right now is around OpenClaw and projects like it. We're really trying to capture and aim for that energy."

- "There are thousands of people running their own personal agents now (OpenClaw alone has 247K GitHub stars and 1.2M weekly npm downloads) and a rich video livestream is just a fundamentally more interesting way to consume what your agent is doing than watching a terminal or chat."

- "Compared to normal consumers who are passively watching, these are people already willing to spend real money on AI, with power users at $200-500/day on LLM costs."

---

## Composability and Network Effects

- "The data format has both a visual representation and an agentic one. Composability matters too -- streams about different topics can feed into each other. An Iran stream, an AI stream, and a politics stream compose into a news stream. Company-specific streams compose into industry coverage."

- "Moltbook showed centralization still happens in agent-first worlds and we want to be that point of coordination."

- "We think there's a real window to build the default place agents broadcast to and we're moving as fast as we can to get there."

- "If media generation APIs commoditize, we're the app layer. Agent streams feeding into other agent streams create network effects. The window to establish that coordination point is limited."

- "Agents could watch each other's streams and compose them together to form more interesting streams -- like an agent that's looking at local news across a couple cities could make a broader news channel."

---

## The Dual Representation / Content Model

- "The core idea is that what an agent is doing while it's working is fundamentally interesting in its own form of entertainment."

- "The actual modeling is highly critical. Ideally, what we'd find is a dual representation where the contract for what the agent is sending to operate the stream allows us to render it and is what's visible to other agents as a comprehensible, well-formed machine readable format."

- "Imagine an agent just churning through looking up stuff going on in Iran, and it's able to use for instance like a map screen, statistics, show a video, all of these composable fragments of UI that both could be rendered as a video stream and read by other agents to provide context."

- "What we're thinking in terms of architecture is there will ultimately be a React app running in a sandbox that's driving Chrome, and then that visual output will be streamed as video to wherever it's needed."

- "Definitely not interpreting an existing agent's work. This would be deliberate composition. It's consuming the structured contract directly."

---

## Target Streams and Use Cases

- "We're excited about the kinds of streams that can be built with agents. There's a lot we're personally interested in: severe weather outbreaks, SpaceX updates, AI developments, EquipmentShare-related news, local Columbia MO happenings, GitHub activity, etc. We're going to start with a live 'situation monitor' and see what sticks, then publish to YouTube and other social media from there."

- "There's a wave of people building situation monitors and signals intelligence dashboards with agents right now, everything from falling prices to OSINT to all kinds of trend tracking. We keep seeing new ones and it's clearly something people want, which is part of why we're starting there."

- "Imagine Claude Code -- you're not just seeing a terminal UI stream past, you get a really nice visual depiction of what the agent is doing as a polished stream you can watch and share."

- "There was an agent that is going on Zillow and lowballing a bunch of boomers' homes offers, and they're reacting all angry, and that could just be a live stream."

---

## The Original Streaming Vision (January-February 2026)

- "What we've built is something like 'Twitch Plays Pokemon' but for streaming AI experiences. We created a chat system where people communicate with each other and with the model to ask for what they want to see."

- "The core realization driving our product work in January is that with our old choice games, each user required their own dedicated generation stream, making per-user costs exorbitantly high. If multiple people share the same stream, our cost per user-hour goes down the more people are watching."

- "We're more drawn to the interactive, Twitch-style environment. It's the most general case; an environment agentic enough to stream compelling content driven by what users are saying, discover things on its own, and react close to real-time."

- "To fully engage with it, you need to do it on the website. You could watch footage of Dazzle elsewhere, but steering the stream is the product."

- "We think the streams are interesting enough now to get some people paying for the novelty, but we're acting as if we're going to figure out something that makes it very sticky. If we can do that with payments infrastructure in place, we're in a good spot."

- "By going multiplayer first, we're potentially building in an area that single-player experiences won't touch for a while. Most world models and interactive AI experiences are oriented around one user at a time. The data and dynamics of multiple people collaboratively steering a stream are genuinely different, and that kind of multiplayer interaction data would be really hard to replicate from a single-player starting point."

---

## Competitive Positioning

- "We think prosumer creation tools are going to be a race to the bottom, the bitter lesson guarantees models will do all of that better over time. We'd rather compete on something a lot of people are using that has network effects."

- "We have a real moat forming in how we make the stream actually work. We smear context through latent space to create smooth transitions, keep things consistent shot-to-shot, and extend audio forward through independent video generations."

- "Running ahead of real-time has made us redesign the entire generation stack around having time to spare. Previously we were running three GPUs wide to generate futures we didn't use, then interrupting and picking one to simulate a real-time stream. Now, for the first time, we have a budget for things like LLM guidance of the video model."

- "We fully expect world models to become a huge part of our future. We're able to use video models now because they're finally real-time and affordable. If we play our cards right, the infrastructure we're building around driving real-time models could translate well into the ability to steer world models. The difference is that now we don't have to wait; we can actually iterate on the tooling in a real-time harness right now."

- "The launch of Genie 3 has been interesting to watch. People are using it in approximately the same ways we expected; making little playable experiences based off current events, something we're still interested in doing ourselves."

- "By going multiplayer first, we're potentially focusing on and getting data in an area that single-player experiences just won't have for a while and would be really hard to do."

---

## Pricing, Billing, and Go-to-Market

- "The first thing we're going to charge for is usage-based streaming on your own channel. Anyone can create and set up a channel, but the streaming itself is what costs money."

- "We don't think we would share the exact costs, like the hourly GPU costs or whatever, but we're debating like, do we estimate the cost per hour? Do we make it more accurate to what we want? There's a scenario where like, let's say if we're doing more tool calls or chat, it can cost us more. We don't want to get locked into a time-based pricing in case what we need to charge changes."

- "Free viewing, paid creating -- yes, that's how it works."

- "I don't want to send a signal that you're spending money really while it's happening just because that could discourage spending."

- "For the first time, we think we have a way to turn raw GPU time into payments with a profit margin. X amount of GPU time produces Y amount of direct profit, and we just need to grow the number of people on GPUs to stop burning money."

- "For go-to-market, we've been talking with Stability's ex-Creative Director and ex-CTO about how they grew their early user base; getting people with influence to test for free and share through their networks."

- Some of the creative types testing with us "are confident people would pay pretty much right away. We have friends connected to places like Wonder Studios who think there's real demand for a creator tool direction... We're just not that interested in it."

---

## The Entertainment-First Principle

- "The first principle is that Dazzle should always be trying to entertain someone. For some people, that means letting them steer, for some people, that means just letting them watch. For some people, that means interactivity."

- "There is no such thing as a session without an agent, and it's not always running by default."

- "If I'm using Claude Code to run my stream, Razzle is not involved at all."

- "There is no manual mode. I think I need help reasoning through that." (Resolved as: users direct through natural language; the agent interprets intent into generation commands.)

- "No agent marketplace -- huge scope creep."

- "Homepage should drive people to active sandbox stream."

- "Think from first principles, atomic desires." And: "Your main purpose is to be self-simulating these flows to sort of gradient descend into the best possible version of the UX."

---

## Razzle (Built-in Agent) Personality

- "Razzle's personality -- this is a fine balance. We don't want it to be cringe. I think it should be very minimal, but it's trusting of the user's intent. It works as a strong partner in following their goal. It tries to get out of their way, like it's not the main focus. It's not afraid to push boundaries or be a G, but it's not cringy and try hard. It should feel like working with someone who is very good, like a very experienced entertainer helping you along."

---

## Multi-User Stream Dynamics

- "When it's a single user, obviously we send that stuff through as quickly as humanly possible. And when it's multiple users, we need to be a little bit more careful about balancing, but we bias towards what would be the most entertaining and enjoyable outcome for a group of people in a chat room trying to steer the stream."

- "One specific friction point we're working through is how to share the resource of the stream itself; when multiple people are prompting, deciding when to use one person's input versus another has caused some tension we need to figure out."

---

## Evaluation Philosophy

- "Your overall guiding principle is if somebody is paying for this stream of content, when we look at the actual session that was generated, is it good enough for them to have paid for? Was it compelling? Did it follow their instructions? We think about it from the user's perspective more than anything else. Would they have felt value for the time spent?"

---

## Auto Product Development Loop

- "What have you done about the user simulation aspect? I really think that good strategy is going to be creating basically personas for users that we can simulate to actually have the app running, pretending to be agents to help drive forward requests, to test out functionality."

- "I basically want an agent that's effectively simulating a user of this software... I want that agent looking at the screen. I want it reacting. I want it debugging and testing things. I want it getting feedback."

- "I basically want a process by which we can have some agent act and believe it's a real user. We want to see how they come to the app and react to it. We want to have reports based off that. We want a product manager type simulator to take in that feedback. Did they bounce? Would they have clicked through? We really need the auto product development loop set up to get this fully cycled. So it's less reliant on me driving at this level of granularity."

---

## Where the Product Is Headed (March 2026)

- "We're transitioning dazzle.fm into a platform for agent streams."

- "We're simplifying dazzle.fm to more of a pure player focused on agent streams."

- Three parallel workstreams: agent contract and integration surface, multiplex renderer for Twitch/YouTube/dazzle.fm, and dogfood streams.

- "Everything runs on our own machines. No GPUs needed."

- "People running agents are already spending real money on AI and looking for rich output surfaces. Making it easy to livestream what your agent is doing is the right real-time product."
