import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAgent } from "agents/react";
import {
  type AgentRuntimeDiagnostics,
  type TextUpdateJob,
  collaborationPreferenceOptions,
  communicationChannelOptions,
  emptyProfile,
  feedbackPreferenceOptions,
  growthAreaFocusOptions,
  meetingPreferenceOptions,
  normalizeProfileState,
  requiredProfileFields,
  textUpdateJobsSchema,
  timezoneOptions,
  type PersonalReadmeProfile,
  type SaveProfileResult,
  type UpdateFromTextResult
} from "../lib/personal-readme-types";
import { VoiceInput } from "./VoiceInput";

const normalizeUsername = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, "-");

type LauncherProps = {
  username?: never;
};

type EditorProps = {
  username: string;
};

type SaveStatus = "idle" | "saving" | "saved" | "validation" | "error";
type DebugStatus = "idle" | "applying" | "applied" | "checking" | "error";

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
  const [debugText, setDebugText] = useState("");
  const [debugStatus, setDebugStatus] = useState<DebugStatus>("idle");
  const [debugMessage, setDebugMessage] = useState("");
  const [debugErrorDetails, setDebugErrorDetails] = useState("");
  const [debugDiagnostics, setDebugDiagnostics] = useState<AgentRuntimeDiagnostics | null>(null);
  const [debugJobs, setDebugJobs] = useState<TextUpdateJob[]>([]);

  const agent = useAgent<PersonalReadmeProfile>({
    agent: "PersonalReadmeAgent",
    name: normalizedUsername,
    onStateUpdate: (nextState) => {
      setDraft(normalizeProfileState({ ...nextState, username: normalizedUsername }, normalizedUsername));
    }
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

  const applyDebugText = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDebugStatus("applying");
    setDebugMessage("");
    setDebugErrorDetails("");
    setDebugDiagnostics(null);

    try {
      const result = (await agent.stub.updateFromText({
        text: debugText
      })) as UpdateFromTextResult;

      if (!result.ok) {
        setDebugStatus("error");
        setDebugMessage("Could not apply text update.");
        setDebugErrorDetails(result.cause ? `${result.error}: ${result.cause}` : result.error);
        setDebugDiagnostics(result.diagnostics);
        return;
      }

      setDebugStatus("applied");
      setDebugMessage("Text update queued.");
      setDebugJobs(textUpdateJobsSchema.parse(result.jobs));
      setDebugText("");
    } catch {
      setDebugStatus("error");
      setDebugMessage("Could not apply text update.");
      setDebugErrorDetails(
        "Request failed before a valid response. Check Workers AI binding, network access, and that your text is not empty."
      );
    }
  };

  const checkRuntimeDiagnostics = async () => {
    setDebugStatus("checking");
    setDebugMessage("");
    setDebugErrorDetails("");

    try {
      const diagnostics = (await agent.stub.getRuntimeDiagnostics()) as AgentRuntimeDiagnostics;
      setDebugDiagnostics(diagnostics);
      setDebugStatus("idle");
    } catch {
      setDebugStatus("error");
      setDebugMessage("Could not fetch runtime diagnostics.");
      setDebugErrorDetails("Agent RPC failed while reading runtime env values.");
    }
  };

  useEffect(() => {
    let active = true;
    const refreshJobs = async () => {
      try {
        const jobs = (await agent.stub.getTextUpdateJobs()) as TextUpdateJob[];
        if (active) {
          setDebugJobs(textUpdateJobsSchema.parse(jobs));
        }
      } catch {
        // Ignore transient RPC errors during reconnects.
      }
    };

    void refreshJobs();
    const intervalId = window.setInterval(refreshJobs, 1500);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [agent]);

  return (
    <main className="app-shell">
      <section className="panel">
        <h1>Personal README Builder</h1>
        <p>Editing profile for @{normalizedUsername}</p>
        <p className="helper">
          <a href="/">Create/open a different profile</a>
          {"  •  "}
          <a href={`/u/${encodeURIComponent(normalizedUsername)}/view`}>Read-only view</a>
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

        <section className="card debug-card">
          <h2>Update From Text</h2>
          <p className="helper">Type or speak, then apply to update your profile.</p>
          <form onSubmit={applyDebugText}>
            <label>
              Text input
              <textarea
                value={debugText}
                onChange={(event) => setDebugText(event.target.value)}
                placeholder="Example: I'm in ET, prefer async docs first, and like direct feedback."
                rows={4}
              />
            </label>
            <div className="actions">
              <button type="submit">Apply text update</button>
              <VoiceInput
                onTranscript={(text) =>
                  setDebugText((prev) => (prev ? `${prev}\n${text}` : text))
                }
              />
              <button type="button" onClick={checkRuntimeDiagnostics}>
                Check runtime env
              </button>
              <span className="helper" aria-live="polite">
                {debugStatus === "applying" && "Applying..."}
                {debugStatus === "checking" && "Checking runtime env..."}
                {debugStatus === "applied" && debugMessage}
                {debugStatus === "error" && debugMessage}
              </span>
            </div>
          </form>
          {debugStatus === "error" ? (
            <div className="error-panel" role="alert">
              <strong>{debugMessage}</strong>
              <p className="helper">Details: {debugErrorDetails}</p>
              <p className="helper">
                Quick checks: ensure `AI` binding is configured, use non-empty text, and ensure the selected model
                supports structured JSON.
              </p>
            </div>
          ) : null}
          {debugJobs.length > 0 ? (
            <div className="job-list">
              <div className="job-list-header">
                <h3>Queued updates</h3>
                <button
                  type="button"
                  className="btn-clear"
                  onClick={async () => {
                    await agent.stub.clearTextUpdateJobs();
                    setDebugJobs([]);
                  }}
                >
                  Clear history
                </button>
              </div>
              <ul>
                {debugJobs.map((job) => (
                  <li key={job.id}>
                    <strong>{job.status}</strong> - {job.text}
                    {job.error ? <span className="job-error"> ({job.error})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
