# Billing, Pricing & Monetization -- Distilled User Statements

Extracted from claude-history search results. Only Conner's (the user's) statements about billing, pricing, Stripe, usage-based billing, costs, monetization, and business model. Grouped by topic, deduplicated.

---

## Cost Structure & Unit Economics

- "Our costs right now per GPU hour $3 depending on the serverless market." [02/02/2026]
- "I want to put in our estimated cost per hour plus LLM spend. Right now is about $3 per 45 minutes, so do the math." [02/02/2026]
- "Our total streaming cost is $4/hr including LLM spending." [02/02/2026, investor update]
- "That's the $4 an hour, you know, within reason like LLM costs for the GPU, it's really like five, maybe four, anywhere from three and a half to four on GPU, five with LLM costs." [03/02/2026]
- "Our cost for Chrome is going to be ridiculously cheaper because it's just CPU." [03/02/2026]
- "We're rendering in a web sandbox through Chrome which we expect to cost around ~$0.10/hr versus $3.50-5/hr on GPU with LLM costs. That means we can do one stream per user, or even many streams per user, instead of sharing one stream across many viewers." [03/02/2026, investor update]
- "We're basically paying between three to four dollars an hour right now for one GPU all the time every time." [03/02/2026]
- "At $10/hr per stream the math requires a lot of viewers, and shared streams need to actually be good." [03/02/2026, investor update]
- On Fal comparison: "On Fal, the same LTX2 request takes ~13.32 seconds and costs $0.06 for a 4-second clip. Our setup runs on a flat ~$3/hour GPU spend." At 2x real-time: ~0.17 cents per 4-second clip (~35x cheaper). At 1x real-time: ~0.33 cents per 4-second clip (~18x cheaper). [02/02/2026]
- "If multiple people share the same stream, our cost per user-hour goes down the more people are watching." [02/02/2026]

## Pricing Model & Billing Strategy

- "The first thing we're going to charge for is usage-based streaming on your own channel. Anyone can create and set up a channel, but the streaming itself is what costs money." [02/02/2026, investor update]
- "The overall plan is to figure out easy-to-communicate usage-based billing, similar to what's become the norm on other platforms. We can already dynamically scale the number of streams and run multiple streams per server. What remains is building out the management layer and Stripe integration." [02/02/2026, investor update]
- "We haven't fully decided on the pricing model here yet, and it'll be a variant of one of the following: we're going to make sure all of our costs are accurately reported over the duration of a stream, and then we have the ability to either say 'Hey, users, this is a per unit of time, here's your cost plus some margin we set to obviously have the streams be profitable,' or we could actually sum up the real usage including LLM costs so that the users are getting costs that's much more granular, broken down by their actual usage times some margin." [02/02/2026]
- "Effectively what we'll be doing is hopefully building streams out such that if they're entertaining the people, people can simply just purchase them and pay for them based off their usage." [02/02/2026]
- "What remains there is to build out some of the CRUD around managing streams and letting users actually pay via Stripe for streams." [02/02/2026]
- "We gave Bill testing credits at that price point and he said he would pay that, but no, he didn't actually get -- he was obviously using free credits." [03/02/2026]
- "We also shipped usage-based billing with Stripe so anyone can pay for stream time." [03/02/2026, investor update]

## Revenue Strategy & Business Model

