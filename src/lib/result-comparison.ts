import type { AnalysisResult } from "./audio-analysis";

export type ResultComparison = {
  label: string;
  value: string;
};

function signedValue(value: number, unit: string, digits = 0): string {
  const rounded = Number(value.toFixed(digits));
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}${Math.abs(rounded).toFixed(digits)} ${unit}`;
}

export function compareResults(
  previous: AnalysisResult,
  current: AnalysisResult,
): ResultComparison[] {
  const pitchDelta = current.medianPitchHz - previous.medianPitchHz;
  const movementDelta =
    current.pitchVariabilitySemitones - previous.pitchVariabilitySemitones;
  const brightnessDelta = current.spectralCentroidHz - previous.spectralCentroidHz;

  return [
    {
      label: "Median pitch",
      value: Math.abs(pitchDelta) < 3 ? "About the same" : signedValue(pitchDelta, "Hz"),
    },
    {
      label: "Pitch movement",
      value:
        Math.abs(movementDelta) < 0.2
          ? "About the same"
          : signedValue(movementDelta, "semitones", 1),
    },
    {
      label: "Spectral balance",
      value:
        Math.abs(brightnessDelta) < 75
          ? "About the same"
          : `${brightnessDelta > 0 ? "Brighter" : "Darker"} (${signedValue(brightnessDelta, "Hz proxy")})`,
    },
    {
      label: "Recording quality",
      value:
        previous.qualityBand === current.qualityBand
          ? `Still ${current.qualityBand}`
          : `${previous.qualityBand} → ${current.qualityBand}`,
    },
  ];
}
