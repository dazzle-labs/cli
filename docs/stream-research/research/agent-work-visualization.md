# Visualizing a Coding Agent's Work as a Live Stream

Research into what makes an AI coding agent's work visually interesting, watchable, and shareable as a live stream. The target: "Imagine Claude Code; you're not just seeing a terminal UI stream past, you get a really nice visual depiction of what the agent is doing as a polished stream you can watch and share."

---

## 1. What a Coding Agent Actually Does (The Raw Material)

A coding agent's work breaks down into discrete, observable phases. Each phase has different visual characteristics, different pacing, and different levels of inherent drama. Understanding these phases is foundational; the visualization system needs to handle each one differently.

### Phase 1: Orientation and Reconnaissance

The agent starts by reading. It opens files, searches for patterns, traces imports, maps the codebase. This phase is fundamentally about building a mental model of what exists.

Observable events:
- File reads (path, language, size, how much was read)
- Glob/find operations (pattern used, number of matches)
- Grep/search operations (regex pattern, match count, matched files)
- Directory listings
- Git log/blame/diff queries

Visual character: Expansive. The agent is casting a wide net. Many files are touched briefly. The "camera" should be wide, showing the forest, not the trees. This is the "detective arriving at the scene" moment.

### Phase 2: Reasoning and Planning

The agent synthesizes what it learned into a plan. In Claude Code, this often happens within the model's thinking/reasoning, and may or may not be surfaced as visible text. The agent might produce a plan in prose, or might just start executing.

Observable events:
- Reasoning text (if surfaced)
- Enumeration of tasks or steps
- Decision points (choosing between approaches)
- Questions asked to the user

Visual character: Introspective. This is the "whiteboard moment." Text-heavy, but the text itself is the content. Good visualization here could show the agent's plan forming, with connections being drawn between concepts.

### Phase 3: Implementation

The agent writes code. This is the most visually rich phase because code is inherently visual; it has structure, syntax highlighting, indentation, and the diff between before and after is immediately meaningful.

Observable events:
- File creates (new file, language, initial content)
- File edits (old text, new text, surrounding context)
- Multi-file coordinated changes
- Import/dependency additions
- Test file creation alongside source files

Visual character: Focused and productive. The "camera" should be tight on the code being written. Syntax highlighting is essential. The diff should be the hero visual. This is where the satisfaction of watching code come together lives.

### Phase 4: Verification

The agent runs its work. Tests, builds, linters, type checkers. This phase has binary outcomes (pass/fail) and creates natural dramatic tension.

Observable events:
- Shell command execution (npm test, cargo build, etc.)
- Test results (passed count, failed count, error messages)
- Compiler/linter output
- Retry loops (fix, re-run, fix again)

Visual character: Dramatic. Green checks and red Xs are universally understood. The build-up to a test run, the pause while it executes, and the reveal of results is a natural narrative beat. Repeated failures and fixes create genuine tension.

### Phase 5: Iteration and Debugging

When things go wrong, the agent enters a debug cycle. This is often the most interesting part of an agent session for technical viewers because it reveals problem-solving strategy.

Observable events:
- Error message analysis
- Targeted file reads (investigating the bug)
- Hypothesis formation (reasoning about what went wrong)
- Targeted edits (fixing specific lines)
- Re-verification

Visual character: Intense. Faster cuts between reading and editing. Error messages highlighted in red. A "narrowing" visual metaphor works well; the search space gets smaller with each iteration.

### Phase 6: Completion

The agent wraps up. Final verification passes. A commit is created. The task is done.

Observable events:
- Final test pass
- Git add/commit (files staged, commit message)
- Summary of what was accomplished

Visual character: Resolution. The satisfying payoff. All tests green. The commit message is the closing statement. This is the "shareable moment" people will clip and post.

---

## 2. The Narrative Arc Problem

Raw agent events are not a story. They are a log. The fundamental challenge is transforming a sequence of tool calls into something that feels like watching someone work.

### Why Terminal Output Is Boring

