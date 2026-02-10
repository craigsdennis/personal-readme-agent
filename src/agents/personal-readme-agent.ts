import { Agent, callable } from "agents";
import {
  emptyProfile,
  personalReadmeProfileSchema,
  personalReadmeSaveSchema,
  type PersonalReadmeProfile,
  type SaveProfileResult
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

  private getNormalizedState(): PersonalReadmeProfile {
    const parsed = personalReadmeProfileSchema.safeParse(this.state);
    if (parsed.success) {
      return parsed.data;
    }

    return emptyProfile();
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "GET") {
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
