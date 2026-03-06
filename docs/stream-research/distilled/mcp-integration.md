# MCP Integration -- Distilled User Statements

Extracted from `/Users/cruhl/GitHub/stream/docs/messages/mcp-integration.md`. Only Conner's direct statements about MCP integration, tool calling, agent capabilities, and the MCP server. Grouped by theme, deduplicated, chronologically ordered within groups.

---

## 1. Vision and Strategic Direction

- "Essentially what we're going to be doing is trying to offer up all of Dazzle's core capabilities as an MCP that we can let other agents use to coordinate and drive a live stream and to generate content." [02/16]

- "I want you to go thoroughly document and investigate the entire surface area of our current generation flow. And I want you to reason through everything we would need to do to make it so that an external agent could operate Dazzle to show a live stream running." [02/16]

- "I want the TV agent directory to be basically the implementation of Dazzle's built-in agent and nothing more. It's connected to the MCP. It's basically like the first-party agent client that operates Dazzle under normal circumstances and it doesn't have any special tools or implementation details beyond what the normal MCP server is providing. It is authenticated. It follows all the same flows as another external agent." [02/16]

- "I want there to be a difference between the generic concept of an agent and Dazzle's specific agent. I'm thinking what I want is there to be a new Razzle, as in like Razzle-Dazzle directory that represents Dazzle's actual specific agent implementation. TV.Agent would be there for centralizing agent operations and anything that represents the generic instance of an agent. And Razzle is just an instance of TV.Agent." [02/16]

- "Agents can now operate Dazzle streams end-to-end through MCP, which means they can do longer-form tool calling, perform their own web searches, pull real-time information, and bring whatever other capabilities they have access to." [03/02]

- "Dazzle's internal agent shares the same interface as external agents now, so we're dogfooding our own integration." [03/02]

- "In February we built MCP integration and usage-based billing so that external agents can operate and pay for Dazzle streams, and after a month of testing, we've decided to lean into agentic broadcasting as the core product." [03/02]

- "We think the long-term audience is mostly agents consuming other agents' streams." [03/02]

- "I also want an MCP server for the product itself so that any useful tasks you might find yourself repeating that would be easier to expose over MCP. I want to figure out what those might be and have a clean pattern for that." [03/01]

---

## 2. Fractal Domain Design and Architecture

- "I want you to follow the fractal pattern and don't just pollute a namespace called MCP with all of this TV-related functionality. Follow how tRPC is composed from subdomains and make sure this Server.MCP is just main setup and composition and the actual functionality is as close as possible to its actual implementation as an MCP domain." [02/01]

- "Session.mcp() should be in Session, just like trpc. Under MCP you put a redefinition of all these domains. This is exactly how not to do fractal composition. Instead of MCP.Session it should be Session has its own mcp just like trpc." [02/16]

- "I definitely like MCP tool registrations composed upward versus centralized in TV.MCP, otherwise we'll end up with this insanely large file. So I definitely like the fractal design." [02/16]

- "I want there to be at the root of TV, a .MCP domain that is sort of like the master setup for everything in the TV domain." [02/16]

- "I think Server.MCP is all the stuff you would need to instantiate an MCP server somewhere in the app and TV.MCP owns everything related to making the TV MCP available." [02/16]

- "The MCP should definitely just be like /mcp, maybe /tv/mcp." [02/16] (Later settled on /tv/mcp)

- "For the API surface area, make sure we can use the input schemas as well to give a better idea of how everything works." [02/17] (on dev MCP trpc_schema tool)

---

## 3. Tool Surface Design and Primitives

- "I do not trust the idealized surface area designed by the previous agents. They didn't have all the full context. You need to spend a bunch of time thinking about this from first principles." [02/16]

- "I don't think the idea of a tool count target is correct. It's like, what is the actual number of tools needed to get this to work? And I want you to prove that it can work. I need you to self-simulate a bunch of scenarios and different kinds of streams and different kinds of content." [02/16]

- "I want you to be the agent that focuses on extremely detailed and thorough scenarios, runs the simulation and provides critique. You basically need to prove for yourself that the surface area covers all of the scenarios you can create. And you need to create at least 20 scenarios." [02/16]

- "I'm very suspicious that our primitives are overly indexed on the current design pattern. In the future what we're going to want is something that allows an agent to basically design timelines, even do that in parallel, add them to what's actually streaming, interrupt them, etc." [02/16]

- "At the end of the day that all needs to be turned into a series of LTX-2 tool calls. And I don't think we want the user or their agent to know how to make LTX tool calls." [02/16]