Terminal UIs fail as entertainment because:
- Text scrolls at an unreadable pace; nothing is emphasized
- There is no spatial memory; everything is just vertical scrolling
- Visual uniformity; everything looks the same regardless of importance
- No sense of progress or structure; you can not tell how far along you are
- No differentiation between thinking and doing

### The Problem-Solving Narrative

Every coding task has a natural story structure that the visualization should amplify:

1. **Setup**: What is the task? What does the codebase look like? (Orientation)
2. **Rising action**: The agent explores, forms hypotheses, makes plans (Reconnaissance + Planning)
3. **Climax**: The implementation itself, the creative act (Implementation)
4. **Crisis**: Something goes wrong; tests fail, types break (Verification failure)
5. **Resolution**: Debug, fix, verify, succeed (Iteration + Completion)

The visualization system should recognize which phase the agent is in and adjust its visual treatment accordingly. Not every session will hit every beat, but the system should be ready for any of them.

### Pacing and Rhythm

A coding agent generates events at wildly varying rates. During a search phase, dozens of file reads might fire in seconds. During implementation, there might be one large edit followed by a long pause for reasoning. The visualization must:

- Aggregate rapid-fire events rather than showing each one individually
- Expand important moments (the critical edit, the test result)
- Compress boring stretches (reading 30 configuration files)
- Create visual breathing room between major phases

This is analogous to video editing; the raw footage is hours long, but the edited version compresses, expands, and emphasizes to create rhythm.

---

## 3. Visual Metaphors and Design Approaches

### 3.1 The Workspace Metaphor

Instead of a terminal, present the agent's work as a visual workspace. Think of a developer's multi-monitor setup rendered as a designed layout:

**Primary panel**: The current focus. When reading, it shows the file with the relevant section highlighted. When editing, it shows the diff with syntax highlighting. When running tests, it shows the test output.

**Context panel**: What the agent is thinking about. During reconnaissance, a minimap of the file tree with recently-touched files highlighted. During implementation, the plan or task list. During debugging, the error message being investigated.

**Activity feed**: A compact log of recent actions, styled more like a timeline than a terminal. Each entry is one complete thought: "Read src/auth/middleware.ts (looking for session handling)" rather than raw tool call parameters.

**Progress indicator**: Where in the task are we? How many files changed? Tests passing? Time elapsed?

This four-panel layout can be the "home base" that the visualization always returns to, with individual panels getting temporarily expanded for important moments.

### 3.2 The Code Canvas

Present the codebase as a spatial map, inspired by Gource and code city visualizations:

- Files as nodes arranged by directory structure
- Active files glow or pulse
- Edit operations create visible ripples from the changed file outward through its dependents
- The "camera" follows the agent's attention, zooming into the area of the codebase being worked on
- Connection lines show imports/dependencies that light up when the agent traces a call path

This is more abstract but creates genuinely beautiful visuals. The risk is that it is hard for viewers to read actual code in this format. It works best as a supplementary view or as the "zoomed out" perspective during reconnaissance phases.

### 3.3 The IDE View

The most literal approach: show what the agent would see if it were using a real IDE. Syntax-highlighted code, file tabs, an integrated terminal, a file explorer sidebar.

Advantages:
- Immediately legible to technical viewers
- Code is readable at full resolution
- Familiar layout reduces cognitive load

Disadvantages:
- Looks like a screen recording, not a designed experience
- Hard to make this feel "polished" without it becoming uncanny valley
- Non-technical viewers get nothing from this

The IDE view works best as one mode that the system can switch to during implementation and debugging phases, not as the default state.

### 3.4 The Story Mode

An opinionated, editorial presentation that treats the agent's work as a documentary:

- Large-format text cards introduce each phase: "INVESTIGATING: Authentication Middleware"
- Code snippets are shown as designed cards with syntax highlighting, not raw editor views
- The agent's reasoning is presented as narration text (think nature documentary subtitles)
- Test results are shown as dramatic reveals with appropriate animations
- Transitions between phases use meaningful visual metaphors (zooming into a file, pulling back to show the tree)

