import { AgentWorkflow, type AgentWorkflowStep } from "agents/workflows";
import {
  modelPatchJsonSchema,
  normalizeModelPatchFromAI,
  workersAIModel
} from "../lib/personal-readme-ai";
import {
  textUpdateWorkflowParamsSchema,
  textUpdateWorkflowResultSchema,
  type TextUpdateWorkflowResult
} from "../lib/personal-readme-types";
import type { PersonalReadmeAgent } from "../agents/personal-readme-agent";

export class PersonalReadmeTextUpdateWorkflow extends AgentWorkflow<
  PersonalReadmeAgent,
  { jobId: string; text: string },
  { step: string; status: "running" | "complete" }
> {
  async run(event: Readonly<{ payload: { jobId: string; text: string } }>, step: AgentWorkflowStep) {
    const payload = textUpdateWorkflowParamsSchema.parse(event.payload);
    await this.reportProgress({ step: "extract", status: "running" });

    const result = await step.do("extract-profile-patch", async () => {
      const response = await (this.env.AI as any).run(workersAIModel, {
        messages: [
          {
            role: "system",
            content:
              "Extract profile updates from the user's text. For text fields return null when not mentioned. " +
              "For list fields return add/remove arrays and never replace entire lists."
          },
          { role: "user", content: payload.text }
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

      return textUpdateWorkflowResultSchema.parse({
        jobId: payload.jobId,
        patch: normalizeModelPatchFromAI(response)
      } satisfies TextUpdateWorkflowResult);
    });

    await this.reportProgress({ step: "extract", status: "complete" });
    await step.reportComplete(result);
    return result;
  }
}
