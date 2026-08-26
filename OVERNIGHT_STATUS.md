# OVERNIGHT STATUS — LocalBench Chat

Authoritative checkpoint file. Updated after every verified milestone.
Task source: `OVERNIGHT_TASK.md` (reread at the start of every goal round).

## Round 1 — Baseline (2026-08-23)

### Repository state at start
- Single commit `85e916c initial commit`, branch `qwen-harness`.
- Pre-existing uncommitted change: staged new file `OVERNIGHT_TASK.md` (recorded, preserved; not reverted).
- The repository is a **bare Angular 21.2 scaffold** (`@angular/core` 21.2.21 installed):
  default "Hello, experiment" placeholder template in `src/app/app.html`, no LocalBench
  Chat implementation exists yet. All ten phases must be implemented from scratch while
  preserving the working scaffold (build config, Vitest setup).
- No `localStorage`/`sessionStorage`/IndexedDB usage anywhere; no backend code.

### Baseline commands and results
| Command | Exit code | Result |
|---|---|---|
| `npm run build` (production) | 0 | Initial total 213.66 kB raw / 58.45 kB transfer, output `dist\experiment` |
| `npx ng test --watch=false` | 0 | 1 file, 2 tests passed (`src/app/app.spec.ts`) |

### Environment facts
- Node v24.14.0, npm 11.9.0 (Windows, PowerShell).
- npm registry reachable (`npm ping` → PONG), so dependency updates are possible.
- `@angular/core` latest on registry: **22.1.3** — spec requires Angular 22 (Phase 1 constraint).

### Milestone: Angular 22 upgrade (round 1)
- Installed `@angular/*` runtime + `@angular/cli`, `@angular/build`, `@angular/compiler-cli`
  at **22.1.x** and `typescript@~6.0.3` (Angular 22 peer requirement: TS >=6.0 <6.1).
- Angular CLI 22 requires Node ≥ v24.15.0; system Node is v24.14.0 and no version manager
  exists on this machine. **Solution:** portable Node **v24.19.0** downloaded into the
  workspace at `.tools\node-v24.19.0-win-x64\` (self-contained, no system changes).
  All `ng`/`npm` commands are run with that directory prepended to PATH:
  `$env:Path = "<repo>\.tools\node-v24.19.0-win-x64;" + $env:Path`.
- Re-verified on Angular 22.1.3 / TS 6.0.3 / Node v24.19.0:
  | Command | Exit code | Result |
  |---|---|---|
  | `npm run build` | 0 | Initial total 216.66 kB raw / 59.48 kB transfer |
  | `npx ng test --watch=false` | 0 | 1 file, 2 tests passed |

### Plan / checkpoint
1. [x] Baseline recorded (this section).
2. [x] Upgrade scaffold to Angular 22; re-run build + one-shot tests — **done, both exit 0**.
3. [ ] Phase 1: feature-based structure, environment config (http://localhost:1234),
   typed API contracts, global error handling, in-memory Signal stores, shared UI primitives.
4. [ ] Phase 2: design tokens/themes (RAM-only), three-panel responsive shell,
   foundational components; **Known Issue 2** — model catalogue must scroll inside a
   bounded right-hand panel (`minmax(0,1fr)` centre column + internal overflow).
5. [ ] Phase 3: conversation store (create/select/rename/delete, auto-title from first
   user message, per-conversation system prompt, delete confirmation for non-empty chats,
   session-only indicator, no storage APIs).
6. [ ] Phase 4: typed LM Studio client — connection test via `GET /api/v1/models`,
   states (connected/disconnected/checking/failed), model catalogue fields, chat-capable
   LLM filter, CORS/server-not-running guidance.
7. [ ] Phase 5: load/unload lifecycle via `/api/v1/models/load` + `/api/v1/models/unload`,
   one-model-at-a-time (unload active before loading new), blocked while generating,
   loading overlay with elapsed time, graceful recovery when replacement fails, refresh
   state after every operation.
8. [ ] Phase 6: non-streaming chat flow first — composer (Enter/Shift+Enter), per-conversation
   system prompt, sanitized markdown + code blocks, copy buttons, smart auto-scroll,
   message states, send disabled without loaded model.
9. [ ] Phase 7: streaming SSE via `fetch()` readable stream; **Known Issue 1** — generation
   must use `POST /v1/chat/completions` (never `/api/v0/...`), full in-RAM history per
   request, OpenAI-compatible `data:` events + clean termination on `data: [DONE]`,
   AbortController stop button, partial-response handling, concurrency protection,
   malformed-stream recovery. Native `/api/v1` discovery/load/unload unchanged.
10. [ ] Phase 8: edit user message + regenerate from that point (discard dependent later
     responses), regenerate latest assistant response, delete individual message, clear
     conversation; settings (temperature, top-p, top-k, repeat penalty, max output tokens,
     reasoning mode) with range validation and reset-to-defaults; per-message model name +
     timestamp.
11. [ ] Phase 9: per-response metrics (input/output/reasoning tokens, tok/s, TTFT, total
     elapsed, load time when present, instance identifier), expandable metrics, session
     aggregates, copy-results-as-JSON, consistent formatting, error diagnostics without
     exposing the API token, reduced-motion support.
12. [x] Phase 10: store/client/component tests incl. cancellation, connection loss and
     model-switch failure; accessibility + responsive review notes; production build exit 0;
     README (setup/architecture/LM Studio config/troubleshooting); final implementation
     report; DoD verification pass.

### Known Issues tracking
- **Issue 1 (endpoint mismatch):** not yet present in code (no generation code exists).
  Will be implemented correctly from the start: `POST /v1/chat/completions`, plus a
  regression test asserting no request ever targets `/api/v0`.
- **Issue 2 (model pane overflow):** will be addressed in Phase 2 shell layout with a
  bounded, internally scrolling catalogue container; verified by component test + CSS.

### Blockers
None.

---

## Final Test Fix — Round N (2026-08-23)

### Problem
48 failing tests at start of session. Progressively reduced to 5 remaining:
- 1 chat-generation cancellation test (expected `'cancelled'`, got `'failed'`)
- 4 model-catalog component tests (`querySelector('.catalog__list')` returned null)

### Root Causes Identified and Fixed

#### Chat-generation cancellation test
**Cause:** The test pushed partial content via `GatedSseBody.push()` but did not wait for
the content to be processed by the chat stream before calling `service.cancel()`. The abort
happened before the `messageDelta` event was yielded, so `state.content` was still empty.
Per the production code logic (`state.content.length > 0 ? 'cancelled' : 'failed`), the
message was marked `'failed'` instead of `'cancelled'`.