This is the most "streamable" format. It works for both technical and non-technical audiences because the editorial layer provides context. The tradeoff is that it requires the most interpretation; the system must decide what is important and how to frame it.

### 3.5 Hybrid: Adaptive Layout

The strongest approach is probably a hybrid that adapts based on phase:

| Phase | Primary View | Secondary | Treatment |
|-------|-------------|-----------|-----------|
| Orientation | File tree / codebase map | Activity feed | Wide, scanning, many small updates |
| Planning | Reasoning text, task list | Relevant code snippets | Calm, deliberate, text-forward |
| Implementation | Syntax-highlighted diff | File context, plan progress | Focused, productive, code-forward |
| Testing | Test output / result dashboard | Source code being tested | Dramatic, binary outcomes |
| Debugging | Error + relevant code | Stack trace, hypothesis | Intense, narrowing, investigative |
| Completion | Summary card, commit message | Stats (files changed, tests passed) | Satisfying, resolved, shareable |

Transitions between phases should be smooth but noticeable. A color temperature shift, a layout transition, a brief title card. The viewer should feel the rhythm of the work.

---

## 4. Specific Visual Components

### 4.1 Syntax-Highlighted Code Display

The single most important visual component. Requirements:

- Full syntax highlighting for all major languages
- Diff rendering: deleted lines in red, added lines in green, with smooth transitions
- Line number display with focus indicators
- Ability to highlight specific ranges (the part the agent cared about)
- Smooth scrolling/zooming to relevant sections
- Typography optimized for readability at stream resolution (1080p minimum)
- Dark theme default (this is a stream, not a document)

For Remotion/React rendering, libraries like Shiki (used by VS Code) or Prism provide token-level syntax highlighting that can be styled and animated.

### 4.2 File Tree Visualization

Show the project structure with real-time indicators:

- Currently active file highlighted (bright)
- Recently touched files warm (dimming over time)
- Modified files marked (with change count)
- New files have an "appearing" animation
- Deleted files have a "fading" animation
- Directories collapse/expand to show relevant areas
- Indentation lines connect parent/child relationships

Can be rendered as a traditional tree (left sidebar style) or as a radial/force-directed graph for more visual interest.

### 4.3 Test Result Dashboard

A dedicated visual for test runs:

- Progress bar during execution
- Individual test names appearing as they run
- Pass/fail indicators (checkmarks and Xs) with color
- Aggregated summary: X passed, Y failed, Z skipped
- Failed test detail: test name, expected vs actual, relevant code location
- History: if the agent runs tests multiple times, show the trajectory (first run: 3 fail, second: 1 fail, third: all pass)

This creates natural drama and is universally understandable even without knowing the language.

### 4.4 Agent Reasoning Panel

Surface the agent's "thinking" as readable text:

- Stream the reasoning text in real-time (even if it arrives in chunks)
- Use a typewriter or fade-in effect for new text
- Key decisions or conclusions highlighted
- When the agent asks a question, present it prominently
- When the agent makes a plan, render it as a structured list with checkboxes that get completed as work progresses

This is the component that makes non-technical viewers able to follow along. Even if they can not read the code, they can read "I need to fix the authentication middleware to properly handle expired tokens."

### 4.5 Terminal Output Display

For bash commands and their output:

- Show the command being typed (with a prompt indicator)
- Output streams in with appropriate formatting
- Error output styled differently (red text, warning icon)
- Long output auto-collapsed with a "see more" indicator
- Command status: running (spinner), succeeded (green check), failed (red X)

### 4.6 Git Visualization

For commit operations:

- Staged files shown as a list with diff stats (+/- lines)
- Commit message prominently displayed
- A visual "commit" animation (the changes "sealing" into history)
- Branch/history context if relevant

### 4.7 Progress and Statistics HUD

Persistent overlay elements:

- Task description / goal
- Time elapsed
- Files read / files modified counters
- Current phase indicator
- Test pass rate (when applicable)
- Lines of code written (cumulative)

This provides ambient context without demanding attention.

---

## 5. What Makes It Not Boring

