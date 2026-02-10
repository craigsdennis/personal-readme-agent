import { Agent } from "agents";
import { emptyProfile, type PersonalReadmeProfile } from "../lib/personal-readme-types";

const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });

export class PersonalReadmeAgent extends Agent<Env, PersonalReadmeProfile> {
  initialState = emptyProfile();

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "GET") {
      return jsonResponse(this.state);
    }

    if (request.method === "POST" || request.method === "PUT") {
      const payload = (await request.json()) as Partial<PersonalReadmeProfile>;
      const username = (payload.username ?? this.state.username).trim();
      if (!username) {
        return jsonResponse({ error: "username is required" }, 400);
      }

      await this.setState({
        ...this.state,
        ...payload,
        username
      });
      return jsonResponse(this.state);
    }

    return jsonResponse({ error: "method not allowed" }, 405);
  }
}
