import { Agent, callable, type Connection } from "agents";
import { z } from "zod";
import {
  type AgentRuntimeDiagnostics,
  type TextUpdateJob,
  communicationChannelOptions,
  collaborationPreferenceOptions,
  emptyProfile,
  feedbackPreferenceOptions,
  growthAreaFocusOptions,
  meetingPreferenceOptions,
  normalizeProfileState,
  personalReadmeModelPatchSchema,
  personalReadmeProfilePatchSchema,
  personalReadmeProfileSchema,
  personalReadmeSaveSchema,
  queuedTextUpdatePayloadSchema,
  type PersonalReadmeModelPatch,
  timezoneOptions,
  textUpdateJobDbRowSchema,
  updateFromTextPayloadSchema,
  updateFromVoiceTurnPayloadSchema,
  voiceStreamClientMessageSchema,
  type PersonalReadmeProfilePatch,
  type PersonalReadmeProfile,
  type SaveProfileResult,
  type UpdateFromTextResult,
  type UpdateFromVoiceTurnResult,
  type VoiceStreamClientMessage
} from "../lib/personal-readme-types";

const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });

type LiveVoiceSession = {
  socket: WebSocket;
  latestTranscript: string;
  stopping: boolean;
};

export class PersonalReadmeAgent extends Agent<Env, PersonalReadmeProfile> {
  initialState = emptyProfile();
  private liveVoiceSessions = new Map<string, LiveVoiceSession>();