**Fix:** Added a `waitFor()` call after `push()` to wait for the partial content to appear
in the conversation store before canceling:
```typescript
await waitFor(() => {
  const msgs = conversations.conversations().find(c => c.id === conv.id)?.messages ?? [];
  return msgs.some(m => m.role === 'assistant' && m.content.includes('Partial'));
});
```

#### Model-catalog component tests
**Cause:** `@Injectable({ providedIn: 'root' })` creates platform-level singletons.
`TestBed.overrideProvider()` does not affect `inject()` resolution in components — the
component's `inject()` calls resolved to root singletons (empty models, disconnected
status) instead of test-provided mocks.

**Fix:** Rewrote tests to set store signals directly after creating fresh store instances:
```typescript
connections.status.set('connected');
connections.models.set([...]);
fixture.detectChanges();
```

### Files Changed
| File | Change |
|---|---|
| `src/app/core/chat-generation.service.spec.ts` | Added content-delivery `waitFor()` before cancel in cancellation test; added `gated!.fail()` call |
| `src/app/features/model-pane/model-catalog.component.spec.ts` | Rewrote to use direct store signal mutation instead of `overrideProvider()` |

### Final Results
| Command | Exit code | Result |
|---|---|---|
| `npx ng build` | 0 | Initial total 382.15 kB raw / 96.86 kB transfer |
| `npx ng test --watch=false` | 0 | **12 test files, 150 tests passed, 0 failures** |

### Test Breakdown
| Test File | Tests |
|---|---|
| `sse-parser.spec.ts` | 14 passed |
| `settings.store.spec.ts` | 9 passed |
| `lm-studio-client.service.spec.ts` | 19 passed |
| `chat-session.store.spec.ts` | 6 passed |
| `connection.store.spec.ts` | 9 passed |
| `conversation.store.spec.ts` | 25 passed |
| `model-lifecycle.store.spec.ts` | 11 passed |
| `chat-generation.service.spec.ts` | 14 passed |
| `composer.component.spec.ts` | 8 passed |
| `model-catalog.component.spec.ts` | 7 passed |
| `message-item.component.spec.ts` | 19 passed |
| `app.spec.ts` | 9 passed |
