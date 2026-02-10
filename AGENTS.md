# AGENTS.md

## Project Goal
Build an educational demo that creates a “Personal README” for co-workers using:
- Cloudflare Agents SDK for per-user stateful agents
- Astro for hosting/display
- React + `useAgent` for interactive UI

## Current Architecture
- `src/worker.ts`: Custom Cloudflare worker entrypoint exporting Astro server + Durable Object class
- `src/agents/personal-readme-agent.ts`: `PersonalReadmeAgent` class (stateful profile data)
- `src/pages/agents/[...route].ts`: Agents SDK request routing (`routeAgentRequest`)
- `src/components/PersonalReadmeBuilder.tsx`: React UI using `useAgent`
- `src/lib/personal-readme-types.ts`: Shared profile schema
- `src/pages/index.astro`: App shell mounting React component
- `wrangler.jsonc`: Durable Object binding + migrations

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
- Add basic validation and completion indicators for required profile fields.

## Notes
- This repo is an educational demo; optimize for readability over abstraction.
- Keep changes incremental and easy to review.
