import { useCallback, useRef, useState } from "react";

type VoiceInputProps = {
  onTranscript: (text: string) => void;
};

type VoiceStatus = "idle" | "recording" | "transcribing";

export function VoiceInput({ onTranscript }: VoiceInputProps) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (chunksRef.current.length === 0) {
          setStatus("idle");
          return;
        }
        setStatus("transcribing");
        const blob = new Blob(chunksRef.current, { type: mime });
        try {
          const res = await fetch("/api/deepgram-transcribe", {
            method: "POST",
            headers: { "Content-Type": blob.type },
            body: blob
          });
          const data = (await res.json()) as {
            transcript?: string;
            error?: string;
            detail?: string;
          };
          if (!res.ok) {
            setError(
              data.detail
                ? `${data.error ?? "Transcription failed"} — ${data.detail}`
                : data.error ?? "Transcription failed"
            );
            return;
          }
          if (data.transcript?.trim()) {
            onTranscript(data.transcript);
          }
        } catch {
          setError("Failed to transcribe");
        } finally {
          setStatus("idle");
        }
      };
      recorder.start();
      setStatus("recording");
    } catch {
      setError("Microphone access denied");
    }
  }, [onTranscript]);

  const stopRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec?.state === "recording") {
      rec.stop();
    }
  }, []);

  return (
    <>
      {status === "idle" && (
        <button type="button" className="voice-btn" onClick={startRecording}>
          Start speech
        </button>
      )}
      {status === "recording" && (
        <button type="button" className="voice-btn voice-btn-stop" onClick={stopRecording}>
          Stop speech
        </button>
      )}
      {status === "transcribing" && (
        <button type="button" className="voice-btn" disabled>
          Transcribing…
        </button>
      )}
      {error ? (
        <span className="error voice-error">{error}</span>
      ) : null}
    </>
  );
}
