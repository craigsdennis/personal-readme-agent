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

export type PersonalReadmeProfile = z.output<typeof personalReadmeProfileSchema>;
export type PersonalReadmeProfileInput = z.input<typeof personalReadmeProfileSchema>;

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

export const emptyProfile = (username = ""): PersonalReadmeProfile =>
  personalReadmeProfileSchema.parse({
    username: username || "new-user"
  });
