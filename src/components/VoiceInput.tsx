import { useCallback, useRef, useState } from "react";

type VoiceInputProps = {
  onStart: (payload: { sampleRate: number }) => Promise<void>;
  onChunk: (payload: { audioBase64: string; sampleRate: number }) => Promise<void>;
  onStop: () => Promise<void>;
};

type VoiceStatus = "idle" | "connecting" | "recording" | "stopping";

const fluxSampleRate = 16000;

export function VoiceInput({ onStart, onChunk, onStop }: VoiceInputProps) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const sendChainRef = useRef<Promise<void>>(Promise.resolve());
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const isStreamingRef = useRef(false);

  const startRecording = useCallback(async () => {
    setError(null);
    setStatus("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      sendChainRef.current = Promise.resolve();
      isStreamingRef.current = true;

      await onStart({ sampleRate: fluxSampleRate });

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const sourceNode = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;
      const processorNode = audioContext.createScriptProcessor(8192, sourceNode.channelCount, 1);
      processorNodeRef.current = processorNode;

      processorNode.onaudioprocess = (event) => {
        if (!isStreamingRef.current) {
          return;
        }
        const mono = downmixInputToMono(event.inputBuffer);
        const resampled = resampleLinear(mono, event.inputBuffer.sampleRate, fluxSampleRate);
        const pcm = floatToInt16(resampled);
        const audioBase64 = bytesToBase64(new Uint8Array(pcm.buffer));
        sendChainRef.current = sendChainRef.current
          .then(() => onChunk({ audioBase64, sampleRate: fluxSampleRate }))
          .catch((err) => {
            setError(err instanceof Error ? err.message : "Failed to send audio chunk");
          });
      };

      sourceNode.connect(processorNode);
      processorNode.connect(audioContext.destination);

      setStatus("recording");
    } catch (err) {
      isStreamingRef.current = false;
      processorNodeRef.current?.disconnect();
      sourceNodeRef.current?.disconnect();
      processorNodeRef.current = null;
      sourceNodeRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
      audioContextRef.current = null;
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Failed to start voice stream");
    }
  }, [onChunk, onStart, onStop]);

  const stopRecording = useCallback(async () => {
    if (status !== "recording") {
      return;
    }

    setStatus("stopping");
    isStreamingRef.current = false;

    try {
      processorNodeRef.current?.disconnect();
      sourceNodeRef.current?.disconnect();
      processorNodeRef.current = null;
      sourceNodeRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (audioContextRef.current) {
        await audioContextRef.current.close();
      }
      audioContextRef.current = null;

      await sendChainRef.current;
      await onStop();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop voice stream");
    } finally {
      setStatus("idle");
    }
  }, [onStop, status]);

  return (
    <>
      {status === "idle" && (
        <button type="button" className="voice-btn" onClick={startRecording}>
          Start speech
        </button>
      )}
      {status === "connecting" && (
        <button type="button" className="voice-btn" disabled>
          Connecting…
        </button>
      )}
      {status === "recording" && (
        <button type="button" className="voice-btn voice-btn-stop" onClick={stopRecording}>
          Stop speech
        </button>
      )}
      {status === "stopping" && (
        <button type="button" className="voice-btn" disabled>
          Stopping…
        </button>
      )}
      {error ? (
        <span className="error voice-error">{error}</span>
      ) : null}
    </>
  );
}

const downmixInputToMono = (inputBuffer: AudioBuffer): Float32Array => {
  const { numberOfChannels, length } = inputBuffer;
  if (numberOfChannels <= 1) {
    return new Float32Array(inputBuffer.getChannelData(0));
  }

  const mono = new Float32Array(length);
  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    const data = inputBuffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      mono[index] += data[index] / numberOfChannels;
    }
  }
  return mono;
};

const resampleLinear = (
  samples: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array => {
  if (inputSampleRate === outputSampleRate) {
    return samples;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, samples.length - 1);
    const fraction = sourceIndex - left;
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }

  return output;
};

const floatToInt16 = (samples: Float32Array): Int16Array => {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    output[index] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return output;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};
