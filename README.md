# Personal README agent

Personal README builder powered by Cloudflare Agents, Workers AI, and Deepgram Flux speech-to-text.

## Architecture

```mermaid
flowchart TD
  Browser["Browser UI (React + useAgent)"]
  Agent["PersonalReadmeAgent (Durable Object)"]
  Flux["Workers AI WebSocket: @cf/deepgram/flux"]
  Wf["PersonalReadmeTextUpdateWorkflow"]
  Gen["Workers AI Structured Output: @cf/zai-org/glm-4.7-flash"]
  State["Agent State (Profile + textUpdateJobs)"]
  View["Editor + Read-only View"]

  Browser -- "voice_stream_start/chunk/stop" --> Agent
  Agent -- "audio chunks" --> Flux
  Flux -- "EndOfTurn transcript" --> Agent
  Agent -- "runWorkflow(TEXT_UPDATE_WORKFLOW)" --> Wf
  Wf -- "extract profile patch" --> Gen
  Wf -- "complete/progress callbacks" --> Agent
  Agent -- "merge patch + update job status" --> State
  State -- "live sync via useAgent" --> View
```

## Local Development

```bash
npm install
npm run dev
```

Build check:

```bash
npm run build
```

Preview in worker runtime:

```bash
npm run preview
```

## Deploy

```bash
npm run deploy
```