  @callable({ description: "Validate and save a personal README profile" })
  async saveProfile(payload: unknown): Promise<SaveProfileResult> {
    const currentState = this.getNormalizedState();
    const mergedInput =
      payload && typeof payload === "object"
        ? {
            ...currentState,
            ...payload
          }
        : currentState;

    const parsed = personalReadmeSaveSchema.safeParse(mergedInput);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors
      };
    }

    await this.setState({
      ...parsed.data,
      textUpdateJobs: currentState.textUpdateJobs
    });
    return { ok: true, state: this.state };
  }

  @callable({ description: "Extract profile updates from text, then merge into current state" })
  async updateFromText(payload: unknown): Promise<UpdateFromTextResult> {
    const diagnostics = this.getRuntimeDiagnostics();
    const parsedPayload = updateFromTextPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) {
      return { ok: false, error: "A non-empty text string is required", diagnostics };
    }

    if (!this.env.AI) {
      return { ok: false, error: "Workers AI binding is required", diagnostics };
    }

    this.ensureTextUpdateJobsTable();
    const queuedId = crypto.randomUUID();

    try {
      const now = Math.floor(Date.now() / 1000);
      this.sql`
        INSERT INTO personal_readme_text_updates (id, text, status, error, created_at, updated_at)
        VALUES (${queuedId}, ${parsedPayload.data.text}, ${"queued"}, ${null}, ${now}, ${now})
      `;

      await this.queue("processQueuedTextUpdate", {
        id: queuedId,
        text: parsedPayload.data.text
      });

      return { ok: true, queuedId, jobs: await this.syncTextUpdateJobsToState(), diagnostics };
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: "Failed to update profile from text",
        diagnostics,
        cause
      };
    }
  }

  @callable({ description: "Transcribe one recorded turn with Flux, then queue profile updates from transcript" })
  async updateFromVoiceTurn(payload: unknown): Promise<UpdateFromVoiceTurnResult> {
    const diagnostics = this.getRuntimeDiagnostics();
    const parsedPayload = updateFromVoiceTurnPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) {
      return {
        ok: false,
        error: "audioBase64 and sampleRate are required",
        diagnostics
      };
    }

    if (!this.env.AI) {
      return {
        ok: false,
        error: "Workers AI binding is required for Flux transcription",
        diagnostics
      };
    }

    try {
      const transcript = await this.transcribeFluxTurn(
        decodeBase64ToUint8Array(parsedPayload.data.audioBase64),
        parsedPayload.data.sampleRate
      );

      if (!transcript.trim()) {
        return {
          ok: false,
          error: "No transcript detected for this turn",
          diagnostics
        };
      }

      const update = await this.updateFromText({ text: transcript });
      if (!update.ok) {
        return {
          ok: false,
          error: update.error,
          cause: update.cause,
          diagnostics,
          transcript
        };
      }

      return {
        ok: true,
        transcript,
        queuedId: update.queuedId,
        jobs: update.jobs,
        diagnostics
      };
    } catch (error) {
      return {
        ok: false,
        error: "Flux transcription failed",
        cause: error instanceof Error ? error.message : String(error),
        diagnostics
      };
    }
  }

  async processQueuedTextUpdate(payload: unknown): Promise<void> {
    const parsed = queuedTextUpdatePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }

    this.ensureTextUpdateJobsTable();
    const now = Math.floor(Date.now() / 1000);
    this.sql`
      UPDATE personal_readme_text_updates
      SET status = ${"processing"}, updated_at = ${now}
      WHERE id = ${parsed.data.id}
    `;
    await this.syncTextUpdateJobsToState();

    try {
      await this.applyTextUpdateNow(parsed.data.text);
      this.sql`
        UPDATE personal_readme_text_updates
        SET status = ${"done"}, error = ${null}, updated_at = ${Math.floor(Date.now() / 1000)}
        WHERE id = ${parsed.data.id}
      `;
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      this.sql`
        UPDATE personal_readme_text_updates
        SET status = ${"failed"}, error = ${cause}, updated_at = ${Math.floor(Date.now() / 1000)}
        WHERE id = ${parsed.data.id}
      `;
    }
    await this.syncTextUpdateJobsToState();
  }

  @callable({ description: "List recent text update jobs and statuses" })
  async getTextUpdateJobs(): Promise<TextUpdateJob[]> {
    return this.queryRecentTextUpdateJobs();
  }

  @callable({ description: "Delete all text update job history" })
  async clearTextUpdateJobs(): Promise<void> {
    this.ensureTextUpdateJobsTable();
    this.sql`DELETE FROM personal_readme_text_updates`;
    await this.syncTextUpdateJobsToState();
  }

  @callable({ description: "Return runtime diagnostics for environment configuration" })
  getRuntimeDiagnostics(): AgentRuntimeDiagnostics {
    return {
      hasWorkersAIBinding: Boolean(this.env.AI),
      workersAIModel
    };
  }

  private ensureTextUpdateJobsTable(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS personal_readme_text_updates (
        id TEXT PRIMARY KEY NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued', 'processing', 'done', 'failed')),
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
  }

  private queryRecentTextUpdateJobs(): TextUpdateJob[] {
    this.ensureTextUpdateJobsTable();
    const rows = this.sql`
      SELECT id, text, status, error, created_at, updated_at
      FROM personal_readme_text_updates
      ORDER BY created_at DESC
      LIMIT 20
    `;

    return rows.map((row) => textUpdateJobDbRowSchema.parse(row));
  }

  private async syncTextUpdateJobsToState(): Promise<TextUpdateJob[]> {
    const jobs = this.queryRecentTextUpdateJobs();
    await this.setState({
      ...this.getNormalizedState(),
      textUpdateJobs: jobs
    });
    return jobs;
  }

  private async applyTextUpdateNow(text: string): Promise<void> {
    const currentState = this.getNormalizedState();
    const systemPrompt =
      "Extract profile updates from the user's text. For text fields return null when not mentioned. " +
      "For list fields return add/remove arrays and never replace entire lists.";

    const aiResponse = await (this.env.AI as any).run(workersAIModel, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "personal_readme_profile_patch",
          schema: modelPatchJsonSchema,
          strict: true
        }
      }
    });
    const rawPatch = extractStructuredObject(aiResponse);

    const patch = this.normalizeModelPatch(rawPatch);
    const nextState = personalReadmeProfileSchema.parse({
      ...currentState,
      ...patch,
      username: currentState.username
    });

    await this.setState(nextState);
  }

  private async transcribeFluxTurn(audio: Uint8Array, sampleRate: number): Promise<string> {
    const response = await (this.env.AI as any).run(
      workersAIFluxModel,
      {
        encoding: "linear16",
        sample_rate: String(sampleRate)
      },
      { websocket: true }
    );

    const socket = (response as Response).webSocket;
    if (!socket) {
      throw new Error("Workers AI did not return a websocket");
    }

    socket.accept();

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let latestTranscript = "";
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const finish = (transcript: string, closeCode = 1000) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        try {
          socket.close(closeCode, "done");
        } catch {
          // ignore close errors
        }
        resolve(transcript.trim());
      };

      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        try {
          socket.close(1011, "error");
        } catch {
          // ignore close errors
        }
        reject(error);
      };

      socket.addEventListener("message", (event) => {
        try {
          const message =
            typeof event.data === "string" ? (JSON.parse(event.data) as Record<string, unknown>) : null;
          if (!message) {
            return;
          }
          const transcript =
            typeof message.transcript === "string" ? message.transcript.trim() : "";
          if (transcript) {
            latestTranscript = transcript;
          }
          if (message.event === "EndOfTurn") {
            finish(latestTranscript);
          }
        } catch {
          // Ignore malformed events and keep waiting for EndOfTurn.
        }
      });

      socket.addEventListener("error", () => {
        fail(new Error("Flux websocket error"));
      });

      socket.addEventListener("close", () => {
        if (!settled) {
          finish(latestTranscript);
        }
      });

      timeoutId = setTimeout(() => {
        finish(latestTranscript);
      }, 12000);

      try {
        socket.send(audio);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private normalizeModelPatch(rawPatch: unknown): PersonalReadmeProfilePatch {
    const parsed = personalReadmeModelPatchSchema.parse(coerceModelPatch(rawPatch));
    const current = this.getNormalizedState();
    const patch: PersonalReadmeProfilePatch = {};
    for (const field of nullableScalarFields) {
      const value = parsed[field];
      if (value !== null) {
        (patch as Record<string, unknown>)[field] = value;
      }
    }

    for (const field of listFields) {
      const next = applyListOps(current[field], parsed[field].add, parsed[field].remove);
      if (!sameList(current[field], next)) {
        (patch as Record<string, unknown>)[field] = next;
      }
    }

    return personalReadmeProfilePatchSchema.parse(patch);
  }

  private getNormalizedState(): PersonalReadmeProfile {
    return normalizeProfileState(this.state);
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "GET") {
      const url = new URL(request.url);
      if (url.searchParams.get("debug") === "runtime") {
        return jsonResponse(this.getRuntimeDiagnostics());
      }
      return jsonResponse(this.getNormalizedState());
    }

    if (request.method === "POST" || request.method === "PUT") {
      try {
        const result = await this.saveProfile(await request.json());
        if (!result.ok) {
          return jsonResponse(result, 400);
        }
        return jsonResponse(result.state);
      } catch {
        return jsonResponse({ error: "Invalid JSON payload" }, 400);
      }
    }

    return jsonResponse({ error: "method not allowed" }, 405);
  }

  override async onMessage(connection: Connection, message: unknown): Promise<void> {
    const payload = parseVoiceStreamClientMessage(message);
    if (!payload) {
      return;
    }

    if (payload.type === "voice_stream_start") {
      await this.startVoiceSession(connection, payload.sampleRate);
      return;
    }

    if (payload.type === "voice_stream_chunk") {
      await this.sendVoiceChunk(connection, payload.audioBase64);
      return;
    }

    if (payload.type === "voice_stream_stop") {
      this.stopVoiceSession(connection, true);
    }
  }

  override async onClose(connection: Connection): Promise<void> {
    // Ensure only one active Flux socket per client connection before opening a new one.
    this.stopVoiceSession(connection, false);
  }

  private async startVoiceSession(connection: Connection, sampleRate: number): Promise<void> {
    if (!this.env.AI) {
      connection.send(
        JSON.stringify({
          type: "voice_stream_error",
          error: "Workers AI binding is required for Flux transcription"
        })
      );
      return;
    }

    this.stopVoiceSession(connection, false);

    try {
      const response = await (this.env.AI as any).run(
        workersAIFluxModel,
        {
          encoding: "linear16",
          sample_rate: String(sampleRate)
        },
        { websocket: true }
      );
      const socket = (response as Response).webSocket;
      if (!socket) {
        throw new Error("Workers AI did not return a websocket");
      }

      socket.accept();

      const session: LiveVoiceSession = {
        socket,
        latestTranscript: "",
        stopping: false
      };
      this.liveVoiceSessions.set(connection.id, session);

      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") {
          return;
        }
        try {
          const data = JSON.parse(event.data) as { event?: string; transcript?: string };
          if (typeof data.transcript === "string" && data.transcript.trim()) {
            session.latestTranscript = data.transcript.trim();
          }
          if (data.event === "EndOfTurn") {
            const transcript = session.latestTranscript;
            session.latestTranscript = "";
            if (transcript) {
              void this.queueVoiceTranscript(connection, transcript);
            }
          }
        } catch {
          // Ignore malformed events from Flux.
        }
      });

      socket.addEventListener("error", () => {
        connection.send(
          JSON.stringify({
            type: "voice_stream_error",
            error: "Flux websocket error"
          })
        );
      });

      socket.addEventListener("close", (event) => {
        if (this.liveVoiceSessions.get(connection.id)?.socket === socket) {
          this.liveVoiceSessions.delete(connection.id);
        }
        if (!session.stopping) {
          connection.send(
            JSON.stringify({
              type: "voice_stream_error",
              error: `Flux stream closed unexpectedly (code ${event.code}${event.reason ? `, reason: ${event.reason}` : ""})`
            })
          );
        }
      });

      connection.send(JSON.stringify({ type: "voice_stream_started" }));
    } catch (error) {
      connection.send(
        JSON.stringify({
          type: "voice_stream_error",
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }

  private async sendVoiceChunk(connection: Connection, audioBase64: string): Promise<void> {
    const session = this.liveVoiceSessions.get(connection.id);
    if (!session) {
      connection.send(
        JSON.stringify({
          type: "voice_stream_error",
          error: "Voice stream has not started"
        })
      );
      return;
    }

    try {
      session.socket.send(decodeBase64ToUint8Array(audioBase64));
    } catch (error) {
      connection.send(
        JSON.stringify({
          type: "voice_stream_error",
          error: error instanceof Error ? error.message : String(error)
        })
      );
      this.stopVoiceSession(connection, false);
    }
  }

  private stopVoiceSession(connection: Connection, notifyClient: boolean): void {
    const session = this.liveVoiceSessions.get(connection.id);
    if (!session) {
      if (notifyClient) {
        connection.send(JSON.stringify({ type: "voice_stream_stopped" }));
      }
      return;
    }

    this.liveVoiceSessions.delete(connection.id);
    session.stopping = true;
    try {
      session.socket.close(1000, "client_stop");
    } catch {
      // Ignore close errors.
    }
    if (notifyClient) {
      connection.send(JSON.stringify({ type: "voice_stream_stopped" }));
    }
  }

  private async queueVoiceTranscript(connection: Connection, transcript: string): Promise<void> {
    const result = await this.updateFromText({ text: transcript });
    if (!result.ok) {
      connection.send(
        JSON.stringify({
          type: "voice_stream_error",
          error: result.cause ? `${result.error}: ${result.cause}` : result.error
        })
      );
      return;
    }

    connection.send(
      JSON.stringify({
        type: "voice_turn_queued",
        transcript,
        queuedId: result.queuedId,
        jobs: result.jobs
      })
    );
  }
}

const workersAIModel = "@cf/zai-org/glm-4.7-flash";
const workersAIFluxModel = "@cf/deepgram/flux";

const decodeBase64ToUint8Array = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const parseVoiceStreamClientMessage = (message: unknown): VoiceStreamClientMessage | null => {
  if (typeof message !== "string") {
    return null;
  }
  try {
    return voiceStreamClientMessageSchema.parse(JSON.parse(message));
  } catch {
    return null;
  }
};

const modelPatchJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    displayName: { type: ["string", "null"] },
    role: { type: ["string", "null"] },
    timezone: {
      anyOf: [
        { type: "string", enum: timezoneOptions },
        { type: "null" }
      ]
    },
    communicationChannels: listOpsSchema(communicationChannelOptions),
    collaborationPreferences: listOpsSchema(collaborationPreferenceOptions),
    feedbackPreferences: listOpsSchema(feedbackPreferenceOptions),
    meetingPreferences: listOpsSchema(meetingPreferenceOptions),
    growthAreaFocuses: listOpsSchema(growthAreaFocusOptions),
    communicationStyle: { type: ["string", "null"] },
    collaborationNotes: { type: ["string", "null"] },
    focusHours: { type: ["string", "null"] },
    strengths: { type: ["string", "null"] },
    growthAreas: { type: ["string", "null"] }
  },
  required: [
    "displayName",
    "role",
    "timezone",
    "communicationChannels",
    "collaborationPreferences",
    "feedbackPreferences",
    "meetingPreferences",
    "growthAreaFocuses",
    "communicationStyle",
    "collaborationNotes",
    "focusHours",
    "strengths",
    "growthAreas"
  ]
};

