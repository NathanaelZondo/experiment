Overnight Execution Contract

Objective

Bring the existing LocalBench Chat repository into compliance with the full
specification below and resolve both Known Issues. Work autonomously until the
Definition of Done is satisfied or a genuine blocker requires human input.

Authoritative Inputs

At the beginning of every goal round:

Reread this entire file.

Reread OVERNIGHT_STATUS.md if it exists.

Inspect the current repository state and preserve correct existing work.

Continue from the recorded checkpoint instead of repeating completed work.

This file is authoritative over assumptions or compacted conversation history.

Execution Order

Establish a baseline before editing:

Inspect the repository structure, package.json, existing documentation,
tests, Git status and current implementation.

Record pre-existing uncommitted changes without overwriting or reverting
them.

Run the available one-shot test and production-build commands.

Record failures exactly in OVERNIGHT_STATUS.md.

Audit Phases 1 through 10 in order.

For each phase:

Mark requirements already implemented and verified as complete.

Implement only missing or incorrect requirements from that phase.

Do not rewrite working code merely to make it different.

Add or update relevant tests.

Run focused tests and then the appropriate build verification.

Update OVERNIGHT_STATUS.md before advancing to the next phase.

Treat the two Known Issues as mandatory acceptance defects:

Resolve the model-pane overflow while verifying Phase 2.

Resolve the generation endpoint and OpenAI-compatible SSE handling while
verifying Phases 4, 6 and 7.

Finish with the complete Phase 10 verification and final report.

Unattended-Run Rules

Work only inside the current repository.

Use noninteractive commands; never start a development server or watch mode
that waits indefinitely.

On Windows, use PowerShell-compatible syntax and .cmd executables where
required. Do not use && or Linux-only commands.

Never push, force-reset Git, discard existing changes, alter credentials, or
delete unrelated files.

Never expose or log the optional LM Studio API token.

Do not add dependencies unless the specification genuinely requires them and
the existing project has no suitable implementation.

Do not claim a requirement is complete merely because code was written.
Verify it through tests, production build, static inspection or a documented
deterministic check.

If a command fails, inspect the real error and repair the cause. Do not hide
failures by weakening tests or removing required functionality.

If the same blocker persists for three goal rounds, write BLOCKED.md with
commands, errors, attempted fixes and the smallest required human decision;
then mark the goal blocked instead of looping.

Definition of Done

The goal may be marked complete only when all of the following are true:

Every phase requirement is either implemented and verified or explicitly
identified as a pre-existing, evidence-backed limitation that cannot be
resolved without unavailable external infrastructure.

No generation request uses /api/v0/chat/completions.

Chat generation uses POST /v1/chat/completions, sends the complete in-memory
conversation history, preserves cancellation and streaming, handles
OpenAI-compatible data: events and terminates cleanly on data: [DONE].

Native LM Studio discovery, load and unload operations continue using their
required /api/v1 endpoints.

The model catalogue scrolls inside a bounded right-hand panel and cannot
displace the centre conversation area.

Relevant regression, store, client and component tests pass in one-shot mode.

The production build exits with code 0.

No TypeScript or Angular template compilation errors remain.

README.md and the final implementation report accurately describe setup,
architecture, verification commands, results and known limitations.

OVERNIGHT_STATUS.md contains the final file list, commands, exit codes and
evidence used to declare completion.

LocalBench Chat

Application Design & Ten-Phase Development Plan
An Angular 22 local-AI workstation for benchmarking models served by LM Studio

📐 Application Design

Desktop Interface Layout

Panel

Contents

Left

Conversation sidebar with new-chat, rename and delete controls.

Centre

Active conversation, streamed responses and composer.

Right

Loaded-model information, generation settings and performance metrics.

Responsive Behaviour
On smaller screens, the left and right panels become drawers.

Visual Identity

The interface should feel like a local AI workstation — not a ChatGPT clone:

Dark graphite surfaces with teal primary accents.

Status colours for connected, loading, generating and error states.

Monospace typography for model and performance data.

Rounded but restrained components.

Clear loading skeletons, empty states and connection guidance.

WCAG AA contrast and complete keyboard operation.

🔨 The Ten Development Phases

Implementation Rule
Each phase is implemented in isolation using the reusable benchmark prompt below, in order, without pulling forward work from later phases.
1
Foundation and Architecture
Create the Angular 22 application with strict TypeScript, standalone components, SCSS and Vitest. Establish:

Feature-based folder structure.

Core LM Studio service layer.In-memory application stores using Signals.

Shared UI primitives.

Environment configuration with http://localhost:1234.

Global error handling and typed API contracts.

✅ Completion — the application builds, tests run and the empty shell opens without errors.
2
Design System and Responsive Shell
Build the three-panel application shell and foundational components:

Buttons, icon buttons, inputs, textarea, dialog, tooltip and status badge.

Design tokens for colour, spacing, typography, elevation and motion.

Dark and light themes, held only in RAM.

Desktop, tablet and mobile layouts.

Skip link, focus indicators and accessible landmarks.

✅ Completion — all three panels respond correctly and keyboard navigation works.
3
In-Memory Conversations
Implement a Signal-based conversation store. Features:

Create, select, rename and delete conversations.

Automatic title derived from the first user message.

Separate message history and system prompt for each conversation.

Confirmation before deleting a non-empty conversation.

Friendly first-use and empty-chat states.

Explicit "Session only — refreshing clears chats" indicator.

No localStorage, sessionStorage, IndexedDB or database may be used.

✅ Completion — multiple conversations can be managed and remain isolated until refresh.
4
LM Studio Connection and Discovery
Create the typed LM Studio client. Features:

Editable server URL and optional API token, both held in RAM.

Connection test using GET /api/v1/models.

Connected, disconnected, checking and failed states.

Model catalogue showing name, publisher, quantization, parameter count, size, format and capabilities.

Filtering to chat-capable LLMs.

Clear CORS and server-not-running guidance.

✅ Completion — the interface accurately displays locally available and currently loaded models.
📎 Reference: Model listing contract
5
Model Loading and Offloading
Implement the one-model-at-a-time lifecycle. Features:

Load a selected model through /api/v1/models/load.

Unload through /api/v1/models/unload.

If another model is active, unload it before loading the new one.

Prevent lifecycle changes while generation is active.

Loading overlay with elapsed time.

Display the final applied load configuration.

Recover gracefully if unloading succeeds but the replacement fails.

Refresh model state after every lifecycle operation.

Use LM Studio defaults; do not expose advanced loading controls in this version.

✅ Completion — the application never intentionally retains more than one loaded model.
📎 Reference: Load API, unload API
6
Basic Chat
Implement the complete non-streaming conversation flow first. Features:

User and assistant messages.

Multiline composer.

Enter to send and Shift+Enter for a newline.

System prompt per conversation.

Markdown rendering with sanitized code blocks.

Copy buttons for messages and code.

Automatic scrolling that respects users who scroll upward.

Empty, sending, completed and failed message states.

Disable sending when no model is loaded.

✅ Completion — multi-turn conversations work without streaming.
7
Streaming and Cancellation
Upgrade chat generation to streamed SSE using fetch() and a readable-stream parser.

Handle These Events:



chat.start

Model loading and prompt-processing events.



reasoning.delta



message.delta



error



chat.end

Add These Features:

Live response rendering.

Collapsible reasoning display when supplied.

Stop-generation button using AbortController.

Proper partial-response handling after cancellation.

Request concurrency protection.

Recovery from malformed or interrupted streams.

✅ Completion — streaming responses render live and can be cleanly cancelled.
📎 Reference: LM Studio's final chat.end event supplies the aggregated response and statistics — see the streaming event reference.
8
Chat Controls and Message Operations
Add the interactions expected from a polished chat client:

Edit a user message and regenerate from that point.

Regenerate the latest assistant response.

Delete an individual message.

Clear a conversation.

Temperature, top-p, top-k, repeat penalty, maximum output tokens and reasoning mode.

Reset settings to defaults.

Validation against supported ranges.

Per-message model name and generation timestamp.

✅ Completion — edits correctly discard dependent later responses and resend the revised history.
9
Benchmarking Experience
Turn the application into a useful model-comparison interface.

Show Per Response:

Input tokens.

Output tokens.

Reasoning tokens.

Tokens per second.

Time to first token.

Total elapsed time.

Model load time when present.

Model instance identifier.

Add These Features:

Expandable response metrics.

Session aggregates for the active conversation.

Copy-results-as-JSON action.

Consistent performance formatting.

