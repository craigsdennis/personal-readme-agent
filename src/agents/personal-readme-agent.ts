import { Agent, callable, type Connection } from "agents";
import {
  type AgentRuntimeDiagnostics,
  type TextUpdateJob,
  emptyProfile,
  normalizeProfileState,
  personalReadmeProfilePatchSchema,
  personalReadmeProfileSchema,
  personalReadmeSaveSchema,
  textUpdateWorkflowResultSchema,
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
import {
  normalizeModelPatchFromAI,
  workersAIFluxModel,
  workersAIModel
} from "../lib/personal-readme-ai";

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

    const queuedId = crypto.randomUUID();
    await this.upsertTextUpdateJob({
      id: queuedId,
      text: parsedPayload.data.text,
      status: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    try {
      await this.runWorkflow(
        textUpdateWorkflowBinding,
        {
          jobId: queuedId,
          text: parsedPayload.data.text
        },
        {
          id: queuedId,
          metadata: { kind: "text_update", jobId: queuedId }
        }
      );
      return { ok: true, queuedId, jobs: this.getNormalizedState().textUpdateJobs, diagnostics };
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      await this.updateTextUpdateJob(queuedId, (job) => ({
        ...job,
        status: "failed",
        error: cause,
        updatedAt: Date.now()
      }));
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

  @callable({ description: "List recent text update jobs and statuses" })
  async getTextUpdateJobs(): Promise<TextUpdateJob[]> {
    return this.getNormalizedState().textUpdateJobs;
  }

  @callable({ description: "Delete all text update job history" })
  async clearTextUpdateJobs(): Promise<void> {
    await this.setState({
      ...this.getNormalizedState(),
      textUpdateJobs: []
    });
  }

  @callable({ description: "Return runtime diagnostics for environment configuration" })
  getRuntimeDiagnostics(): AgentRuntimeDiagnostics {
    return {
      hasWorkersAIBinding: Boolean(this.env.AI),
      workersAIModel
    };
  }

  private async applyModelPatchNow(modelPatch: unknown): Promise<void> {
    const patch = this.normalizeModelPatch(modelPatch);
    const currentState = this.getNormalizedState();
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
    const parsed = normalizeModelPatchFromAI(rawPatch);
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
    // Close any live transcription stream when the client websocket disconnects.
    this.stopVoiceSession(connection, false);
  }

  override async onWorkflowProgress(workflowName: string, workflowId: string): Promise<void> {
    if (workflowName !== textUpdateWorkflowBinding) {
      return;
    }
    await this.updateTextUpdateJob(workflowId, (job) => ({
      ...job,
      status: "processing",
      updatedAt: Date.now()
    }));
  }

  override async onWorkflowComplete(workflowName: string, workflowId: string, result?: unknown): Promise<void> {
    if (workflowName !== textUpdateWorkflowBinding) {
      return;
    }

    const parsed = textUpdateWorkflowResultSchema.safeParse(result);
    if (!parsed.success || parsed.data.jobId !== workflowId) {
      await this.updateTextUpdateJob(workflowId, (job) => ({
        ...job,
        status: "failed",
        error: "Workflow returned an invalid result payload",
        updatedAt: Date.now()
      }));
      return;
    }

    try {
      await this.applyModelPatchNow(parsed.data.patch);
      await this.updateTextUpdateJob(workflowId, (job) => ({
        ...job,
        status: "done",
        error: undefined,
        updatedAt: Date.now()
      }));
    } catch (error) {
      await this.updateTextUpdateJob(workflowId, (job) => ({
        ...job,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now()
      }));
    }
  }

  override async onWorkflowError(workflowName: string, workflowId: string, error: string): Promise<void> {
    if (workflowName !== textUpdateWorkflowBinding) {
      return;
    }
    await this.updateTextUpdateJob(workflowId, (job) => ({
      ...job,
      status: "failed",
      error,
      updatedAt: Date.now()
    }));
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

  private async upsertTextUpdateJob(job: TextUpdateJob): Promise<void> {
    const current = this.getNormalizedState();
    const nextJobs = [job, ...current.textUpdateJobs.filter((existing) => existing.id !== job.id)].slice(0, 20);
    await this.setState({
      ...current,
      textUpdateJobs: nextJobs
    });
  }

  private async updateTextUpdateJob(
    id: string,
    update: (job: TextUpdateJob) => TextUpdateJob
  ): Promise<void> {
    const current = this.getNormalizedState();
    const existing = current.textUpdateJobs.find((job) => job.id === id);
    if (!existing) {
      return;
    }
    const updated = update(existing);
    const nextJobs = current.textUpdateJobs.map((job) => (job.id === id ? updated : job));
    await this.setState({
      ...current,
      textUpdateJobs: nextJobs
    });
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

const textUpdateWorkflowBinding = "TEXT_UPDATE_WORKFLOW";

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