### 5.1 Motion and Transitions

Static layouts are boring. The visualization needs motion:

- **Panel transitions**: when the agent shifts focus, panels should animate (slide, fade, morph)
- **Code scroll**: smooth scrolling to new locations, not instant jumps
- **Typing animation**: code appearing character-by-character or line-by-line (even though the agent writes it all at once; the visual can be staged)
- **Zoom effects**: pulling back to show the tree, pushing in to show specific code
- **Particle/glow effects**: subtle ambient motion in the background, glows on active elements
- **Progress animations**: counters ticking up, bars filling, status indicators transitioning

### 5.2 Information Density Variation

A stream that maintains the same information density throughout is monotonous:

- **Dense moments**: during rapid file reads, show many small panels, fast transitions, lots of indicators updating
- **Sparse moments**: during reasoning or a single big edit, slow everything down, let the code fill the screen, give the viewer time to read
- **Punctuation moments**: test results, error discoveries, and completions should be full-screen, dramatic, brief

This variation creates rhythm. Think of how a well-edited YouTube video varies between talking-head, screen capture, animated explainer, and b-roll.

### 5.3 The Dramatic Beats

Certain events are inherently dramatic and should be treated as such:

- **First test failure**: the moment everything breaks. Red flash, prominent error display, a clear "uh oh" beat before the agent starts debugging.
- **The breakthrough**: when the agent identifies the root cause. Highlight the line, the reasoning text, the connection being made.
- **All tests pass**: the payoff. Green everywhere, maybe a brief animation, stats summary, a moment of victory.
- **The unexpected find**: when the agent discovers a bug or issue it was not looking for. A "wait, what's this?" moment.
- **Completion**: commit message on screen, final stats, the closing shot.

These moments are what make someone keep watching. Between them, the stream needs to be visually pleasant but does not need to be gripping.

### 5.4 Audio

Sound design dramatically affects watchability:

- **Ambient**: lo-fi beats, soft electronic music, or generative ambient sound
- **Event sounds**: subtle click/keystroke sounds for file operations, a satisfying "ding" for test passes, a muted "thud" for failures
- **Transitions**: brief sound effects for phase changes
- **TTS option**: the agent's reasoning could optionally be read aloud (with a pleasant synthetic voice), turning the stream into a podcast-like experience

Audio is what keeps a stream running in the background while you do other things. Without it, the stream has no ambient presence.

### 5.5 Contextual Narration Layer

Beyond raw reasoning text, the system could generate editorial narration:

- "The agent is now examining the test suite to understand how authentication is currently validated."
- "Found 3 files that handle token refresh. Comparing approaches..."
- "All 47 tests passing. This implementation added 230 lines of code across 5 files."

This narration can be generated from the structured event data without requiring the coding agent itself to produce it. A secondary LLM (small, fast, cheap) can translate tool calls into human-readable commentary.

---

## 6. Existing Art and Inspiration

### 6.1 Gource (Git History Visualization)

Gource renders git history as an animated tree where:
- Users appear as avatars
- Files orbit around a central point organized by directory
- Commits cause files to light up and users to move
- The passage of time is compressed and animated

Key insight from Gource: **spatial arrangement of code creates a persistent visual identity for the project**. Viewers develop spatial memory; "that cluster on the left is the auth module." This makes changes in familiar areas feel grounded.

What to borrow: spatial memory, the idea that files have positions and relationships, smooth temporal compression.

What to avoid: Gource is purely retrospective and becomes monotonous after 60 seconds. A live agent stream needs more variety.

### 6.2 GitHub Skyline / Contribution Graphs

GitHub's contribution graph (the green squares) and Skyline (3D printed contribution history) work because:
- They compress massive amounts of data into a single visual
- They create a "shape" that represents activity patterns
- They are instantly shareable as images

Key insight: **aggregate statistics can be beautiful**. A coding session could accumulate its own "skyline" showing lines written over time, files touched, test results, etc.

### 6.3 Algorithm Visualizations