- "For content append, I really don't like doing up to 10 sequences. I don't really like doing it as an array either. Ideally we're only calling content_append just in time. The agent could plan ahead if it wanted on its side. But in terms of what Dazzle sees, we don't really need to know that far into the future." [02/16]

- "I think we also need to start planning for the reality in which there are streams not connected to channels. Sessions aren't necessarily owned by channels. I could totally imagine a scenario where somebody just walks in the platform, hits a new stream or create stream, and then boom they're just running." [02/16]

- "I think it's important for the agent to be able to operate the HUD, and eventually we'll have more stuff in the HUD like buttons for interactivity." [02/16]

- "Task_set is something we're only going to do inside Razzle. Other agents have their own mechanisms for self-management." [02/18]

- "19 tools is fine, no consolidation needed." [02/18]

---

## 4. Session, Stream, and Connect/Disconnect Semantics

- "There's a couple big primitives. A session represents the conceptual, persisted and stateful memory for a thing. And then inside of that there's almost like streams or connections, the things that actually cause billing and allow you to generate. And even around that there could be a channel context or there cannot be. So there's kind of like three basic primitives: a session, an actual stream or connection, and the channel potentially." [02/16]

- "There is no middle state. You're either connected or not. People should be charged when they're using a GPU. Whether or not they're actually generating through it doesn't change our costs at all. It costs what it costs." [02/16]

- "I think separate [create vs connect] makes sense." [02/16]

- "An agent should be allowed to just hold it as long as it has credits. We can spin up more GPUs. As long as they're paying for it, it's theirs to spend." [02/16]

- "This whole idea of taking an optional session ID per operation seems really gross to me. This should probably be a way to set session or set session instead of having this optional check we do all the time." [02/16]

- "Passing sessionID on every tool call is annoying. Maybe we just have like a set session or session active set." [02/16]

---

## 5. Razzle / Internal Agent and MCP Parity

- "For the Dazzle or Razzle agent, it's going to be going through MCP for everything that isn't stuff it needs to operate. The ideal state is that Razzle is just a very thin wrapper over the MCP and has just a few if any extra tools needed for self-scheduling, etc." [02/18]

- "I want there to be a hard division between stuff our agent needs for itself to operate and actual MCP functionality that allows the server to operate with arbitrary agents. Those two should not be commingled." [02/16]

- "I think I want to literally go into the same MCP calls or it needs to run through the same interface so that we feel the same pains. There's probably ways to do that same process without having to make actual hops, but just kind of simulate it." [02/16]

- "Dazzle's internal agent should not be on a separate process. It's still going to be product-owned. There's the MCP for Dazzle-level capabilities, but for its own coordination we might still need to have some actual tool calls in that agent for things like waking." [02/16]

- "For all of Razzle, I don't think it should be doing anything that the MCP server is providing. It should just be using the MCP server. So we should really investigate how to do that. We've re-implemented an entire MCP server inside of Razzle and that's not how it should work." [02/16]

- "Razzle skip-iteration on takeover is acceptable, reverse takeover should be manual." [02/18]

- "Validate Razzle uses the same surface as external MCP agents. The core requirement is 'feel the same pains.' Verify Razzle actually operates through the same tool effects as external MCP agents. Flag anywhere it bypasses the shared path." [02/18]

---

## 6. Chat Architecture (Agent Chat vs Community Chat)

- "The break between chat agent and the main agent is kind of gone. We need to let external agents opt into having a chat or managing a chat. And the same is true with Razzle. That should just be part of the surface area of MCP, but only when chat is enabled. Not everyone is going to want this externally facing chat." [02/16]

- "There's a discrepancy between the normal chat and chatting with your agent directly. There's like the community chat almost. And then there's chat directly with the agent back and forth. Those are different things and they need to be modeled somewhat differently." [02/16]

- "I want you to be focused on the unification of agent chat and audience chat. There is an extreme amount of replication between them. We're trying to have Zod schemas, domain logic, etc. such that we identify all the product-level features we've extended to the basic message flow, and what we're trying to get to is a set of minimal changes that would allow agent chat and audience chat to exist with as unified a representation as possible." [02/18]

- "Making sure that external agent tool calls are well represented in agent chat, making sure that the agent chat reflects external tool use, but if it's Razzle, we actually have the full context and chat there." [02/18]

---

## 7. Authentication and API Keys

- "Auth model: Developer permission, same API key system, require existing developer permission." [02/17] (for dev MCP)

