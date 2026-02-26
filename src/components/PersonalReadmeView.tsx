import { useMemo, useState } from "react";
import { useAgent } from "agents/react";
import { emptyProfile, type PersonalReadmeProfile } from "../lib/personal-readme-types";

type PersonalReadmeViewProps = {
  username: string;
};

const normalizeUsername = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, "-");

const renderFallback = (value: string, fallback: string): string => (value.trim() ? value : fallback);

export default function PersonalReadmeView({ username }: PersonalReadmeViewProps) {
  const normalizedUsername = normalizeUsername(username);
  const [profile, setProfile] = useState<PersonalReadmeProfile>(() => emptyProfile(normalizedUsername));

  const agent = useAgent<PersonalReadmeProfile>({
    agent: "PersonalReadmeAgent",
    name: normalizedUsername,
    onStateUpdate: (nextState) => {
      setProfile({
        username: normalizedUsername,
        displayName: nextState.displayName ?? "",
        role: nextState.role ?? "",
        timezone: nextState.timezone ?? "",
        communicationChannels: nextState.communicationChannels ?? [],
        communicationStyle: nextState.communicationStyle ?? "",
        collaborationPreferences: nextState.collaborationPreferences ?? [],
        collaborationNotes: nextState.collaborationNotes ?? "",
        feedbackPreferences: nextState.feedbackPreferences ?? [],
        meetingPreferences: nextState.meetingPreferences ?? [],
        focusHours: nextState.focusHours ?? "",
        strengths: nextState.strengths ?? "",
        growthAreaFocuses: nextState.growthAreaFocuses ?? [],
        growthAreas: nextState.growthAreas ?? ""
      });
    }
  });

  const titleName = useMemo(
    () => renderFallback(profile.displayName, `@${normalizedUsername}`),
    [profile.displayName, normalizedUsername]
  );

  return (
    <main className="app-shell">
      <article className="panel readme-page">
        <header className="readme-header">
          <p className="eyebrow">Live Personal README</p>
          <h1>{titleName}</h1>
          <p className="subtitle">
            {renderFallback(profile.role, "Role not set yet")}
            {"  •  "}
            {renderFallback(profile.timezone, "Timezone not set")}
          </p>
          <p className="helper">
            <a href={`/u/${encodeURIComponent(normalizedUsername)}`}>Edit profile</a>
            {"  •  "}
            <a href="/">Open another profile</a>
          </p>
        </header>

        <section className="readme-section">
          <h2>How To Work With Me</h2>
          <p>{renderFallback(profile.communicationStyle, "Communication style is not filled in yet.")}</p>
        </section>

        <section className="readme-grid">
          <section className="readme-section">
            <h2>Preferred Channels</h2>
            <ul>
              {profile.communicationChannels.length > 0 ? (
                profile.communicationChannels.map((channel) => <li key={channel}>{channel}</li>)
              ) : (
                <li>Not specified yet.</li>
              )}
            </ul>
          </section>

          <section className="readme-section">
            <h2>Collaboration Preferences</h2>
            <ul>
              {profile.collaborationPreferences.length > 0 ? (
                profile.collaborationPreferences.map((item) => <li key={item}>{item}</li>)
              ) : (
                <li>Not specified yet.</li>
              )}
            </ul>
            <p>{renderFallback(profile.collaborationNotes, "No collaboration notes yet.")}</p>
          </section>

          <section className="readme-section">
            <h2>Feedback And Meetings</h2>
            <h3>Feedback style</h3>
            <ul>
              {profile.feedbackPreferences.length > 0 ? (
                profile.feedbackPreferences.map((item) => <li key={item}>{item}</li>)
              ) : (
                <li>Not specified yet.</li>
              )}
            </ul>
            <h3>Meeting preferences</h3>
            <ul>
              {profile.meetingPreferences.length > 0 ? (
                profile.meetingPreferences.map((item) => <li key={item}>{item}</li>)
              ) : (
                <li>Not specified yet.</li>
              )}
            </ul>
          </section>

          <section className="readme-section">
            <h2>Focus, Strengths, Growth</h2>
            <h3>Focus hours</h3>
            <p>{renderFallback(profile.focusHours, "Not specified yet.")}</p>
            <h3>Strengths</h3>
            <p>{renderFallback(profile.strengths, "Not specified yet.")}</p>
            <h3>Growth focus areas</h3>
            <ul>
              {profile.growthAreaFocuses.length > 0 ? (
                profile.growthAreaFocuses.map((item) => <li key={item}>{item}</li>)
              ) : (
                <li>Not specified yet.</li>
              )}
            </ul>
            <h3>Growth notes</h3>
            <p>{renderFallback(profile.growthAreas, "Not specified yet.")}</p>
          </section>
        </section>
      </article>
    </main>
  );
}
