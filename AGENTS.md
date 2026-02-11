# AGENTS.md

## Project Goal
Build an educational demo that creates a “Personal README” for co-workers using:
- Cloudflare Agents SDK for per-user stateful agents
- Astro for hosting/display
- React + `useAgent` for interactive UI

## Current Architecture
- `src/worker.ts`: Custom Cloudflare worker entrypoint exporting Astro server + Durable Object class
- `src/agents/personal-readme-agent.ts`: `PersonalReadmeAgent` class with callable methods for save, AI text updates, and runtime diagnostics
- `src/pages/agents/[...route].ts`: Agents SDK request routing (`routeAgentRequest`)
- `src/components/PersonalReadmeBuilder.tsx`: Editor UI using `useAgent` + debug tools for AI update testing
- `src/components/PersonalReadmeView.tsx`: Read-only “nice text” view wired live to agent state
- `src/lib/personal-readme-types.ts`: Shared profile schema + Zod validation + AI patch schemas
- `src/pages/index.astro`: App shell mounting React component
- `src/pages/u/[username].astro`: Per-user editor route
- `src/pages/u/[username]/view.astro`: Per-user read-only display route
- `wrangler.jsonc`: Durable Object binding + migrations
- `.dev.vars` / `.dev.vars.example`: Local worker env vars (including `OPENAI_API_KEY`)

## Agent Methods (Current)
- `saveProfile(payload)`: Validates and saves full profile via Zod.
- `updateFromText({ text })`: Uses OpenAI structured output to extract updates, then merges into current state.
- `getRuntimeDiagnostics()`: Returns runtime env diagnostics (for example, whether `OPENAI_API_KEY` is visible in the agent runtime).

## AI Update Behavior
- Structured output schema is separate from UI schema to satisfy OpenAI structured output constraints.
- Checkbox/list fields are updated incrementally using `add`/`remove` operations (not full replacement).
- Text fields remain nullable in model output and are merged only when provided.

## Development Workflow
1. Install dependencies: `npm install`
2. Run local dev: `npm run dev`
3. Build check: `npm run build`
4. Preview on worker runtime: `npm run preview`

## Implementation Rules
- Keep Durable Object class names, exports, and Wrangler bindings in sync.
- Keep agent state schema in one shared types file.
- Prefer adding features as vertical slices:
  1. Agent state/API behavior
  2. Route wiring
  3. UI form/read model
  4. Rendered README output
- Avoid introducing backend frameworks beyond Astro + Agents unless necessary.

## Next Planned Slice
- Generate a markdown Personal README preview from saved agent state.
- Add “Copy markdown” and “Download .md” actions.
- Add “view as markdown” mode on the read-only page.

## Notes
- This repo is an educational demo; optimize for readability over abstraction.
- Keep changes incremental and easy to review.
- When debugging env vars, prefer checking from inside the Agent runtime (not only from shell env).