- "This should be as brain dead simple for external users as possible, including agent users. And we should do what the expectations are, not really care about how our current stuff is implemented." [02/16]

- "I don't know why we were talking about adding key prefixes. That was weird in the first place." [02/18]

- "I currently have the MCP set up for the product and potentially others with a hard coded API key. I want you to come up with a plan so that other developers can have their API key pulled from the environment and create just the perfect DevX around this process." [02/26]

---

## 8. Billing and Billing Exposure via MCP

- "There should be tools for managing billing. It shouldn't necessarily be opt-in for every request." [02/16]

- "The MCP authenticated user's account is who gets billed for sure." [02/16]

- "Agent is operating a stream, credits run low, what happens? I think it should probably get pushed before it is interrupted so it has an opportunity to re-up potentially. It'd suck to just be interrupted. We can have purchase methods baked in. Maybe we don't do that to start because it's too much scope but I think we should be planning for that reality." [02/16]

---

## 9. Push Events and Real-Time Communication

- "I think we want ambient push and on-demand pulls. Hopefully they can share most of the same implementations, just a slightly different wrapper. Let's try to make the implementations as unified as possible." [02/16]

- "If an agent is making active requests, that kind of is the heartbeat. If the agent's not sending anything, there should definitely be some kind of timeout to protect both ourselves and users, but I don't think a heartbeat tool makes sense." [02/16]

- "Verify all 8 push events are wired and debounced correctly, especially chat_activity at 10s." [02/18]

---

## 10. Error Handling and Response Formats

- "What are the standards for MCP on returning either JSON or a more compact text format? How do people normally pass that in? And let's make a plan to basically support that." [02/16]

- "Error responses should follow the WHAT/WHY/DO/CONTEXT taxonomy from the planning docs. Every tool should guide the agent back to the happy path. Audit for gaps." [02/18]

---

## 11. Operator Model and Agent Takeover

- "We need to make sure that we use the TV.Agent field appropriately as the source of truth for who's running the stream. That domain is who's running the stream. Razzle and external agents shouldn't clash with each other. I want you to audit all paths where Razzle is operating and where an external agent is operating and make sure that they're running equivalently." [02/16]

- "Does the Operator/takeover flow in TV.Agent actually work? When an external agent makes an operate-level call, does Razzle stop correctly? What about the reverse?" [02/18]

- "There should be a type Agent that has an operator and make sure we use that in the runtime and in the session instead of just operator directly. Instead of 'identity' call it 'name' for operator." [02/16]

---

## 12. Session State and Security

- "Session snapshot should not be something that's exposed to public clients. We need to make it so that we're accessing this through maybe the dev tRPC or some other mechanism. If that is exposed to public clients, we need to remove it. We don't want to be exposing our session YAML." [02/26]

- "Session Get MCP is such a fucking awful bastardization of domain modeling. I want a screen." (Rejected session_get in Runtime -- it belongs in Session domain.) [02/26]

- "Move session_get to dev MCP only." [02/26]

---

## 13. Dev MCP and Developer Tooling

- "I want you to create a new root level tRPC at /dev/trpc following the same fractal pattern. And this /dev/mcp, the very first thing I want you to add is a mechanism to use all of the existing tRPC. I don't want that exposed in the same /mcp as the normal product level stuff. This is a developer only concern." [02/17]

- "Why on earth do we need to mount the dev/trpc there instead of just actually going through the existing tRPC? Don't over-complicate this." [02/17]

- "I need you to come up with a pattern that fits nicely into our existing infrastructure that allows the agents, like you, to use an MCP tool inside of the Dazzle repo that allows it to get the state of the running system as represented by YAML options. And I want this to be exposed as cleanly as possible within the fractal domain patterns we already have." [02/01]

- "We already have some MCP tooling at the root in MCP-dev. The problem is that doesn't have any hooks into the running system and it's quite separated from the product code base. And I want this to be a native part of the product code base." [02/01]

---

## 14. MCP Harness and Agent Testing

- "I'm trying to test different models running our new MCP server. I need something that runs more continuously and something that also allows me to test other models." [02/26]

- "I want to be able to very easily say things like you're simulating a user who is doing a very active back and forth like a game. You're simulating a user who's passively watching and wants a full episode of the story. You're simulating a user whose agent has tool calls for search. I want to be able to speak in plain language about a lot of these scenarios." [02/26]

- "I plan on basically having a dual approach where the model is executing and then I'm gonna probably ask Claude Code to look at the outputs. But the key for now is an abstraction that allows me to specify the model, the tools it has available, all this other stuff." [02/26]

