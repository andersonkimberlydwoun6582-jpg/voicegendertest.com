import { useState } from "react";
import {
  classifyInputLevel,
  analyzeCapturedFrames,
  clippedSampleRatio,
  estimatePitchYin,
  rootMeanSquare,
  spectralCentroidFromDecibels,
  type AnalysisFailure,
  type AnalysisResult,
  type CapturedFrame,
  type InputLevel,
} from "../lib/audio-analysis";
import { trackVoiceEvent, type VoiceAnalyticsParams } from "../lib/analytics";
import { compareResults } from "../lib/result-comparison";

type Status = "idle" | "requesting" | "recording" | "processing" | "result" | "error";

type ToolError = {
  title: string;
  message: string;
  reason: NonNullable<VoiceAnalyticsParams["reason"]>;
};

const recordingSeconds = 5;

const failureMessages: Record<AnalysisFailure, ToolError> = {
  "too-quiet": {
    title: "We couldn't hear enough voice",
    message: "Move a little closer to the microphone, speak at a comfortable volume, and try again.",
    reason: "too_quiet",
  },
  clipping: {
    title: "The recording was too loud",
    message: "Move slightly farther from the microphone and try again without raising your voice.",
    reason: "clipping",
  },
  "low-confidence": {
    title: "The signal was hard to measure",
    message: "Try a quieter room, use a steady speaking voice, and keep the same distance from your microphone.",
    reason: "low_confidence",
  },
};

const errorFromUnknown = (error: unknown): ToolError => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return {
        title: "Microphone access is blocked",
        message: "Allow microphone access in your browser settings, then return here and try again.",
        reason: "permission",
      };
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return {
        title: "No microphone was found",
        message: "Connect or enable a microphone, then try the test again.",
        reason: "no_microphone",
      };
    }
    if (error.name === "AbortError" || error.name === "NotReadableError") {
      return {
        title: "The microphone was interrupted",
        message: "Close other apps using the microphone and try again.",
        reason: "interrupted",
      };
    }
  }

  return {
    title: "The recording could not be processed",
    message: "Nothing was saved. Check your microphone and try once more.",
    reason: "processing",
  };
};

