import { z } from "zod";
import {
  type PersonalReadmeModelPatch,
  communicationChannelOptions,
  collaborationPreferenceOptions,
  feedbackPreferenceOptions,
  growthAreaFocusOptions,
  meetingPreferenceOptions,
  personalReadmeModelPatchSchema,
  timezoneOptions
} from "./personal-readme-types";

export const workersAIModel = "@cf/zai-org/glm-4.7-flash";
export const workersAIFluxModel = "@cf/deepgram/flux";

export const modelPatchJsonSchema = {
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

export function extractStructuredObject(response: unknown): unknown {
  if (!response || typeof response !== "object") {
    throw new Error("Workers AI returned an empty response");
  }

  const obj = response as Record<string, unknown>;

  if (obj.response && typeof obj.response === "string") {
    return JSON.parse(obj.response);
  }

  const choices = obj.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown>;
    const message = first.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (typeof content === "string") {
      return JSON.parse(content);
    }
  }

  return obj;
}

export const normalizeModelPatchFromAI = (aiResponse: unknown): PersonalReadmeModelPatch =>
  personalReadmeModelPatchSchema.parse(coerceModelPatch(extractStructuredObject(aiResponse)));

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
    .passthrough();
}

function normalizeListOps<T extends string>(
  value: { add?: readonly T[]; remove?: readonly T[] } | undefined
): { add: T[]; remove: T[] } {
  return {
    add: value?.add ? [...value.add] : [],
    remove: value?.remove ? [...value.remove] : []
  };
}

function coerceModelPatch(rawPatch: unknown): PersonalReadmeModelPatch {
  const parsed = looseModelPatchSchema.parse(rawPatch);

  const timezoneValue =
    parsed.timezone && timezoneOptions.includes(parsed.timezone) ? parsed.timezone : null;

  return {
    displayName: parsed.displayName ?? null,
    role: parsed.role ?? null,
    timezone: timezoneValue,
    communicationChannels: normalizeListOps(parsed.communicationChannels),
    collaborationPreferences: normalizeListOps(parsed.collaborationPreferences),
    feedbackPreferences: normalizeListOps(parsed.feedbackPreferences),
    meetingPreferences: normalizeListOps(parsed.meetingPreferences),
    growthAreaFocuses: normalizeListOps(parsed.growthAreaFocuses),
    communicationStyle: parsed.communicationStyle ?? parsed.bio ?? null,
    collaborationNotes: parsed.collaborationNotes ?? null,
    focusHours: parsed.focusHours ?? null,
    strengths: parsed.strengths ?? null,
    growthAreas: parsed.growthAreas ?? parsed.goals ?? null
  };
}