- "For the first time, we think we have a way to turn raw GPU time into payments with a profit margin. X amount of GPU time produces Y amount of direct profit, and we just need to grow the number of people on GPUs to stop burning money." [02/02/2026]
- "The question is how quickly we can find our first group of users who love real-time generation and build something that keeps them coming back." [02/02/2026]
- "We think the streams are interesting enough now to get some people paying for the novelty, but we're acting as if we're going to figure out something that makes it very sticky. If we can do that with payments infrastructure in place, we're in a good spot." [02/02/2026, investor update]
- "Our confidence is increasing that we can deliver a streaming AI experience that's worth paying for if we find the right people to test with, refine the capabilities of the product and improve the quality and just make it brain dead simple to pay for." [02/02/2026]
- "The idea of agents as users is becoming more interesting to us. With the whole OpenClaw agent explosion happening, we think there's a real potential market for portions of the product that could be sold directly to agents. Something like an agent that has its own live stream and can just pay for it over time." [02/02/2026, investor update]
- "Right now, humans are driving the agents and paying for usage, so streams ultimately need to be visually interesting for people, but we think the long-term audience is mostly agents consuming other agents' streams." [03/02/2026, investor update]
- "Agent operators as customers completely sidestep the anti-AI backlash problem since they're people who are already deeply invested in AI and spending real money on it." [03/02/2026, investor update]
- "Compared to normal consumers who are passively watching, these are people already willing to spend real money on AI, with power users at $200-500/day on LLM costs. We're looking for first testers among power users and people who've already been creating content with their agents." [03/02/2026, investor update]

## Billing Domain Architecture (Dazzle Codebase)

- "We need to spike out some new domains and get the scaffolding ready and update some stuff in the front end related to billing. What we're gonna do is make TV.Usage the canonical source of truth for all of the actual spending, the real true costs in the product for a given amount of time for a session." [02/04/2026]
- "We want to take out into a whole new domain a billing concept which will represent a couple things. To start there will be a Billing.Pricing which is where we will transform our usage into a final price." [02/04/2026]
- "Local pricing on the session along with local usage on the session such that I can see the actual spending only in localhost or on development. The actual usage, and I want to see on pricing a number that's based on a multiple." [02/04/2026]
- "From multiple tracks usage and then converts it into just raw spending, and from content we'll compute it from the actual amount of videos we have on the timeline so far." [02/04/2026]
- "We're gonna have Stripe integration and we're gonna need a domain Billing.Payment and payments to represent our knowledge of payments that have happened in Stripe." [02/04/2026]
- "Billing.Account is where we're gonna actually be able to ask for a given account what their balance is. It is not gonna be a database thing for now. It's gonna correlate one to one with a user for now, but that's kind of what it is meant to represent -- like a billing entity, something we can charge." [02/04/2026]
- "On the front end I want it to display the pricing that is derived from 'from content' as the actual final user-displayed one and that's the only thing that should be available in prod. But when I'm developing on local and not production I want there to be a dev tools panel that shows the actual all of the other information we have on the developer side." [02/04/2026]
- "Pre-fill the billing panel with $10 or $5." [02/13/2026]

## Billing PR Feedback (Architecture Decisions)

- "Don't attach members to the singular -- Members is just exported as a plural sibling." [02/06/2026]
- "Start customer ID should be ID. I prefer to put the look up of the account into the main create effect so it can take an account ID or user ID and handle that in there. Just so we don't have to put so much in the TRPC." [02/06/2026]
- "Something I prefer more is where these database reads we're doing -- we either get real type safety or use Zod schemas to read the results. Just worry that we might end up casting something and actually cause a billing mistake because it's not properly type checked." [02/06/2026]
- "We could use Zod branded type for USD -- might be worth looking into." [02/06/2026]
- "For the payment webhook, I would prefer we move almost all of the async logic into an effect and then just have the handler be a thin wrapper around the effect like we do with TRPC." [02/06/2026]
- "For currency USD, create dollars that allows you to think in dollars." [02/06/2026]
- "Instead of there being a reconciled cost and billing account ID, I would just put right under render a billing type -- a Billing.Runtime that will be the type we put to hold those two values." [02/06/2026]
- "I want the start domain to be as clean as possible and not to put really any information in it that could be owned by the billing domain directly. Same thing with stop -- I don't want stop to really have that much knowledge at all of what billing is actually doing." [02/06/2026]
- "You should probably have a TV.Billing which is the more specific instance of the outer Billing which handles the runtime type, the start, the stop, the reporting -- just using the primitives in the global Billing." [02/06/2026]
- "Pull everything Stripe related to a Billing.Stripe domain just so we have that centralized." [02/06/2026]
- "For Stripe customer ID, I want there to be a Billing.Stripe.CustomerID. Same with payment intent IDs. Basically anything that could be a branded type in Stripe, I want to know about it in the type scheme itself." [02/06/2026]
- "Redis keys -- I don't like Balance.keys like that. Make it a domain Keys domain under there and export functions from that domain." [02/06/2026]
- "The actual values of the keys should prefer the usage of domain syntax like we have on the effect spans to have a one-to-one relationship with the actual domain hierarchy." [02/06/2026]
- "TV.Billing -- I actually want it to exist on the session. We're going to persist it and it should be similar to usage in that regard." [02/06/2026]
- "TV.Billing start -- it is more like an initial, like the other ones. And for stop, don't accept stuff as arguments -- just get it from the dependency injection from the runtime." [02/06/2026]
- "We should always have a billing on the session. Just do like a TV.Billing.empty." [02/06/2026]
- "If you still need to reference the global billing anywhere, just import it as generic billing or as GenericBilling." [02/06/2026]
- "We also don't need them [Keys] to be fully separate files." [02/06/2026]
- "The key should follow the domain syntax as much as possible without breaking Redis functionality, just like we do with the spans." (e.g., `Billing.Credits.Balance.{accountID}`) [02/06/2026]

