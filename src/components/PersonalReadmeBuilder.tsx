import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAgent } from "agents/react";
import {
  collaborationPreferenceOptions,
  communicationChannelOptions,
  emptyProfile,
  feedbackPreferenceOptions,
  growthAreaFocusOptions,
  meetingPreferenceOptions,
  requiredProfileFields,
  timezoneOptions,
  type PersonalReadmeProfile,
  type SaveProfileResult
} from "../lib/personal-readme-types";

const normalizeUsername = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, "-");

type LauncherProps = {
  username?: never;
};

type EditorProps = {
  username: string;
};

type SaveStatus = "idle" | "saving" | "saved" | "validation" | "error";

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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

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
    setFieldErrors({});
  }, [normalizedUsername]);

  const completedRequired = useMemo(
    () =>
      requiredProfileFields.filter((field) => {
        const value = draft[field];
        return typeof value === "string" && value.trim().length > 0;
      }).length,
    [draft]
  );

  const setStringField = (field: keyof PersonalReadmeProfile, value: string) => {
    setSaveStatus("idle");
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const toggleOption = (
    field:
      | "communicationChannels"
      | "collaborationPreferences"
      | "feedbackPreferences"
      | "meetingPreferences"
      | "growthAreaFocuses",
    option: string,
    checked: boolean
  ) => {
    setSaveStatus("idle");
    setDraft((current) => {
      const nextValues = checked
        ? [...current[field], option]
        : current[field].filter((value) => value !== option);
      return { ...current, [field]: nextValues };
    });
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveStatus("saving");
    setFieldErrors({});

    try {
      const result = (await agent.stub.saveProfile({
        ...draft,
        username: normalizedUsername
      })) as SaveProfileResult;

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setSaveStatus("validation");
        return;
      }

      setDraft(result.state);
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
        <p className="helper">
          Required fields completed: {completedRequired}/{requiredProfileFields.length}
        </p>

        <form onSubmit={saveProfile} className="card">
          <div className="form-grid">
            <label>
              Display name
              <input
                value={draft.displayName}
                onChange={(event) => setStringField("displayName", event.target.value)}
                placeholder="How should teammates address you?"
              />
              {fieldErrors.displayName?.[0] ? <span className="error">{fieldErrors.displayName[0]}</span> : null}
            </label>

            <label>
              Role
              <input
                value={draft.role}
                onChange={(event) => setStringField("role", event.target.value)}
                placeholder="Your role and team"
              />
              {fieldErrors.role?.[0] ? <span className="error">{fieldErrors.role[0]}</span> : null}
            </label>

            <label>
              Timezone
              <select value={draft.timezone} onChange={(event) => setStringField("timezone", event.target.value)}>
                <option value="">Select a timezone</option>
                {timezoneOptions.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone}
                  </option>
                ))}
              </select>
              {fieldErrors.timezone?.[0] ? <span className="error">{fieldErrors.timezone[0]}</span> : null}
            </label>

            <label>
              Communication style notes
              <textarea
                value={draft.communicationStyle}
                onChange={(event) => setStringField("communicationStyle", event.target.value)}
                placeholder="Direct, detailed, async-first, etc."
                rows={3}
              />
            </label>

            <fieldset>
              <legend>Preferred channels</legend>
              {communicationChannelOptions.map((option) => (
                <label key={option} className="check-row">
                  <input
                    type="checkbox"
                    checked={draft.communicationChannels.includes(option)}
                    onChange={(event) =>
                      toggleOption("communicationChannels", option, event.currentTarget.checked)
                    }
                  />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>

            <fieldset>
              <legend>Collaboration preferences</legend>
              {collaborationPreferenceOptions.map((option) => (
                <label key={option} className="check-row">
                  <input
                    type="checkbox"
                    checked={draft.collaborationPreferences.includes(option)}
                    onChange={(event) =>
                      toggleOption("collaborationPreferences", option, event.currentTarget.checked)
                    }
                  />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>

            <fieldset>
              <legend>Feedback preferences</legend>
              {feedbackPreferenceOptions.map((option) => (
                <label key={option} className="check-row">
                  <input
                    type="checkbox"
                    checked={draft.feedbackPreferences.includes(option)}
                    onChange={(event) => toggleOption("feedbackPreferences", option, event.currentTarget.checked)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>

            <fieldset>
              <legend>Meeting preferences</legend>
              {meetingPreferenceOptions.map((option) => (
                <label key={option} className="check-row">
                  <input
                    type="checkbox"
                    checked={draft.meetingPreferences.includes(option)}
                    onChange={(event) => toggleOption("meetingPreferences", option, event.currentTarget.checked)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>

            <fieldset>
              <legend>Growth focus areas</legend>
              {growthAreaFocusOptions.map((option) => (
                <label key={option} className="check-row">
                  <input
                    type="checkbox"
                    checked={draft.growthAreaFocuses.includes(option)}
                    onChange={(event) => toggleOption("growthAreaFocuses", option, event.currentTarget.checked)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>

            <label>
              Collaboration notes
              <textarea
                value={draft.collaborationNotes}
                onChange={(event) => setStringField("collaborationNotes", event.target.value)}
                placeholder="Pairing, docs-first workflow, handoff expectations, etc."
                rows={3}
              />
            </label>

            <label>
              Focus hours
              <input
                value={draft.focusHours}
                onChange={(event) => setStringField("focusHours", event.target.value)}
                placeholder="When should people avoid interruptions?"
              />
            </label>

            <label>
              Strengths
              <textarea
                value={draft.strengths}
                onChange={(event) => setStringField("strengths", event.target.value)}
                placeholder="Where you can help most"
                rows={3}
              />
            </label>

            <label>
              Growth notes
              <textarea
                value={draft.growthAreas}
                onChange={(event) => setStringField("growthAreas", event.target.value)}
                placeholder="What you are learning right now"
                rows={3}
              />
            </label>
          </div>

          <div className="actions">
            <button type="submit">Save Profile</button>
            <span className="helper" aria-live="polite">
              {saveStatus === "saving" && "Saving..."}
              {saveStatus === "saved" && "Saved to Agent"}
              {saveStatus === "validation" && "Please fix validation errors"}
              {saveStatus === "error" && "Save failed. Try again."}
            </span>
          </div>
        </form>
      </section>
    </main>
  );
}
