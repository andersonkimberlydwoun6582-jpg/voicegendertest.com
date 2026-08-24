export type VoiceAnalyticsEvent =
  | "voice_test_start"
  | "mic_permission_result"
  | "voice_recording_complete"
  | "voice_result_view"
  | "voice_test_error"
  | "voice_test_retest"
  | "voice_share_attempt"
  | "voice_share_result";

export type VoiceAnalyticsParams = {
  status?: "granted" | "denied" | "unavailable" | "success" | "cancelled" | "failed";
  reason?:
    | "too_quiet"
    | "clipping"
    | "low_confidence"
    | "permission"
    | "no_microphone"
    | "interrupted"
    | "insecure_context"
    | "unsupported_browser"
    | "processing";
  method?: "native" | "clipboard";
};

type GtagWindow = Window & {
  gtag?: (command: "event", eventName: string, params?: VoiceAnalyticsParams) => void;
};

export function trackVoiceEvent(
  eventName: VoiceAnalyticsEvent,
  params: VoiceAnalyticsParams = {},
): void {
  if (typeof window === "undefined") return;
  const gtag = (window as GtagWindow).gtag;
  if (typeof gtag !== "function") return;
  gtag("event", eventName, params);
}