Sites like VisuAlgo and algorithm visualizers work because:
- They show the "why" behind each step, not just the "what"
- Color coding maps to meaning (red = active, green = sorted, gray = untouched)
- Animation speed is controllable; the viewer can follow the logic
- The state of the entire system is visible at once

Key insight: **making the internal state visible is what creates understanding and interest**. For a coding agent, the internal state is: what files does it know about, what is its current hypothesis, what has it tried, what remains.

### 6.4 Live Coding Streams (Twitch/YouTube)

The most directly comparable existing content. What keeps people watching human coding streams:

- **Personality and narration**: the streamer talks through their thought process
- **Problem-solving in real time**: the viewer gets to see the human struggle and overcome
- **Learning opportunity**: viewers learn techniques and approaches
- **Community interaction**: chat helps debug, suggests approaches
- **Milestone moments**: "it works!" celebrations
- **Background companionship**: many viewers are coding themselves and have the stream as ambient company

For an AI agent stream, the narration comes from the reasoning text. The problem-solving is visible through the tool calls. The milestone moments happen naturally. What is missing is the human personality and the community interaction; the chat and the audience features in dazzle.fm fill this gap.

### 6.5 Remotion Motion Graphics

Remotion enables React-based video creation. People building with Claude Code + Remotion are creating:
- Data visualizations with animated transitions
- Explainer videos with code walkthroughs
- Dashboard-style presentations with live data

Key insight: **React-rendered content can look as polished as After Effects output** when the components are well-designed. The component library IS the production value.

### 6.6 VS Code Extension: CodeTour / CodeStream

These extensions create guided walkthroughs of codebases. Relevant ideas:
- Steps through code with annotations
- Highlights specific lines with explanations
- Creates a narrative through a codebase

Key insight: **annotated code is more interesting than raw code**. The agent's reasoning IS the annotation.

### 6.7 Cursor / AI IDE Interfaces

AI-native IDEs like Cursor show multi-file edits with inline diffs. Their interfaces surface:
- Which files are being changed and why
- Before/after comparisons inline
- The agent's plan as a sidebar

These are optimized for a developer using the tool, not for a viewer watching a stream, but the information architecture is relevant.

---

## 7. Data Model: What the Coding Agent Must Emit

For this visualization to work, the coding agent needs to emit structured events. Here is the minimum event taxonomy:

### Core Events

```
FileRead { path, language, lineStart?, lineEnd?, reason? }
FileSearch { pattern, matchCount, matchedFiles[] }
FileWrite { path, language, oldContent?, newContent, isNew }
FileDelete { path }
BashCommand { command, status: running|success|failure, output?, exitCode? }
Reasoning { text, phase?: orientation|planning|implementation|debugging }
ToolCall { name, args, result?, duration? }
TestRun { framework, total, passed, failed, skipped, failures[]? }
GitOperation { type: add|commit|push|diff|log, details }
Error { message, source, severity }
TaskUpdate { id, description, status: planned|active|complete|failed }
PhaseChange { from, to, reason? }
```

### Enrichment Events (Optional, for Richer Visualization)

```
DependencyTrace { from, to, type: import|call|inherit }
HypothesisForm { hypothesis, confidence, evidence[] }
DecisionPoint { options[], chosen, reasoning }
ProgressUpdate { taskId, percentComplete, metric, value }
Milestone { type: firstTest|allPass|firstCommit|complete, stats }
```

### How This Maps to Dazzle's Architecture

Given Dazzle's existing architecture, the coding agent stream would flow as:

1. The coding agent (Claude Code or similar) connects to Dazzle via MCP
2. As it works, it calls MCP tools that map to the events above
3. Dazzle's renderer receives these events and maps them to visual components
4. The React app in the Chrome sandbox renders the visualization
5. The Chrome output is streamed to Twitch/YouTube/dazzle.fm

The MCP tool surface for a coding agent stream might look like:

```
stream_event(event)          -- emit a structured work event
stream_phase(phase, reason)  -- signal a phase transition
stream_highlight(content)    -- push something to the hero panel
stream_narrate(text)         -- add editorial narration
stream_stats(stats)          -- update progress/statistics
style_set(style)             -- set visual style overrides
```