function listOpsSchema(values: readonly string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      add: {
        type: "array",
        items: { type: "string", enum: values }
      },
      remove: {
        type: "array",
        items: { type: "string", enum: values }
      }
    },
    required: ["add", "remove"]
  };
}

function extractStructuredObject(response: unknown): unknown {
  if (!response || typeof response !== "object") {
    throw new Error("Workers AI returned an empty response");
  }

  const obj = response as Record<string, unknown>;

  // Common Workers AI text-generation envelope
  if (typeof obj.response === "string") {
    return parseJsonFromText(obj.response);
  }
  if (obj.response && typeof obj.response === "object") {
    return obj.response;
  }

  // OpenAI-compatible envelope from some Workers AI models
  const choices = obj.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first && typeof first === "object") {
      const message = (first as Record<string, unknown>).message;
      if (message && typeof message === "object") {
        const content = (message as Record<string, unknown>).content;
        if (typeof content === "string") {
          return parseJsonFromText(content);
        }
        if (Array.isArray(content)) {
          for (const part of content) {
            if (part && typeof part === "object") {
              const partText = (part as Record<string, unknown>).text;
              if (typeof partText === "string") {
                return parseJsonFromText(partText);
              }
            }
          }
        }
      }
      const text = (first as Record<string, unknown>).text;
      if (typeof text === "string") {
        return parseJsonFromText(text);
      }
    }
  }

  throw new Error("Model did not return structured JSON content");
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Handle fenced code blocks like ```json ... ```
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      return JSON.parse(fencedMatch[1]);
    }
    throw new Error(`Response was not valid JSON: ${trimmed.slice(0, 200)}`);
  }
}

