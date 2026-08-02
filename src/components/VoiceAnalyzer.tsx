import { useState } from "react";
import {
  analyzeCapturedFrames,
  clippedSampleRatio,
  estimatePitchYin,
  rootMeanSquare,
  spectralCentroidFromDecibels,
  type AnalysisFailure,
  type AnalysisResult,
  type CapturedFrame,
} from "../lib/audio-analysis";

type Status = "idle" | "requesting" | "recording" | "processing" | "result" | "error";

type ToolError = {
  title: string;
  message: string;
};

const recordingSeconds = 5;

const failureMessages: Record<AnalysisFailure, ToolError> = {
  "too-quiet": {
    title: "We couldn't hear enough voice",
    message: "Move a little closer to the microphone, speak at a comfortable volume, and try again.",
  },
  clipping: {
    title: "The recording was too loud",
    message: "Move slightly farther from the microphone and try again without raising your voice.",
  },
  "low-confidence": {
    title: "The signal was hard to measure",
    message: "Try a quieter room, use a steady speaking voice, and keep the same distance from your microphone.",
  },
};

const errorFromUnknown = (error: unknown): ToolError => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return {
        title: "Microphone access is blocked",
        message: "Allow microphone access in your browser settings, then return here and try again.",
      };
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return {
        title: "No microphone was found",
        message: "Connect or enable a microphone, then try the test again.",
      };
    }
    if (error.name === "AbortError" || error.name === "NotReadableError") {
      return {
        title: "The microphone was interrupted",
        message: "Close other apps using the microphone and try again.",
      };
    }
  }

  return {
    title: "The recording could not be processed",
    message: "Nothing was saved. Check your microphone and try once more.",
  };
};

const formatHz = (value: number) => `${Math.round(value)} Hz`;

const copyText = async (text: string) => {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
  await navigator.clipboard.writeText(text);
};