Alternatively, if the goal is to make this as frictionless as possible for agent operators, the MCP could accept raw Claude Code tool-call events and the rendering layer interprets them. This means the agent does not need to know about visualization at all; it just does its work, and Dazzle observes and renders.

This "passive observation" model is more aligned with the founder's vision: "Imagine Claude Code; you're not just seeing a terminal UI stream past, you get a really nice visual depiction." The agent does not change its behavior; the visualization layer interprets its existing output.

### Passive vs Active Event Emission

Two approaches:

**Passive (intercept)**: The coding agent works normally. An MCP middleware or hook intercepts tool calls (file reads, writes, bash commands) and forwards them to Dazzle as visualization events. The agent has zero awareness of the stream.

Advantages: Zero friction for the agent operator. Any Claude Code session can become a stream. No special prompting or tool surface needed.

Disadvantages: The visualization has less context. It does not know why the agent is reading a file, just that it read one. Reasoning text may or may not be available.

**Active (deliberate)**: The agent has Dazzle-specific tools and is prompted to use them. It can annotate its work, signal phase transitions, add narration.

Advantages: Much richer visualization. The agent can highlight what matters.

Disadvantages: Requires agent operators to configure their agent with Dazzle tools and adjust prompting. More friction.

**Hybrid (recommended)**: Support both. Passive interception works out of the box with any agent. Active tools are available for operators who want richer streams. The rendering layer should be able to produce a good visualization from passive events alone, with active events enhancing it when available.

---

## 8. The Dual Audience Problem

### Technical Viewers

Want to see:
- Actual code, readable, with syntax highlighting
- The specific changes being made (diffs)
- Command output and error messages
- The agent's reasoning and decision-making
- Architecture and dependency relationships

Do not want:
- Oversimplified narration that hides the details
- Animations that get in the way of reading code
- "Dumbed down" explanations

### Non-Technical Viewers

Want to see:
- What the agent is working on (in plain English)
- Whether things are going well or poorly (visual indicators)
- Progress toward a goal
- The "story" of the problem-solving process
- Pretty visuals that feel like watching someone work

Do not want:
- Raw code they cannot understand
- Technical jargon without context
- Static screens full of text

### Serving Both

The solution is **layered information density**:

1. **Background layer**: Always present. Progress indicators, phase labels, activity heat. Serves non-technical viewers.
2. **Content layer**: The actual code, diffs, terminal output. Serves technical viewers. Occupies the majority of screen space.
3. **Context layer**: Narration, reasoning summary, "what's happening now" labels. Serves both audiences differently; technical viewers skip it, non-technical viewers rely on it.
4. **Ambient layer**: Motion, particles, glow effects, color shifts. Creates atmosphere for all viewers. Keeps the stream visually alive during low-activity periods.

The system should lean toward showing code (the content layer) because the primary audience is agent operators and developers. But the context and background layers ensure that anyone glancing at the stream can understand what phase the work is in and whether things are going well.

---

## 9. What Would Make Someone Share This

Sharing behavior is driven by specific moments, not by the stream as a whole. People share:

### "Look what it built"

A time-lapse of a complete task, from start to finish. Shows the files being created, the code being written, tests passing. The shareable format is a 30-60 second clip that compresses a 30-minute session.

Required: the system must be able to produce time-lapse replays of completed sessions. This is a separate rendering mode from live streaming.

### "The moment everything clicked"

A specific dramatic beat: the agent finds the bug, fixes it, all tests pass. 10-15 second clip. The equivalent of a highlight reel in sports.

Required: automatic detection of "highlight moments" (test suite going from fail to pass, large commit after extended debugging, etc.) with the ability to clip and share.

### "This is what AI can do now"

The novelty factor. A beautifully rendered visualization of an AI agent writing code. The visual design itself is the shareable content. This works on social media even without context.

Required: the default visual treatment must be genuinely beautiful. Not "functional dashboard" beautiful; "I want this as my desktop wallpaper" beautiful. The code canvas / spatial visualization approach serves this best.

