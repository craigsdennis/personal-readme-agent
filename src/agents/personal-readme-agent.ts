import { Agent, callable } from "agents";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  type AgentRuntimeDiagnostics,
  emptyProfile,
  personalReadmeModelPatchSchema,
  personalReadmeProfilePatchSchema,
  personalReadmeProfileSchema,
  personalReadmeSaveSchema,
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

    if (!this.env.OPENAI_API_KEY) {
      return { ok: false, error: "OPENAI_API_KEY is not configured", diagnostics };
    }

    const currentState = this.getNormalizedState();
    const client = new OpenAI({ apiKey: this.env.OPENAI_API_KEY });

    try {
      const response = await client.responses.parse({
        model: "gpt-5-mini",
        input: [
          {
            role: "system",
            content:
              "Extract profile updates from the user's text. For text fields return null when not mentioned. " +
              "For list fields return add/remove arrays and never replace entire lists."
          },
          {
            role: "user",
            content: parsedPayload.data.text
          }
        ],
        text: {
          format: zodTextFormat(personalReadmeModelPatchSchema, "personal_readme_profile_patch")
        }
      });

      const rawPatch = response.output_parsed;
      const patch = this.normalizeModelPatch(rawPatch);
      const nextState = personalReadmeProfileSchema.parse({
        ...currentState,
        ...patch,
        username: currentState.username
      });

      await this.setState(nextState);
      return { ok: true, state: this.state, patch, diagnostics };
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      return { ok: false, error: "Failed to update profile from text", diagnostics, cause };
    }
  }

  @callable({ description: "Return runtime diagnostics for environment configuration" })
  async getRuntimeDiagnostics(): Promise<AgentRuntimeDiagnostics> {
    const key = this.env.OPENAI_API_KEY;
    return {
      hasOpenAIKey: Boolean(key),
      openAIKeyLength: key?.length ?? 0
    };
  }

  private normalizeModelPatch(rawPatch: unknown): PersonalReadmeProfilePatch {
    const parsed = personalReadmeModelPatchSchema.parse(rawPatch);
    const current = this.getNormalizedState();
    const patch: PersonalReadmeProfilePatch = {};

    if (parsed.displayName !== null) {
      patch.displayName = parsed.displayName;
    }
    if (parsed.role !== null) {
      patch.role = parsed.role;
    }
    if (parsed.timezone !== null) {
      patch.timezone = parsed.timezone;
    }
    if (parsed.communicationStyle !== null) {
      patch.communicationStyle = parsed.communicationStyle;
    }
    if (parsed.collaborationNotes !== null) {
      patch.collaborationNotes = parsed.collaborationNotes;
    }
    if (parsed.focusHours !== null) {
      patch.focusHours = parsed.focusHours;
    }
    if (parsed.strengths !== null) {
      patch.strengths = parsed.strengths;
    }
    if (parsed.growthAreas !== null) {
      patch.growthAreas = parsed.growthAreas;
    }

    const communicationChannels = applyListOps(
      current.communicationChannels,
      parsed.communicationChannels.add,
      parsed.communicationChannels.remove
    );
    if (!sameList(current.communicationChannels, communicationChannels)) {
      patch.communicationChannels = communicationChannels;
    }

    const collaborationPreferences = applyListOps(
      current.collaborationPreferences,
      parsed.collaborationPreferences.add,
      parsed.collaborationPreferences.remove
    );
    if (!sameList(current.collaborationPreferences, collaborationPreferences)) {
      patch.collaborationPreferences = collaborationPreferences;
    }

    const feedbackPreferences = applyListOps(
      current.feedbackPreferences,
      parsed.feedbackPreferences.add,
      parsed.feedbackPreferences.remove
    );
    if (!sameList(current.feedbackPreferences, feedbackPreferences)) {
      patch.feedbackPreferences = feedbackPreferences;
    }

    const meetingPreferences = applyListOps(
      current.meetingPreferences,
      parsed.meetingPreferences.add,
      parsed.meetingPreferences.remove
    );
    if (!sameList(current.meetingPreferences, meetingPreferences)) {
      patch.meetingPreferences = meetingPreferences;
    }

    const growthAreaFocuses = applyListOps(
      current.growthAreaFocuses,
      parsed.growthAreaFocuses.add,
      parsed.growthAreaFocuses.remove
    );
    if (!sameList(current.growthAreaFocuses, growthAreaFocuses)) {
      patch.growthAreaFocuses = growthAreaFocuses;
    }

    return personalReadmeProfilePatchSchema.parse(patch);
  }

  private getNormalizedState(): PersonalReadmeProfile {
    const parsed = personalReadmeProfileSchema.safeParse(this.state);
    if (parsed.success) {
      return parsed.data;
    }

    return emptyProfile();
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

const updateFromTextPayloadSchema = z.object({
  text: z.string().trim().min(1).max(4000)
});

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