## Billing Panel UX

- "The layout for the billing panel sucks. Use normal buttons. In light mode, it looks terrible. Make sure you're using actual Theme.Buttons. The custom amount is weirdly scrunched up against the bottom. Rethink from first principles how this design should go." [02/13/2026]
- "Just have a section there called custom amount and also these buttons still look terrible. Refer to how custom content works with the template buttons in channel create. Let's just do a section that's always there -- just custom amount." [02/13/2026]
- "The buttons for this still look really awful. Also these tildes everywhere, just kind of gross looking. The price should be bigger. It should match the size of the custom amount. The timing estimate should be the same size between balance and add credits. Custom amount should have an estimate underneath of it. I want a new estimate component that has an info icon and a tooltip that's like 'this is based on the average cost of streaming.' Center the prices, make them bigger. We don't need cents markers after the prices. Make the prices the same size as the balance, same size as the custom amount." [02/13/2026]
- "I don't want to say 'of streaming.' The text should still be centered inside of them and use themed-up buttons for spacing. All the text underneath of them for the estimate should be using the same estimate component. Let's make the panel a bit wider. I want the balance number to be right-aligned. Make sure you're using the margins from the typography correctly and not doing anything custom there." [02/13/2026]
- "I want the estimates to be inside the headers for Add Credits and Custom Amount, and it should change based off what's being selected or entered. Also remove from Theme.Input the up and down arrows you get from the native number input." [02/13/2026]
- "Make the balance the same weight as Add Credits and Custom Amount." [02/13/2026]
- "Restyle the recent payments section to match how I've styled the rest of the billing panel. And a balance section like we used to have above Add Credits. I want the font size to be the same as Add Credits and Custom Amount sizes." [02/13/2026]
- "Don't show the last divider in billing if we have no recent payment history." [02/13/2026]
- "Simulate recent payments so I can see what it would look like with a couple different kinds." [02/13/2026]
- "I'm getting errors when I try to make a purchase of credits, either custom or the buttons. Go figure out what's happening and then audit that domain for any other issues in the front end." [02/13/2026]
- "Go use your marketing psychology tool to verify that all the communications we have around pricing are optimal and suggest improvements." [02/13/2026]

## Time-Based Billing Display

- (From UX agent instructions): "Implement Batch 2 -- Gap #5: Time-Based Billing Display. This is the '~45 min remaining' display that replaces dollar amounts." [02/18/2026]

## Stripe Setup (Money/Stream Project)

- "I also want an agent that's dead focused on getting us into production and figuring out everything we need to do to make this app real from authentication to user management to Stripe setup to billing the full lifecycle." [03/01/2026]
- "I do have a Stripe account that I can use. And if you need to reference the keys for that, I give you permission to go look up the Dazzle repo's environment keys." [03/01/2026]

## Cash Position (Investor Updates)

- Cash: $174,552.69 [02/02/2026]
- Cash: $145,712.09 [03/02/2026]
