import { z } from "zod";

export const timezoneOptions = [
  "PT (UTC-8/-7)",
  "MT (UTC-7/-6)",
  "CT (UTC-6/-5)",
  "ET (UTC-5/-4)",
  "UTC",
  "Other"
] as const;

export const communicationChannelOptions = [
  "Slack",
  "Email",
  "Docs/comments",
  "Video call",
  "Issue tracker"
] as const;

export const collaborationPreferenceOptions = [
  "Pair programming",
  "Async docs first",
  "Live whiteboarding",
  "Small-group planning"
] as const;

export const feedbackPreferenceOptions = [
  "Direct and concise",
  "Context first, then feedback",
  "Written async feedback",
  "Real-time verbal feedback"
] as const;

export const meetingPreferenceOptions = [
  "Minimal meetings",
  "Regular check-ins",
  "Agenda required",
  "No-meeting focus blocks"
] as const;

export const growthAreaFocusOptions = [
  "System design",
  "Technical writing",
  "Public speaking",
  "Mentorship",
  "Project planning"
] as const;

export const requiredProfileFields = ["displayName", "role", "timezone"] as const;

const splitLegacyList = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
};

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens");

export const personalReadmeProfileSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().max(80).default(""),
  role: z.string().trim().max(120).default(""),
  timezone: z.union([z.enum(timezoneOptions), z.literal("")]).default(""),
  communicationChannels: z.preprocess(
    splitLegacyList,
    z.array(z.enum(communicationChannelOptions)).default([])
  ),
  collaborationPreferences: z.preprocess(
    splitLegacyList,
    z.array(z.enum(collaborationPreferenceOptions)).default([])
  ),
  feedbackPreferences: z.preprocess(
    splitLegacyList,
    z.array(z.enum(feedbackPreferenceOptions)).default([])
  ),
  meetingPreferences: z.preprocess(
    splitLegacyList,
    z.array(z.enum(meetingPreferenceOptions)).default([])
  ),
  growthAreaFocuses: z.preprocess(splitLegacyList, z.array(z.enum(growthAreaFocusOptions)).default([])),
  communicationStyle: z.string().trim().max(300).default(""),
  collaborationNotes: z.string().trim().max(300).default(""),
  focusHours: z.string().trim().max(120).default(""),
  strengths: z.string().trim().max(500).default(""),
  growthAreas: z.string().trim().max(500).default("")
});

export const personalReadmeSaveSchema = personalReadmeProfileSchema.superRefine((profile, ctx) => {
  if (!profile.displayName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["displayName"],
      message: "Display name is required"
    });
  }

  if (!profile.role) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["role"],
      message: "Role is required"
    });
  }

  if (!profile.timezone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["timezone"],
      message: "Choose a timezone"
    });
  }
});

export const personalReadmeProfilePatchSchema = z
  .object({
    displayName: z.string().trim().max(80).optional(),
    role: z.string().trim().max(120).optional(),
    timezone: z.enum(timezoneOptions).optional(),
    communicationChannels: z.array(z.enum(communicationChannelOptions)).optional(),
    collaborationPreferences: z.array(z.enum(collaborationPreferenceOptions)).optional(),
    feedbackPreferences: z.array(z.enum(feedbackPreferenceOptions)).optional(),
    meetingPreferences: z.array(z.enum(meetingPreferenceOptions)).optional(),
    growthAreaFocuses: z.array(z.enum(growthAreaFocusOptions)).optional(),
    communicationStyle: z.string().trim().max(300).optional(),
    collaborationNotes: z.string().trim().max(300).optional(),
    focusHours: z.string().trim().max(120).optional(),
    strengths: z.string().trim().max(500).optional(),
    growthAreas: z.string().trim().max(500).optional()
  })
  .strict();

export const personalReadmeModelPatchSchema = z
  .object({
    displayName: z.string().trim().max(80).nullable(),
    role: z.string().trim().max(120).nullable(),
    timezone: z.enum(timezoneOptions).nullable(),
    communicationChannels: z
      .object({
        add: z.array(z.enum(communicationChannelOptions)),
        remove: z.array(z.enum(communicationChannelOptions))
      })
      .strict(),
    collaborationPreferences: z
      .object({
        add: z.array(z.enum(collaborationPreferenceOptions)),
        remove: z.array(z.enum(collaborationPreferenceOptions))
      })
      .strict(),
    feedbackPreferences: z
      .object({
        add: z.array(z.enum(feedbackPreferenceOptions)),
        remove: z.array(z.enum(feedbackPreferenceOptions))
      })
      .strict(),
    meetingPreferences: z
      .object({
        add: z.array(z.enum(meetingPreferenceOptions)),
        remove: z.array(z.enum(meetingPreferenceOptions))
      })
      .strict(),
    growthAreaFocuses: z
      .object({
        add: z.array(z.enum(growthAreaFocusOptions)),
        remove: z.array(z.enum(growthAreaFocusOptions))
      })
      .strict(),
    communicationStyle: z.string().trim().max(300).nullable(),
    collaborationNotes: z.string().trim().max(300).nullable(),
    focusHours: z.string().trim().max(120).nullable(),
    strengths: z.string().trim().max(500).nullable(),
    growthAreas: z.string().trim().max(500).nullable()
  })
  .strict();

export type PersonalReadmeProfile = z.output<typeof personalReadmeProfileSchema>;
export type PersonalReadmeProfileInput = z.input<typeof personalReadmeProfileSchema>;
export type PersonalReadmeProfilePatch = z.output<typeof personalReadmeProfilePatchSchema>;
export type PersonalReadmeModelPatch = z.output<typeof personalReadmeModelPatchSchema>;

export type AgentRuntimeDiagnostics = {
  hasOpenAIKey: boolean;
  openAIKeyLength: number;
};

export type SaveProfileResult =
  | {
      ok: true;
      state: PersonalReadmeProfile;
    }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
    };

export type UpdateFromTextResult =
  | {
      ok: true;
      state: PersonalReadmeProfile;
      patch: PersonalReadmeProfilePatch;
      diagnostics: AgentRuntimeDiagnostics;
    }
  | {
      ok: false;
      error: string;
      diagnostics: AgentRuntimeDiagnostics;
      cause?: string;
    };

export const emptyProfile = (username = ""): PersonalReadmeProfile =>
  personalReadmeProfileSchema.parse({
    username: username || "new-user"
  });
