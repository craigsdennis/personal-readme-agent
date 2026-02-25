import { Agent, callable } from "agents";
import { z } from "zod";
import OpenAI from "openai";
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
  type PersonalReadmeProfilePatch,
  type PersonalReadmeProfile,
  type SaveProfileResult,
  type UpdateFromTextResult
} from "../lib/personal-readme-types";

const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });

export class PersonalReadmeAgent extends Agent<Env, PersonalReadmeProfile> {
  initialState = emptyProfile();

  @callable({ description: "Validate and save a personal README profile" })
  async saveProfile(payload: unknown): Promise<SaveProfileResult> {
    const mergedInput =
      payload && typeof payload === "object"
        ? {
            ...this.getNormalizedState(),
            ...payload
          }
        : this.getNormalizedState();

    const parsed = personalReadmeSaveSchema.safeParse(mergedInput);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors
      };
    }

    await this.setState(parsed.data);
    return { ok: true, state: this.state };
  }

  @callable({ description: "Extract profile updates from text, then merge into current state" })
  async updateFromText(payload: unknown): Promise<UpdateFromTextResult> {
    const diagnostics = this.getRuntimeDiagnostics();
    const parsedPayload = updateFromTextPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) {
      return { ok: false, error: "A non-empty text string is required", diagnostics };
    }

    if (!this.env.AI && !this.env.OPENAI_API_KEY) {
      return { ok: false, error: "Neither Workers AI binding nor OPENAI_API_KEY is configured", diagnostics };
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

      return { ok: true, queuedId, jobs: await this.getTextUpdateJobs(), diagnostics };
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
  }

  @callable({ description: "List recent text update jobs and statuses" })
  async getTextUpdateJobs(): Promise<TextUpdateJob[]> {
    this.ensureTextUpdateJobsTable();
    const rows = this.sql`
      SELECT id, text, status, error, created_at, updated_at
      FROM personal_readme_text_updates
      ORDER BY created_at DESC
      LIMIT 20
    `;

    return rows.map((row) => textUpdateJobDbRowSchema.parse(row));
  }

  @callable({ description: "Delete all text update job history" })
  async clearTextUpdateJobs(): Promise<void> {
    this.ensureTextUpdateJobsTable();
    this.sql`DELETE FROM personal_readme_text_updates`;
  }

  @callable({ description: "Return runtime diagnostics for environment configuration" })
  getRuntimeDiagnostics(): AgentRuntimeDiagnostics {
    return {
      hasWorkersAIBinding: Boolean(this.env.AI),
      workersAIModel,
      hasOpenAIKey: Boolean(this.env.OPENAI_API_KEY),
      openAIKeyLength: this.env.OPENAI_API_KEY?.length ?? 0
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

  private async applyTextUpdateNow(text: string): Promise<void> {
    const currentState = this.getNormalizedState();
    const systemPrompt =
      "Extract profile updates from the user's text. For text fields return null when not mentioned. " +
      "For list fields return add/remove arrays and never replace entire lists.";

    let rawPatch: unknown;

    // Try Workers AI first, fall back to OpenAI for local dev
    if (this.env.AI) {
      try {
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
        rawPatch = extractStructuredObject(aiResponse);
      } catch (err) {
        if (!this.env.OPENAI_API_KEY) throw err;
        console.log("[agent] Workers AI unavailable, falling back to OpenAI");
        rawPatch = await this.callOpenAI(systemPrompt, text);
      }
    } else {
      rawPatch = await this.callOpenAI(systemPrompt, text);
    }

    const patch = this.normalizeModelPatch(rawPatch);
    const nextState = personalReadmeProfileSchema.parse({
      ...currentState,
      ...patch,
      username: currentState.username
    });

    await this.setState(nextState);
  }

  private async callOpenAI(systemPrompt: string, userText: string): Promise<unknown> {
    const client = new OpenAI({ apiKey: this.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: openAIModel,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "personal_readme_profile_patch",
          schema: modelPatchJsonSchema,
          strict: true
        }
      }
    });
    const text = response.output_text;
    return JSON.parse(text);
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
}

const workersAIModel = "@cf/zai-org/glm-4.7-flash";
const openAIModel = "gpt-4o-mini";

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