Error diagnostics without exposing the API token.

Reduced-motion support and responsive metric cards.

✅ Completion — every response surfaces consistent, comparable performance metrics.
📎 Reference: LM Studio exposes these metrics in the native chat response — see the chat response specification.
10
Testing, Polish and Handover
Complete the application with:

Store unit tests.

LM Studio client tests with mocked API responses and SSE streams.

Component interaction tests.

Tests for cancellation, connection loss and model-switch failure.

Accessibility review.

Responsive review at mobile, tablet and desktop sizes.

Production build verification.

README containing setup, architecture, LM Studio configuration and troubleshooting.

Final implementation report listing completed features, commands run and known limitations.

✅ Completion — passing tests, a successful production build and no browser-console errors during the main workflow.

🚫 Explicitly Out of Scope

Scope Boundary
To prevent the benchmark from expanding uncontrollably, the following are excluded from every phase:

❌ Login or user accounts

❌ Persistent conversation storage

❌ Node, Express or another backend

❌ Simultaneously loaded models

❌ Model downloads

❌ Image or file attachments

❌ MCP tools and function calling

❌ Voice input or text-to-speech

❌ Sharing, cloud deployment or multi-user support



📝 Reusable Benchmark Prompt

Master Prompt
Use the following master prompt with every model under test. Replace [PHASE] with the phase number and paste that phase's description beneath it.

You are building LocalBench Chat, a medium-sized Angular 22 application that
communicates directly with a locally running LM Studio server.

Work on PHASE [PHASE] only. Do not implement later phases.

Technical constraints:

- Angular 22
- Standalone components
- Strict TypeScript
- SCSS
- Angular Signals for application state
- Vitest for tests
- No NgRx
- No backend
- No login
- No database
- No localStorage, sessionStorage or IndexedDB
- All conversations, settings and credentials exist in RAM only
- LM Studio base URL defaults to http://localhost:1234
- Exactly one LM Studio model may be loaded at a time
- Use LM Studio native /api/v1 endpoints
- Use store:false for chat requests
- Do not expose or log the API token
- Preserve all correctly implemented work from earlier phases

Design direction:

Create a polished local-AI workstation rather than a ChatGPT clone. Use a
three-panel desktop layout: conversations on the left, chat in the centre,
and model/settings/metrics on the right. Use dark graphite surfaces, teal
accents, strong accessibility, restrained animation and responsive drawers
on smaller screens.

Engineering requirements:

1. Inspect the existing repository before changing it.
2. State a short implementation plan.
3. Implement every requirement belonging to the requested phase.
4. Use typed interfaces; do not use any unless unavoidable and documented.
5. Include loading, empty, error and disabled states.
6. Keep components focused and avoid oversized components.
7. Add or update relevant tests.
8. Run the tests and production build.
9. Fix failures caused by your implementation.
10. Do not replace working code with placeholders or pseudocode.
11. Do not ask questions unless a missing fact makes implementation impossible.

At the end, report:

- What you implemented
- Important architecture decisions
- Files created or changed
- Tests and commands run
- Their results
- Remaining limitations
- Confirmation that no later phase was implemented

🔧 Known Issues & Fix Requests

Issue 1 — Lowest Quant Failure: Generation Endpoint Mismatch

Problem
The application can retrieve models successfully, but generation fails. The browser shows that the application is calling:

POST /api/v0/chat/completions

This endpoint must not be used.

Required Fix

Update chat generation to use LM Studio's OpenAI-compatible endpoint:

POST /v1/chat/completions

Preserve Angular-owned conversation history in RAM and send the complete message history with each request.

Preserve streaming and cancellation.

Update the SSE parser to handle OpenAI-compatible data: events and data: [DONE].

Do not change the native /api/v1 model discovery, load or unload endpoints.

Add a regression test proving that no request is made to /api/v0.

Report at the End

Why model discovery worked while generation failed.

Every file changed.

The streaming format handled.

Tests and build commands run, and their results.

Issue 2 — Model Pane Layout Overflow

Problem
The models rendered under the models pane were causing the main chat screen to be pushed out of view.

Required Fix

The model catalogue list must scroll within its own panel — with a bounded height and internal overflow — rather than expanding the right-hand panel and displacing the centre conversation area.

LocalBench Chat — Design Document
Formatted for Google Docs