- "We want to make sure that the timing in the logs is representative of elapsed content time because obviously the normal timestamps would be way too fast." [02/26]

- "We actually want to see the state of the session YAML because one of the main reasons we're doing this is to investigate the prompts we have for video generation, look at the guidance, look at what was said. We're not just investigating can an agent use tools, but we're also seeing what does Dazzle produce in response." [02/26]

---

## 15. MCP Server Best Practices and Research

- "I want you to write comprehensive documentation on all the latest best practices, guidelines, and methodology for running MCP servers. I want you to focus on how to be token efficient, how to best structure tool calls, how to best represent the kind of API we have as an MCP, aspects like authentication. I don't want you making any code changes right now. We're just in the midst of really intense planning." [02/16]

- "We're trying to drive the MCP towards really optimizing and owning, making our MCP implementation as nice as possible, just super clean and great." [02/18]

---

## 16. Boilerplate and Code Quality Complaints

- "I just hate with a fiery passion this whole looking up session ID then getting it from the runtime and then authorizing it. That whole path is both repeated and disgusting. We need to figure out how to use Effect services or some uniform way of doing that pattern because that's just unacceptable in every handler." [02/16]

- "The idea of having an effect -- it should just be an effect that knows what to do. Guidance set: if it's not running there should be X behavior, if it is running there should be Y behavior, but I just want one big effect for that. The consumer of the domain shouldn't know that much about how it works." [02/16]

- "Having all these want variables is weird, just do that inline. You don't need a whole bunch of variables. That could be done inline." [02/16]

- "There's far too much business logic in Stream Connect's handler. It almost feels like we need a domain for Stream." [02/16]

- "NO PASS DOWN CONTEXT VIA PROVIDE YOU DUMMY." [02/07]

- "In the agent tool calls, we can't use optionals. Refer to how the other agents handle this." [02/01]

- "The HUD agents, the executes for those tools are doing too much. We should have effects in the namespaces that own those operations that just thinly wrap. The tools are just a thin wrapper around effects like the other agents are." [02/01]

---

## 17. Multi-Agent Coordination and Workflow

- "I'm going to trigger two agents with those instructions. Give me a description for a third top-level thing and I'll be running four wide. We'll have three main work streams and I'll have one for random miscellaneous items, but you're going to be the ultimate coordinator." [02/18]

- "There is no 'this week.' We're doing this now. Quit underestimating how fast this goes." [02/18]

- "I want you to write a status markdown as you operate that other agents can look at to understand the state of what's going on. That's also going to serve as your primary working memory." [02/18]

- "I want you to go figure out how to analyze all of my Claude conversations so far that have been in the Dazzle code base and use embeddings and something like k-means to understand what groups of things do I keep coming back to, complaining about, trying to enforce, so we can extract either MCP rules, Claude updates to the agents, and just to better correct the tooling around LLM usage so that I have to say stuff less often." [01/31]

---

## 18. Agent-First UX and Onboarding

- "I want you to do deep research on the state of agent-first SaaS and agent-first platform offerings to make sure that we have a really well-designed UX for agents as customers that's equally as good as our UX for users as customers." [02/16]

- "Think about all the kinds of customers we're trying to serve. Make sure that the whole lifecycle from entering the site to watching content, to billing, to sharing, to running an audience, etc. is handled." [02/18]

- "The first principle is that Dazzle should always be trying to entertain someone. For some people, that means letting them steer, for some people, that means just letting them watch. For some people, that means interactivity." [02/18]

- "There is no such thing as a session without an agent, and it's not always running by default. If I'm using Claude Code to run my stream, Razzle is not involved at all." [02/18]

- "Research how other people do this [MCP setup]. Running npx? Absolutely fucking not. What is the most frictionless easy-to-use mechanism?" [02/16]

- "Yes, there should be a getting_started MCP prompt, and it should be basically something built in. We want the Dazzle agent to be aware of that too. Instead of over-optimizing on just Dazzle's agent, that should be something other agents can use." [02/16]

---

## 19. Context Management and History

- "We need to investigate how history compaction works to make sure that with this new MCP branch it actually is still performing history compaction. Then we also need to design safeguards to protect ourselves from getting more than a certain amount of context and just make sure we can't blow up the costs of either running Razzle or looking at context when other agents are calling." [02/26]

- "History compaction needs to be moved into something that the Razzle agent cares about, but ultimately, it's up to the individual calling agents to decide how history should be compacted." [02/16]

- "30 minutes [timeout] is a pretty long time. Think about this from first principles." [02/18]