### "Watch me ship a feature"

The agent operator shares their stream as a demonstration of their agent's capabilities. Developer flex. "My agent just shipped a full auth system in 20 minutes, watch the replay."

Required: replay URLs that work well when shared on Twitter/Discord. Good thumbnail generation (a frame from the most visually interesting moment). Open Graph metadata.

### Clip Formats

For shareability, the system should be able to generate:
- Full session replay (long form, for YouTube)
- Time-lapse (30-60 seconds, compressed, for Twitter/TikTok)
- Highlight clips (10-15 seconds, specific moments)
- Still images (a single beautiful frame, for sharing on social media)
- GIFs (short loops of satisfying moments: code appearing, tests passing)

---

## 10. Component Catalog for Rendering

Given that Dazzle uses React in a Chrome sandbox, here is a proposed component catalog for coding agent visualization:

### Layout Components

- `<WorkspaceLayout>` -- the master layout with configurable panels
- `<FocusPanel>` -- the primary content area (expands/contracts)
- `<ContextPanel>` -- secondary information area
- `<ActivityFeed>` -- compact timeline of recent events
- `<StatsBar>` -- persistent HUD with metrics
- `<PhaseIndicator>` -- shows current work phase

### Code Components

- `<CodeBlock>` -- syntax-highlighted code with line numbers
- `<CodeDiff>` -- before/after diff display with highlighting
- `<CodeTyping>` -- animated code appearance (typing effect)
- `<InlineHighlight>` -- highlight specific lines or ranges within a code block
- `<CodeMinimap>` -- compact overview of a large file

### Data Components

- `<FileTree>` -- interactive file tree with activity indicators
- `<DependencyGraph>` -- force-directed graph of imports/relationships
- `<TestDashboard>` -- test run results with pass/fail indicators
- `<TerminalOutput>` -- styled terminal with command/output display
- `<GitCommit>` -- commit visualization with files and message

### Narrative Components

- `<PhaseCard>` -- large title card for phase transitions
- `<ReasoningText>` -- streaming text display for agent reasoning
- `<NarrationOverlay>` -- semi-transparent text overlay for editorial commentary
- `<MilestoneReveal>` -- dramatic reveal animation for key moments
- `<ProgressTimeline>` -- visual timeline of the session with markers

### Ambient Components

- `<BackgroundGlow>` -- ambient color-shifting background
- `<ParticleField>` -- subtle particle effects
- `<ActivityHeatmap>` -- visual representation of recent activity intensity
- `<WaveformDisplay>` -- ambient audio visualization

### Transition Components

- `<FadeTransition>` -- smooth fade between content
- `<SlideTransition>` -- directional slide between panels
- `<ZoomTransition>` -- zoom into/out of content
- `<MorphTransition>` -- shape-morphing between states

---

## 11. Implementation Strategy

### Phase 1: Minimum Viable Stream

Get a basic coding agent stream running as quickly as possible:

1. Define the core event types (FileRead, FileWrite, BashCommand, Reasoning, TestRun)
2. Build a passive MCP interceptor that captures Claude Code tool calls
3. Create 3-4 essential React components: CodeDiff, TerminalOutput, FileTree, ReasoningText
4. Implement a simple two-panel layout: code/terminal on the left, reasoning/activity on the right
5. Wire it through Dazzle's Chrome sandbox renderer
6. Stream to a test Twitch channel

This gets something on screen fast. It will not be beautiful, but it will prove the pipeline works.

### Phase 2: Visual Polish

Make it worth watching:

1. Add syntax highlighting with Shiki or a similar library
2. Implement smooth transitions between events
3. Add the phase detection system (heuristic: many reads = orientation, edits = implementation, test commands = verification)
4. Create the typing animation for code appearance
5. Add ambient background and glow effects
6. Implement the StatsBar with running metrics
7. Add basic audio (ambient music, event sounds)

### Phase 3: Narrative Intelligence

Make it tell a story:

1. Add a secondary LLM that generates narration from events
2. Implement highlight detection (test pass/fail transitions, large commits)
3. Build phase transition cards with appropriate visual treatment
4. Create the adaptive layout system (different layouts for different phases)
5. Add the progress timeline

### Phase 4: Shareability

Make it spreadable:

1. Session replay system
2. Time-lapse generation
3. Automatic highlight clip detection and extraction
4. Open Graph / social media preview generation
5. Embed player for sharing on other platforms

---

## 12. Mapping to Dazzle's Existing Concepts

### Content Contract

The coding agent stream fits Dazzle's dual representation model:

- **Visual**: the rendered React components in the Chrome sandbox
- **Agentic**: the structured event stream (FileRead, FileWrite, etc.) that other agents can consume

An agent watching a coding stream could understand: "This stream is currently implementing a REST API endpoint in TypeScript. 12 files have been modified. Tests are passing."

### MCP Integration

The coding agent stream could be one of the first "stream types" on the platform. The MCP surface for it would extend the existing MCP with coding-specific tools, or alternatively, a generic event-forwarding tool.

### Composability

A coding agent stream could compose with other streams:

- A "DevOps dashboard" stream that monitors multiple coding agents working on different PRs
- A "team activity" stream that shows all agents working on a repository
- A "CI/CD pipeline" stream that picks up where the coding agent leaves off (showing deployment after the commit)

### Renderer

The React component catalog described above would be the first concrete set of components for Dazzle's component catalog approach. These components serve as both the rendering layer AND the definition of what a "coding agent stream" looks like.

---

## 13. Open Questions

1. **How much of Claude Code's internal state is accessible?** The quality of the visualization depends heavily on what events can be intercepted. If only the final tool call results are available (no reasoning, no intermediate state), the visualization will be thinner. If reasoning/thinking text is available, it dramatically enriches the stream.

2. **Performance budget**: How many React re-renders per second can the Chrome sandbox handle while maintaining smooth streaming? This determines how granular the animations can be.

3. **Audio strategy**: Generate ambient audio, license music, or keep streams silent by default? Audio keeps viewers engaged but adds complexity and cost.

4. **Replay fidelity**: Should replays be pixel-perfect reproductions of the live stream, or re-rendered from the event log? Re-rendering from events allows for different playback speeds and layouts but is more complex.

5. **Multi-agent visualization**: If multiple agents are working on the same codebase (parallel workstreams, as described in existing docs), how does the visualization handle showing multiple agents' work simultaneously?

6. **Privacy and filtering**: Agent operators may not want to stream everything (API keys in environment variables, private repository paths, etc.). What filtering/redaction is needed?

7. **Latency**: How much delay between the agent's action and the visual update is acceptable? For a live stream, sub-second latency is ideal but may not be achievable through the full pipeline (event -> MCP -> renderer -> Chrome -> RTMP -> viewer).

---

## 14. Why This Could Be Big

The core insight is correct: what an agent does while working IS interesting content. Coding specifically is interesting because:

1. **It is legible**: code has structure, color, and meaning. It is not abstract data; it is a human-readable artifact.
2. **It has natural drama**: will the tests pass? will the approach work? how will the agent handle the unexpected?
3. **It produces something real**: at the end, there is a commit, a feature, a bug fix. The viewer watched something get built.
4. **It is impressive**: watching an AI write competent code in real-time is still genuinely impressive to most people.
5. **It is educational**: developers can learn techniques, patterns, and approaches by watching.
6. **It is shareable**: "my agent just shipped this feature" is a natural share moment.
7. **The audience already exists**: developers are already watching coding streams on Twitch. Agent operators are already watching their agents work in terminals. This is a strictly better version of what they already do.

The key risk is execution. A poorly designed visualization is worse than a terminal because it adds latency and removes information. The visualization must be genuinely better than watching the raw output, not just prettier. It must add context, create narrative, and make the work more comprehensible, not less.

If the visualization genuinely helps people understand and appreciate what their agent is doing, this becomes the default way people interact with their coding agents; not through the terminal, but through a polished stream they can watch, share, and learn from.