const inputLevelCopy: Record<InputLevel, string> = {
  quiet: "Too quiet — move a little closer",
  good: "Good level — keep speaking",
  loud: "Too loud — move slightly farther away",
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
  const [previousResult, setPreviousResult] = useState<AnalysisResult | null>(null);
  const [inputLevel, setInputLevel] = useState<InputLevel>("quiet");
  const [error, setError] = useState<ToolError | null>(null);
  const [shareMessage, setShareMessage] = useState("");

  const reset = () => {
    setStatus("idle");
    setSecondsLeft(recordingSeconds);
    setInputLevel("quiet");
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
    const canNativeShare = typeof navigator.share === "function";

    if (canNativeShare) {
      trackVoiceEvent("voice_share_attempt", { method: "native" });
      try {
        await navigator.share(shareData);
        trackVoiceEvent("voice_share_result", { method: "native", status: "success" });
        setShareMessage("Result shared.");
        return;
      } catch (shareError) {
        if (shareError instanceof DOMException && shareError.name === "AbortError") {
          trackVoiceEvent("voice_share_result", { method: "native", status: "cancelled" });
          return;
        }
        trackVoiceEvent("voice_share_result", { method: "native", status: "failed" });
      }
    }

    trackVoiceEvent("voice_share_attempt", { method: "clipboard" });
    try {
      await copyText(copyValue);
      trackVoiceEvent("voice_share_result", { method: "clipboard", status: "success" });
      setShareMessage("Result copied to your clipboard.");
    } catch {
      trackVoiceEvent("voice_share_result", { method: "clipboard", status: "failed" });
      setShareMessage("Sharing is unavailable in this browser. You can still take a screenshot of the result.");
    }
  };

  const startRecording = async () => {
    trackVoiceEvent("voice_test_start");
    setError(null);
    setResult(null);
    setShareMessage("");
    setInputLevel("quiet");

    if (!window.isSecureContext) {
      const nextError: ToolError = {
        title: "A secure connection is required",
        message: "Open this tool over HTTPS or localhost so your browser can safely grant microphone access.",
        reason: "insecure_context",
      };
      setError(nextError);
      setStatus("error");
      trackVoiceEvent("mic_permission_result", { status: "unavailable" });
      trackVoiceEvent("voice_test_error", { reason: nextError.reason });
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      const nextError: ToolError = {
        title: "This browser cannot run the test",
        message: "Try the latest version of Chrome, Edge, Firefox, or Safari on a device with a microphone.",
        reason: "unsupported_browser",
      };
      setError(nextError);
      setStatus("error");
      trackVoiceEvent("mic_permission_result", { status: "unavailable" });
      trackVoiceEvent("voice_test_error", { reason: nextError.reason });
      return;
    }

    setStatus("requesting");
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let microphoneGranted = false;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
          channelCount: 1,
        },
      });
      microphoneGranted = true;
      trackVoiceEvent("mic_permission_result", { status: "granted" });

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
          const clippingRatio = clippedSampleRatio(timeData);
          const pitch = estimatePitchYin(timeData, context!.sampleRate);

          setInputLevel(classifyInputLevel(rms, clippingRatio));

          frames.push({
            rms,
            clippingRatio,
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

      trackVoiceEvent("voice_recording_complete");
      setStatus("processing");
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
      await context.close();
      context = null;

      const analysis = analyzeCapturedFrames(frames);
      if (!analysis.ok) {
        const nextError = failureMessages[analysis.reason];
        setError(nextError);
        setStatus("error");
        trackVoiceEvent("voice_test_error", { reason: nextError.reason });
        return;
      }

      setResult(analysis.result);
      setStatus("result");
      trackVoiceEvent("voice_result_view");
    } catch (caughtError) {
      const nextError = errorFromUnknown(caughtError);
      setError(nextError);
      setStatus("error");
      if (!microphoneGranted) {
        trackVoiceEvent("mic_permission_result", {
          status: nextError.reason === "permission" ? "denied" : "unavailable",
        });
      }
      trackVoiceEvent("voice_test_error", { reason: nextError.reason });
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") await context.close();
    }
  };

  const summary = result
    ? `This sample had a ${result.pitchBand} median pitch, ${result.variabilityBand} pitch movement, and a ${result.brightnessBand} spectral balance.`
    : "";
  const comparison = result && previousResult ? compareResults(previousResult, result) : [];

  const startRetest = () => {
    if (!result) return;
    setPreviousResult(result);
    trackVoiceEvent("voice_test_retest");
    void startRecording();
  };

  return (
    <section className="analyzer-card" aria-labelledby="analyzer-title">
      <div className="analyzer-heading">
        <span className="eyebrow"><span className="status-dot" /> Local analysis</span>
        <h2 id="analyzer-title">Free voice gender analyzer in your browser</h2>
        <p>Record five seconds of natural speech to measure pitch, pitch movement, spectral balance, and recording quality. No upload or account required.</p>
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
            <div className={`level-bars level-${inputLevel}`} aria-hidden="true">
              {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
            </div>
            <p className={`input-guidance guidance-${inputLevel}`}>{inputLevelCopy[inputLevel]}</p>
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
                <p>The central pitch across usable speech frames.</p>
              </article>
              <article className="metric-card">
                <span>Pitch movement</span>
                <strong>{result.variabilityBand}</strong>
                <small>{result.pitchVariabilitySemitones.toFixed(1)} semitone IQR</small>
                <p>How much pitch moved during this phrase.</p>
              </article>
              <article className="metric-card">
                <span>Spectral balance</span>
                <strong>{result.brightnessBand}</strong>
                <small>{formatHz(result.spectralCentroidHz)} brightness proxy</small>
                <p>A limited brightness proxy, not full resonance.</p>
              </article>
              <article className="metric-card">
                <span>Recording quality</span>
                <strong>{result.qualityBand}</strong>
                <small>{Math.round(result.voicedCoverage * 100)}% measurable frames</small>
                <p>How much of this sample could be measured reliably.</p>
              </article>
            </div>

            {comparison.length > 0 && (
              <div className="comparison-panel">
                <div>
                  <span className="result-kicker">Compared with your previous recording</span>
                  <h4>Small changes are shown without turning them into a score.</h4>
                </div>
                <div className="comparison-grid">
                  {comparison.map((item) => (
                    <div key={item.label}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="result-note">
              <strong>This result describes this recording, not your gender identity.</strong>
              <p>Voice perception also involves resonance, articulation, context, and listener expectations that this browser test cannot fully measure.</p>
              <a href="/resources/voice-pitch-vs-gender-presentation/">Learn how pitch relates to gender presentation <span aria-hidden="true">→</span></a>
            </div>

            <div className="result-actions">
              <button className="primary-button" type="button" onClick={shareResult}>Share result</button>
              <button className="secondary-button" type="button" onClick={startRetest}>
                {previousResult ? "Compare one more recording" : "Compare another recording"}
              </button>
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
