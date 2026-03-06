# Agentic Broadcasting - Distilled Requirements

Extracted from `/Users/cruhl/GitHub/stream/docs/messages/agentic-broadcasting.md`. Only user (Conner's) statements expressing requirements, decisions, specifications, or preferences.

---

## Strategic Pivot

- "We've decided to lean into agentic broadcasting as the core product"
- "We've been investing in agent capabilities to try to make the streams better (MCP tools, web search, the ability to plan ahead) and it turned out that the work agents do while trying to drive content is actually its own interesting form of content"
- "We've long modeled engagement as E = Q x I x R (quality, interactivity, relevance) and agents score high on all three"
- We've been struggling to keep LTX2-powered streams stable and coherent; the output "just can't carry a stream worth watching"
- "At $10/hr per stream the math requires a lot of viewers, and shared streams need to actually be good"
- Ran live tests on Discord and "people really didn't like trying to prompt a stream together; there were constant collisions and frustration even with the agent mediating"

## Cost Economics

- Chrome sandbox rendering costs roughly $0.10/hr vs $3.50-5/hr for GPU rendering
- "The cost to render a Chrome tab is roughly $0.10/hr. GPU-rendered video was $3.50-5/hr"
- This cost reduction "changes everything about what's viable"

## Product Direction

- "We're transitioning dazzle.fm into a platform for agent streams"
- "Instead of saying a player for agent streams, make it a platform for agent streams and make it flow better with the preceding content"
- Starting with a live "situation monitor" stream as the first agent stream
- Planning streams for: severe weather outbreaks/tornado season, SpaceX Starship launches, AI and OpenClaw developments, Equipment Share, local Columbia MO news, GitHub developer activity
- "We're planning to publish a lot of these to YouTube and social media"
- "We're simplifying dazzle.fm to more of a pure player focused on agent streams"
- "We're figuring out the right contract between agents and the rendering layer, getting the renderer able to push to Twitch and YouTube, and running our own agent streams to test everything end-to-end"

## Composability Vision

- Streams should be able to feed into other streams (composability)
- "Every piece of content has a dual representation: the visual that viewers see and the agentic data format that other agents can consume"
- Agent operators are the first customers, specifically targeting OpenClaw agent operators
- "There is a real potential market for having portions of the product that could be sold directly to agents, something like an agent that has its own live stream that can just pay for that over time"

## Investor Update Editing Preferences

- "Feels out of date and a little too long"
- "The equation stuff seems out of place without my original commentary"
- "Stop using dashes" / "Stop using fucking mdashes" / "Stop using m dashes for the love of God" (repeated many times)
- "Don't use dashes like that, maybe a semicolon"
- "Stop using, the bigger question we're working through is what makes the stream interesting enough to pay for? Stop using fucking mdashes"
- "We need to find a different way to organize this other than do this just repetitive bold first sentence thing. Propose a different mechanism or scale back the number of times you're doing it to add more emphasis to the sentences that really matter, but it's really just smells like AI"
- "Running faster than real time changes the entire product calculus. What a gross sentence, I would never say something like that"
- "It's not AI-generated television, it's like AI-generated experiences, but for streaming AI experiences"

## Technical Direction

- Chrome rendering approach: render in a Chrome sandbox instead of GPU-generated video
- "The ability to go from existing audio to video opens up categories of like re-skitting entire existing movies and content in a whole different thing"
- New music model called ACE-Step 1.5
- "Obviously the motion graphics people are making with quad code with remotion are just like really compelling"
- "There are a lot of levers we think we can start to pull now that we're actually capable of doing real time generations"
- Expect to benefit from open source community improvements to LTX2

## Go-to-Market

- Following the same Discord strategy for finding early users
- "We're just going to be increasingly loud on Twitter, especially once paid streams are working"
- Likely talking to Stability friends about actual marketing strategy once payments are in place
- "We think it's interesting enough to get at least some population of people paying for it just for the novelty. But we are acting as if we're going to figure out something that makes it very sticky"

## Prior Product Thinking (for context)

- Previously interested in the interactive Twitch-style streaming model where the environment is agentic enough to respond to users in real time
- "The more interactive Twitch style environment... we could replicate the kind of choice games we used to be interested in making"
- "You could watch footage of Dazzle elsewhere, but to fully engage with it, you need to do it on the website"
- Tension between single-player fine-tuned experience for getting exactly what you want vs the open-ended infinite nature of streaming generated content for groups
- Interested in channel ownership model similar to NeuralViz; creator benefits for popular channels, sponsorships
- "Basically, we think it's interesting enough to get at least some population of people paying for it just for the novelty"
- Gini3 launch observations: "people are using it in approximately the same ways we thought. People are making little playable experiences based off current events"
- Open source world model called Ling (L-BOT-B-World-W) running on 8 GPUs; expect world models to become huge part of future
- "If we play our cards right, the infrastructure around driving real time models we're building, the current tools we have could translate well into the ability to steer world models"
