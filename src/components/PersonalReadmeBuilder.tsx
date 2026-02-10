import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAgent } from "agents/react";
import { emptyProfile, type PersonalReadmeProfile } from "../lib/personal-readme-types";

const normalizeUsername = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, "-");

type LauncherProps = {
  username?: never;
};

type EditorProps = {
  username: string;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function PersonalReadmeLauncher(_props: LauncherProps) {
  const [username, setUsername] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeUsername(username);
    if (!normalized) {
      return;
    }
    window.location.href = `/u/${encodeURIComponent(normalized)}`;
  };

  return (
    <main className="app-shell">
      <section className="panel">
        <h1>Personal README Builder</h1>
        <p>Create a profile page for a teammate.</p>

        <form onSubmit={handleSubmit} className="username-form">
          <label htmlFor="username">Username</label>
          <div className="row">
            <input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="jane-doe"
              required
            />
            <button type="submit">Open Profile</button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default function PersonalReadmeBuilder({ username }: EditorProps) {
  const normalizedUsername = normalizeUsername(username);
  const [draft, setDraft] = useState<PersonalReadmeProfile>(() => emptyProfile(normalizedUsername));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const onStateUpdate = useCallback(
    (nextState: PersonalReadmeProfile) => {
      setDraft((current) => ({
        ...current,
        ...nextState,
        username: normalizedUsername
      }));
    },
    [normalizedUsername]
  );

  const agent = useAgent<PersonalReadmeProfile>({
    agent: "PersonalReadmeAgent",
    name: normalizedUsername,
    onStateUpdate
  });
  useEffect(() => {
    setDraft(emptyProfile(normalizedUsername));
  }, [normalizedUsername]);

  const fields = useMemo(
    () =>
      [
        ["displayName", "Display name", "How should co-workers address you?"],
        ["role", "Role", "Your role and team"],
        ["timezone", "Timezone", "Ex: PT (UTC-8)"],
        ["communicationStyle", "Communication style", "Direct, detailed, async-first, etc."],
        ["collaborationPreferences", "Collaboration preferences", "Pairing, docs-first, brainstorming, etc."],
        ["feedbackPreferences", "Feedback preferences", "In-the-moment, async notes, 1:1, etc."],
        ["meetingPreferences", "Meeting preferences", "Preferred cadence and style"],
        ["focusHours", "Focus hours", "When should people avoid interruptions?"],
        ["strengths", "Strengths", "Where you can help most"],
        ["growthAreas", "Growth areas", "What you are learning right now"]
      ] as const,
    []
  );

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveStatus("saving");
    try {
      agent.setState({
        ...draft,
        username: normalizedUsername
      });
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  };

  return (
    <main className="app-shell">
      <section className="panel">
        <h1>Personal README Builder</h1>
        <p>Editing profile for @{normalizedUsername}</p>
        <p className="helper">
          <a href="/">Create/open a different profile</a>
        </p>

        <form onSubmit={saveProfile} className="card">
          <div className="form-grid">
            {fields.map(([key, label, placeholder]) => (
              <label key={key}>
                {label}
                <textarea
                  value={draft[key]}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSaveStatus("idle");
                    setDraft((current) => ({ ...current, [key]: value }));
                  }}
                  placeholder={placeholder}
                  rows={key === "communicationStyle" || key === "collaborationPreferences" ? 3 : 2}
                />
              </label>
            ))}
          </div>

          <div className="actions">
            <button type="submit">Save Profile</button>
            <span className="helper" aria-live="polite">
              {saveStatus === "saving" && "Saving..."}
              {saveStatus === "saved" && "Saved to Agent"}
              {saveStatus === "error" && "Save failed. Try again."}
            </span>
          </div>
        </form>
      </section>
    </main>
  );
}
