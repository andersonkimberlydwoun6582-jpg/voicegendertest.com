import { afterEach, describe, expect, it, vi } from "vitest";
import { trackVoiceEvent } from "./analytics";

describe("voice analytics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing during server rendering", () => {
    expect(() => trackVoiceEvent("voice_test_start")).not.toThrow();
  });

  it("sends only the explicit event name and approved parameters", () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag });

    trackVoiceEvent("voice_test_error", { reason: "too_quiet" });

    expect(gtag).toHaveBeenCalledOnce();
    expect(gtag).toHaveBeenCalledWith("event", "voice_test_error", {
      reason: "too_quiet",
    });
  });

  it("does not break the tool when gtag is unavailable", () => {
    vi.stubGlobal("window", {});
    expect(() => trackVoiceEvent("voice_result_view")).not.toThrow();
  });
});
