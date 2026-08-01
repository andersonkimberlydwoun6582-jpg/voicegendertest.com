import { describe, expect, it } from "vitest";
import {
  analyzeCapturedFrames,
  clippedSampleRatio,
  estimatePitchYin,
  median,
  rootMeanSquare,
  semitoneIqr,
  spectralCentroidFromDecibels,
  type CapturedFrame,
} from "./audio-analysis";

const sampleRate = 48_000;

function sineWave(frequency: number, length = 4096, amplitude = 0.6): Float32Array {
  return Float32Array.from(
    { length },
    (_, index) => amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate),
  );
}

function frame(overrides: Partial<CapturedFrame> = {}): CapturedFrame {
  return {
    rms: 0.2,
    clippingRatio: 0,
    pitch: { hz: 180, clarity: 0.9 },
    spectralCentroidHz: 1_600,
    ...overrides,
  };
}

describe("signal helpers", () => {
  it("calculates RMS and clipping", () => {
    expect(rootMeanSquare(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1);
    expect(clippedSampleRatio(new Float32Array([1, -1, 0.2, 0]))).toBeCloseTo(0.5);
  });

  it.each([110, 220, 330])("estimates a %i Hz sine wave", (frequency) => {
    const estimate = estimatePitchYin(sineWave(frequency), sampleRate);
    expect(estimate).not.toBeNull();
    expect(estimate?.hz).toBeCloseTo(frequency, 0);
    expect(estimate?.clarity).toBeGreaterThan(0.9);
  });

  it("rejects silence", () => {
    expect(estimatePitchYin(new Float32Array(4096), sampleRate)).toBeNull();
  });

  it("measures robust medians and pitch spread", () => {
    expect(median([100, 101, 102, 10_000])).toBe(101.5);
    expect(semitoneIqr([180, 180, 180, 180])).toBe(0);
    expect(semitoneIqr([160, 180, 200, 220])).toBeGreaterThan(2);
  });

  it("orders low and high spectral centroids", () => {
    const low = new Float32Array(64).fill(-120);
    const high = new Float32Array(64).fill(-120);
    low[4] = 0;
    high[40] = 0;
    const lowCentroid = spectralCentroidFromDecibels(low, sampleRate, 128);
    const highCentroid = spectralCentroidFromDecibels(high, sampleRate, 128);
    expect(lowCentroid).not.toBeNull();
    expect(highCentroid).not.toBeNull();
    expect(highCentroid!).toBeGreaterThan(lowCentroid!);
  });
});

describe("recording quality gates", () => {
  it("rejects recordings that are too quiet", () => {
    const result = analyzeCapturedFrames(Array.from({ length: 30 }, () => frame({ rms: 0.001 })));
    expect(result).toEqual({ ok: false, reason: "too-quiet" });
  });

  it("rejects clipped recordings", () => {
    const result = analyzeCapturedFrames(
      Array.from({ length: 30 }, () => frame({ clippingRatio: 0.02 })),
    );
    expect(result).toEqual({ ok: false, reason: "clipping" });
  });

  it("rejects recordings without enough reliable pitch frames", () => {
    const frames = Array.from({ length: 30 }, (_, index) =>
      frame({ pitch: index < 4 ? { hz: 180, clarity: 0.9 } : null }),
    );
    expect(analyzeCapturedFrames(frames)).toEqual({ ok: false, reason: "low-confidence" });
  });

  it("returns descriptive acoustic metrics for a usable recording", () => {
    const frames = Array.from({ length: 30 }, (_, index) =>
      frame({ pitch: { hz: 175 + (index % 5) * 3, clarity: 0.9 } }),
    );
    const result = analyzeCapturedFrames(frames);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.medianPitchHz).toBeGreaterThan(175);
      expect(result.result.qualityBand).toBe("good");
      expect(result.result.brightnessBand).toBe("balanced");
    }
  });
});