export default function VoiceAnalyzer() {
  const [status, setStatus] = useState<Status>("idle");
  const [secondsLeft, setSecondsLeft] = useState(recordingSeconds);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  const [shareMessage, setShareMessage] = useState("");

  const reset = () => {
    setStatus("idle");
    setSecondsLeft(recordingSeconds);
    setResult(null);
    setError(null);
    setShareMessage("");
  };

  const shareResult = async () => {
    if (!result) return;

    const text = [
      "My Voice Gender Test acoustic snapshot:",
      `Median pitch: ${formatHz(result.medianPitchHz)} (${result.pitchBand})`,
      `Pitch movement: ${result.variabilityBand} (${result.pitchVariabilitySemitones.toFixed(1)} semitone IQR)`,
      `Spectral balance: ${result.brightnessBand} (${formatHz(result.spectralCentroidHz)} brightness proxy)`,
      `Recording quality: ${result.qualityBand} (${Math.round(result.voicedCoverage * 100)}% measurable frames)`,
      "These measurements describe one recording, not gender identity.",
    ].join("\n");
    const shareData = {
      title: "My Voice Gender Test result",
      text,
      url: "https://voicegendertest.com/",
    };
    const copyValue = `${text}\n${shareData.url}`;

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setShareMessage("Result shared.");
        return;
      }

      await copyText(copyValue);
      setShareMessage("Result copied to your clipboard.");
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;

      try {
        await copyText(copyValue);
        setShareMessage("Result copied to your clipboard.");
      } catch {
        setShareMessage("Sharing is unavailable in this browser. You can still take a screenshot of the result.");
      }
    }
  };

  const startRecording = async () => {
    setError(null);
    setResult(null);

    if (!window.isSecureContext) {
      setError({
        title: "A secure connection is required",
        message: "Open this tool over HTTPS or localhost so your browser can safely grant microphone access.",
      });
      setStatus("error");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      setError({
        title: "This browser cannot run the test",
        message: "Try the latest version of Chrome, Edge, Firefox, or Safari on a device with a microphone.",
      });
      setStatus("error");
      return;
    }

    setStatus("requesting");
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
          channelCount: 1,
        },
      });

      context = new AudioContext();
      await context.resume();

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.15;
      source.connect(analyser);

      const timeData = new Float32Array(analyser.fftSize);
      const frequencyData = new Float32Array(analyser.frequencyBinCount);
      const frames: CapturedFrame[] = [];

      setSecondsLeft(recordingSeconds);
      setStatus("recording");
      const startedAt = performance.now();

      await new Promise<void>((resolve) => {
        const captureTimer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(timeData);
          analyser.getFloatFrequencyData(frequencyData);
          const rms = rootMeanSquare(timeData);
          const pitch = estimatePitchYin(timeData, context!.sampleRate);

          frames.push({
            rms,
            clippingRatio: clippedSampleRatio(timeData),
            pitch,
            spectralCentroidHz:
              pitch === null
                ? null
                : spectralCentroidFromDecibels(
                    frequencyData,
                    context!.sampleRate,
                    analyser.fftSize,
                  ),
          });

          const elapsedSeconds = (performance.now() - startedAt) / 1_000;
          setSecondsLeft(Math.max(1, Math.ceil(recordingSeconds - elapsedSeconds)));
        }, 90);

        window.setTimeout(() => {
          window.clearInterval(captureTimer);
          resolve();
        }, recordingSeconds * 1_000);
      });

      setStatus("processing");
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
      await context.close();
      context = null;

      const analysis = analyzeCapturedFrames(frames);
      if (!analysis.ok) {
        setError(failureMessages[analysis.reason]);
        setStatus("error");
        return;
      }

      setResult(analysis.result);
      setStatus("result");
    } catch (caughtError) {
      setError(errorFromUnknown(caughtError));
      setStatus("error");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") await context.close();
    }
  };

  const summary = result
    ? `This sample had a ${result.pitchBand} median pitch, ${result.variabilityBand} pitch movement, and a ${result.brightnessBand} spectral balance.`
    : "";

  return (
    <section className="analyzer-card" aria-labelledby="analyzer-title">
      <div className="analyzer-heading">
        <span className="eyebrow"><span className="status-dot" /> Local analysis</span>
        <h2 id="analyzer-title">Hear your voice in a new way</h2>
        <p>Read the phrase naturally. Five seconds is enough for a first acoustic snapshot.</p>
      </div>

      <div className="prompt-box">
        <span>Suggested phrase</span>
        <q>Today I’m checking how my voice sounds in this short recording.</q>
      </div>

      <div className="tool-stage" aria-live="polite" data-clarity-mask="true">
        {status === "idle" && (
          <>
            <div className="mic-orbit" aria-hidden="true"><span className="mic-icon">●</span></div>
            <button className="primary-button" type="button" onClick={startRecording}>
              Start voice test
            </button>
            <p className="microcopy">Your browser will ask for microphone access.</p>
          </>
        )}

        {status === "requesting" && (
          <div className="working-state">
            <span className="loader" aria-hidden="true" />
            <strong>Waiting for microphone permission…</strong>
            <p>Choose Allow in your browser to begin.</p>
          </div>
        )}

        {status === "recording" && (
          <div className="recording-state">
            <div className="countdown-ring" aria-label={`${secondsLeft} seconds remaining`}>
              <span>{secondsLeft}</span>
            </div>
            <strong>Recording your natural speaking voice</strong>
            <div className="level-bars" aria-hidden="true">
              {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
            </div>
            <p>Keep speaking until the timer finishes.</p>
          </div>
        )}

        {status === "processing" && (
          <div className="working-state">
            <span className="loader" aria-hidden="true" />
            <strong>Measuring this recording…</strong>
            <p>Audio is being analyzed on this device.</p>
          </div>
        )}

        {status === "error" && error && (
          <div className="error-state" role="alert">
            <span className="error-symbol" aria-hidden="true">!</span>
            <strong>{error.title}</strong>
            <p>{error.message}</p>
            <button className="secondary-button" type="button" onClick={reset}>Try again</button>
          </div>
        )}

        {status === "result" && result && (
          <div className="result-state">
            <div className="result-intro">
              <span className="result-kicker">Your acoustic snapshot</span>
              <h3>{summary}</h3>
              <p>These are descriptive sound measurements, not a score you need to improve.</p>
            </div>

            <div className="metric-grid">
              <article className="metric-card">
                <span>Median pitch</span>
                <strong>{formatHz(result.medianPitchHz)}</strong>
                <small>{result.pitchBand} in this sample</small>
              </article>
              <article className="metric-card">
                <span>Pitch movement</span>
                <strong>{result.variabilityBand}</strong>
                <small>{result.pitchVariabilitySemitones.toFixed(1)} semitone IQR</small>
              </article>
              <article className="metric-card">
                <span>Spectral balance</span>
                <strong>{result.brightnessBand}</strong>
                <small>{formatHz(result.spectralCentroidHz)} brightness proxy</small>
              </article>
              <article className="metric-card">
                <span>Recording quality</span>
                <strong>{result.qualityBand}</strong>
                <small>{Math.round(result.voicedCoverage * 100)}% measurable frames</small>
              </article>
            </div>

            <div className="result-note">
              <strong>This result describes this recording, not your gender identity.</strong>
              <p>Voice perception also involves resonance, articulation, context, and listener expectations that this browser test cannot fully measure.</p>
            </div>

            <div className="result-actions">
              <button className="primary-button" type="button" onClick={shareResult}>Share result</button>
              <button className="secondary-button" type="button" onClick={reset}>Record again</button>
            </div>
            <p className="share-message" role="status" aria-live="polite">{shareMessage}</p>
          </div>
        )}
      </div>

      <div className="privacy-line">
        <span aria-hidden="true">◆</span>
        <p><strong>No upload.</strong> Your audio is measured in this browser and discarded after the test.</p>
      </div>
    </section>
  );
}
