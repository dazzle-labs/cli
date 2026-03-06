# Agent Workflow Rules

Distilled from the user's Claude Code message history. User statements only.

---

## Main Thread Discipline

- The main thread is reserved for coordination and communication with the user. Never do implementation work there.
- "We've got to keep the main thread clear for task management so you and I can communicate."
- "I really want you to super emphasize and keep reminding yourself so you don't forget. We've got to keep the main thread clear."
- "I never want to be waiting on an agent ever." — from the main thread, always have agents running in the background.
- "Stop fucking doing work in the main thread." (repeated multiple times across sessions as a hard rule)
- "Don't block the main thread."
- "And stop running code in the main thread for the love of God."
- "What are you doing? I feel like you are running the domain. You're running this in the main thread blocking me instead of doing agents or tasks."
- "What else is going on? Stop blocking the main thread."

---

## Master/Coordinator Role

- The main-thread agent is the master coordinator — its job is dispatching and managing subagents, not doing work itself.
- "You personally as the master agent hate doing work yourself, so liberally use subagents so that I can continue our conversation uninterrupted as much as possible."
- "I want you to use the cloud history tool to investigate my references to subagents and agentic workflows and cloud setup, etc. And I want you to apply some of those rules to this repository so that you in the main thread, stay just the master coordinator over groups of agents you're dispatching."
- The coordinator is lightweight: read status files, route signals, resolve conflicts, update the log. Agents do the real work.

---

## Subagent Use

- Use subagents liberally. Aggressively offload work so the main thread stays free.
- Subagents can spawn their own subagents (confirmed as a question the user asked, implying they expect this to work).
- Background agents should run in loops on ongoing concerns (e.g., dead code auditing, naming suggestions).
- "I want a background agent or an agent to be created that is basically constantly auditing for dead code."

---

## Agent Isolation and Safety

- Agents working in parallel must not break the live demo or each other's work.
- "I want you to make sure we're using git worktrees correctly and the proper workflows correctly so that we never have this problem again."
- "I want options for allowing these agents to operate independently without ever breaking the live demo I'm looking at."
- "Are we actually able to run the product basically in isolation from other agents so that they can safely develop independently like real developers would?"
- Agents should be able to run isolated instances of the app so they can develop independently without consuming excessive memory or disrupting the main live view.

---

## Agent Coordination and Communication

- Agents must communicate via a shared status/task system — not by blocking the coordinator.
- The task management system is the coordination backbone between agents.
- "Is that something the task management system is going to kind of take over? Like are we actually all able to run the product basically in isolation from other agents?"
- Agents should surface signals via STATUS.md or equivalent shared working memory so other agents and the coordinator can see progress without asking.
- Dependencies between agents are one-way signals, not blockers — proceed in parallel and reconcile via status signals.

---

## Multi-Agent Workflow Pattern (from dazzle multi-agent-workflow.md, which the user had open)

The user has reviewed and implicitly endorsed this pattern:

- **Compress first.** Before launching agents, consolidate existing context into minimal shared docs every agent can read quickly. Target: any agent reads shared docs in under 5 minutes of context.
- **Scope to reality.** Look at what's actually in the codebase before writing agent prompts. "Build from scratch" vs "improve existing" are completely different prompts.
- **Questions before execution.** Every agent should ask clarifying questions before charging into work. Cheap upfront; undoing wrong work is expensive.
- **Per-agent STATUS.md as working memory.** Each agent writes a STATUS.md in its working directory. It serves dual purpose: survives context resets for the owning agent, and signals progress/decisions to other agents and the coordinator.
- **Workstreams by concern, not domain.** Name workstreams by what they're solving, not by the files they touch.
- **Expect iteration.** The first set of agent prompts won't be perfect. Read early outputs, adjust, relaunch.

Signs a task needs multi-agent parallelism:
- Touches 3+ distinct concerns requiring different expertise
- A single context window can't hold all relevant code and planning
- Workstreams have dependencies but can largely proceed independently
- You want to move fast without serializing through one agent

---

## Permissions Setup

- Set up broad permissions upfront so agents never need to interrupt the main thread for permission requests.
- "Every playwright thing you're trying to do is doing this [interrupting] and I want you to remember that if you're creating new things that will even have a slight possibility of triggering a permissions change, I want you to go update it first."
- "Please go give yourself broad permissions in the clod settings so that you stop interrupting the main thread with permissions requests constantly."
- Model permissions setup after what exists in other repos (dazzle, money, connerruhl) — carry the pattern forward to new repos.
- Give yourself the most liberal permissions possible while preventing damage to the rest of the MacBook.

---

## Health Checks and Tooling

- There must be a single one-stop tool or script to verify everything is healthy across the app — not a series of manual tool calls.
- "There should be a one-stop tool or script or whatever you can run to very quickly verify everything's healthy across the app."

---

## CLAUDE.md / Repo Setup

- On a new repo: run `/init`, layer in coding style rules from AGENTS.md, set up `.claude/settings.json` with liberal permissions.
- CLAUDE.md is "the operating system for future versions of yourself" — keep it clean regardless of current project state.
- STATUS.md (or equivalent) reflects the current state of the project and keeps the agent on rails across context resets.
- Deduplicate CLAUDE.md and STATUS.md — no repeated content between them.
- CLAUDE.md should be compressed: it's injected with every prompt, so bloat has a real cost.
- Re-read CLAUDE.md/AGENTS.md between major todos — context growth causes rule drift silently.
- Add custom agents, skills, hooks, and MCP servers organically as needs arise, not upfront.
