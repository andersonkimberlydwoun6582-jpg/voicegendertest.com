import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "./audio-analysis";
import { compareResults } from "./result-comparison";

const baseline: AnalysisResult = {
  medianPitchHz: 180,
  pitchBand: "middle",
  pitchVariabilitySemitones: 2.4,
  variabilityBand: "moderate",
  spectralCentroidHz: 1_600,
  brightnessBand: "balanced",
  qualityBand: "fair",
  voicedCoverage: 0.55,
};

describe("result comparison", () => {
  it("uses neutral differences instead of identity labels", () => {
    const comparison = compareResults(baseline, {
      ...baseline,
      medianPitchHz: 190,
      pitchVariabilitySemitones: 1.9,
      spectralCentroidHz: 1_800,
      qualityBand: "good",
    });

    expect(comparison).toEqual([
      { label: "Median pitch", value: "+10 Hz" },
      { label: "Pitch movement", value: "−0.5 semitones" },
      { label: "Spectral balance", value: "Brighter (+200 Hz proxy)" },
      { label: "Recording quality", value: "fair → good" },
    ]);
  });

  it("avoids false precision for small changes", () => {
    const comparison = compareResults(baseline, {
      ...baseline,
      medianPitchHz: 181,
      pitchVariabilitySemitones: 2.5,
      spectralCentroidHz: 1_650,
    });

    expect(comparison.slice(0, 3).every((item) => item.value === "About the same")).toBe(true);
  });
});
