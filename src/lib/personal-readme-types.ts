export type PersonalReadmeProfile = {
  username: string;
  displayName: string;
  role: string;
  timezone: string;
  communicationStyle: string;
  collaborationPreferences: string;
  feedbackPreferences: string;
  meetingPreferences: string;
  focusHours: string;
  strengths: string;
  growthAreas: string;
};

export const emptyProfile = (username = ""): PersonalReadmeProfile => ({
  username,
  displayName: "",
  role: "",
  timezone: "",
  communicationStyle: "",
  collaborationPreferences: "",
  feedbackPreferences: "",
  meetingPreferences: "",
  focusHours: "",
  strengths: "",
  growthAreas: ""
});
