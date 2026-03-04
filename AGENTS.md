# AGENTS.md

## Project Goal
Build an educational demo that creates a “Personal README” for co-workers using:
- Cloudflare Agents SDK for per-user stateful agents
- Cloudflare Workflows for parallel text-update processing
- Astro for hosting/display
- React + `useAgent` for interactive UI

## Current Architecture
- `src/worker.ts`: Custom worker entrypoint exporting Astro server, `PersonalReadmeAgent`, and `PersonalReadmeTextUpdateWorkflow`.
- `src/agents/personal-readme-agent.ts`: Main per-user agent state machine, callable API methods, live voice stream handling, and workflow callbacks.
- `src/workflows/personal-readme-text-update-workflow.ts`: Workflow that extracts profile patch data from free-form text using Workers AI.
- `src/pages/agents/[...route].ts`: Agents SDK request routing (`routeAgentRequest`).
- `src/components/PersonalReadmeBuilder.tsx`: Editor UI (`useAgent`) with form editing, text updates, live voice streaming controls, and job status display.
- `src/components/VoiceInput.tsx`: Client microphone capture + PCM chunk streaming over `agent.send`.
- `src/components/PersonalReadmeView.tsx`: Read-only profile view that updates live from agent state.
- `src/components/AppFooter.tsx`: Shared sticky footer with project links.
- `src/lib/personal-readme-types.ts`: Shared schema/types for profile state, jobs, workflow payloads/results, and runtime diagnostics.
- `src/lib/personal-readme-ai.ts`: Shared AI model constants + structured output normalization helpers.
- `src/pages/index.astro`: App shell mounting launcher.
- `src/pages/u/[username].astro`: Per-user editor route.
- `src/pages/u/[username]/view.astro`: Per-user read-only route.
- `src/styles/app.css`: Global styles including sticky footer styles.
- `wrangler.jsonc`: Durable Object + Workflow bindings and migrations.

## Agent Methods (Current)
- `saveProfile(payload)`: Validates and saves full profile via Zod.
- `updateFromText({ text })`: Creates a text update job in state, then starts `TEXT_UPDATE_WORKFLOW` for asynchronous processing.
- `updateFromVoiceTurn({ audioBase64, sampleRate })`: One-shot Flux transcription helper (kept for compatibility/debug).
- `getTextUpdateJobs()`: Returns `textUpdateJobs` from current state.
- `clearTextUpdateJobs()`: Clears in-state job history.
- `getRuntimeDiagnostics()`: Returns runtime diagnostics (Workers AI binding + model selection).

## Live Voice Streaming Behavior
- Client sends `voice_stream_start`, `voice_stream_chunk`, and `voice_stream_stop` via `agent.send`.
- Agent opens one Flux websocket per connected client session.
- Each Flux `EndOfTurn` transcript triggers `updateFromText`.
- Jobs are visible in `state.textUpdateJobs` and update live in the UI.

## Workflow Behavior
- `updateFromText` starts a workflow immediately (`runWorkflow`), so turns can process in parallel.
- Workflow callbacks (`onWorkflowProgress`, `onWorkflowComplete`, `onWorkflowError`) update job status in agent state.
- On workflow completion, the resulting model patch is merged into the latest profile state.

## Development Workflow
1. Install dependencies: `npm install`
2. Run local dev: `npm run dev`
3. Build check: `npm run build`
4. Preview on worker runtime: `npm run preview`
5. Deploy: `npm run deploy`

## Implementation Rules
- Keep Durable Object class names/exports and Wrangler bindings in sync.
- Keep profile/job/workflow schemas in `src/lib/personal-readme-types.ts`.
- Keep AI extraction schema/normalization logic in `src/lib/personal-readme-ai.ts`.
- Prefer vertical slices:
  1. Agent/workflow behavior
  2. Routing/bindings
  3. UI updates
  4. Display/output polish
- Avoid introducing backend frameworks beyond Astro + Agents unless necessary.

## Notes
- This repo is an educational demo; optimize for readability over abstraction.
- Keep changes incremental and easy to review.
- For env/runtime debugging, prefer checks from inside the Agent runtime.