const applyListOps = (current: string[], add: string[], remove: string[]): string[] => {
  const next = new Set(current);
  for (const value of add) {
    next.add(value);
  }
  for (const value of remove) {
    next.delete(value);
  }
  return [...next];
};

const sameList = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
};

const nullableScalarFields = [
  "displayName",
  "role",
  "timezone",
  "communicationStyle",
  "collaborationNotes",
  "focusHours",
  "strengths",
  "growthAreas"
] as const satisfies readonly (keyof PersonalReadmeModelPatch)[];

const listFields = [
  "communicationChannels",
  "collaborationPreferences",
  "feedbackPreferences",
  "meetingPreferences",
  "growthAreaFocuses"
] as const satisfies readonly (keyof PersonalReadmeModelPatch)[];

const looseModelPatchSchema = z
  .object({
    displayName: z.string().trim().max(80).nullable().optional(),
    role: z.string().trim().max(120).nullable().optional(),
    timezone: z.enum(timezoneOptions).nullable().optional(),
    communicationChannels: looseListOpsSchema(communicationChannelOptions).optional(),
    collaborationPreferences: looseListOpsSchema(collaborationPreferenceOptions).optional(),
    feedbackPreferences: looseListOpsSchema(feedbackPreferenceOptions).optional(),
    meetingPreferences: looseListOpsSchema(meetingPreferenceOptions).optional(),
    growthAreaFocuses: looseListOpsSchema(growthAreaFocusOptions).optional(),
    communicationStyle: z.string().trim().max(300).nullable().optional(),
    collaborationNotes: z.string().trim().max(300).nullable().optional(),
    focusHours: z.string().trim().max(120).nullable().optional(),
    strengths: z.string().trim().max(500).nullable().optional(),
    growthAreas: z.string().trim().max(500).nullable().optional(),
    // Model aliases seen in practice; mapped below.
    goals: z.string().trim().max(500).optional(),
    bio: z.string().trim().max(300).optional()
  })
  .passthrough();

function looseListOpsSchema(values: readonly string[]) {
  return z
    .object({
      add: z.array(z.enum(values)).optional(),
      remove: z.array(z.enum(values)).optional()
    })
    .strict();
}

function coerceModelPatch(rawPatch: unknown): PersonalReadmeModelPatch {
  if (!rawPatch || typeof rawPatch !== "object") {
    throw new Error("Model patch was not an object");
  }

  const loose = looseModelPatchSchema.parse(rawPatch);
  const strictCandidate: PersonalReadmeModelPatch = {
    displayName: loose.displayName ?? null,
    role: loose.role ?? null,
    timezone: loose.timezone ?? null,
    communicationChannels: {
      add: loose.communicationChannels?.add ?? [],
      remove: loose.communicationChannels?.remove ?? []
    },
    collaborationPreferences: {
      add: loose.collaborationPreferences?.add ?? [],
      remove: loose.collaborationPreferences?.remove ?? []
    },
    feedbackPreferences: {
      add: loose.feedbackPreferences?.add ?? [],
      remove: loose.feedbackPreferences?.remove ?? []
    },
    meetingPreferences: {
      add: loose.meetingPreferences?.add ?? [],
      remove: loose.meetingPreferences?.remove ?? []
    },
    growthAreaFocuses: {
      add: loose.growthAreaFocuses?.add ?? [],
      remove: loose.growthAreaFocuses?.remove ?? []
    },
    communicationStyle: loose.communicationStyle ?? loose.bio ?? null,
    collaborationNotes: loose.collaborationNotes ?? null,
    focusHours: loose.focusHours ?? null,
    strengths: loose.strengths ?? null,
    growthAreas: loose.growthAreas ?? loose.goals ?? null
  };

  return personalReadmeModelPatchSchema.parse(strictCandidate);
}
