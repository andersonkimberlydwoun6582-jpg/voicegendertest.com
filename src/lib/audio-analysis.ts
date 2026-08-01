export const ANALYSIS_THRESHOLDS = {
  minimumRms: 0.012,
  clippingLevel: 0.98,
  maximumClippedSampleRatio: 0.008,
  minimumVoicedFrames: 8,
  minimumPitchCoverage: 0.3,
  minimumPitchClarity: 0.58,
  pitchFloorHz: 65,
  pitchCeilingHz: 500,
} as const;

export type PitchEstimate = {
  hz: number;
  clarity: number;
};

export type CapturedFrame = {
  rms: number;
  clippingRatio: number;
  pitch: PitchEstimate | null;
  spectralCentroidHz: number | null;
};

export type AnalysisResult = {
  medianPitchHz: number;
  pitchBand: "lower" | "middle" | "higher";
  pitchVariabilitySemitones: number;
  variabilityBand: "steady" | "moderate" | "varied";
  spectralCentroidHz: number;
  brightnessBand: "darker" | "balanced" | "brighter";
  qualityBand: "good" | "fair";
  voicedCoverage: number;
};

export type AnalysisFailure =
  | "too-quiet"
  | "clipping"
  | "low-confidence";

export function rootMeanSquare(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function clippedSampleRatio(
  samples: Float32Array,
  clippingLevel = ANALYSIS_THRESHOLDS.clippingLevel,
): number {
  if (samples.length === 0) return 0;
  let clipped = 0;
  for (const sample of samples) {
    if (Math.abs(sample) >= clippingLevel) clipped += 1;
  }
  return clipped / samples.length;
}

export function estimatePitchYin(
  samples: Float32Array,
  sampleRate: number,
  minimumHz = ANALYSIS_THRESHOLDS.pitchFloorHz,
  maximumHz = ANALYSIS_THRESHOLDS.pitchCeilingHz,
): PitchEstimate | null {
  if (samples.length < 32 || rootMeanSquare(samples) < ANALYSIS_THRESHOLDS.minimumRms) {
    return null;
  }

  const minimumTau = Math.max(2, Math.floor(sampleRate / maximumHz));
  const maximumTau = Math.min(
    Math.floor(sampleRate / minimumHz),
    Math.floor(samples.length / 2),
  );
  if (maximumTau <= minimumTau) return null;

  const difference = new Float64Array(maximumTau + 1);
  const cmnd = new Float64Array(maximumTau + 1);

  for (let tau = 1; tau <= maximumTau; tau += 1) {
    let sum = 0;
    const comparisonLength = samples.length - tau;
    for (let index = 0; index < comparisonLength; index += 1) {
      const delta = samples[index] - samples[index + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maximumTau; tau += 1) {
    runningSum += difference[tau];
    cmnd[tau] = runningSum === 0 ? 1 : (difference[tau] * tau) / runningSum;
  }

  const yinThreshold = 0.15;
  let bestTau = -1;
  for (let tau = minimumTau; tau <= maximumTau; tau += 1) {
    if (cmnd[tau] < yinThreshold) {
      while (tau + 1 <= maximumTau && cmnd[tau + 1] < cmnd[tau]) tau += 1;
      bestTau = tau;
      break;
    }
  }

  if (bestTau < 0) {
    let bestValue = Number.POSITIVE_INFINITY;
    for (let tau = minimumTau; tau <= maximumTau; tau += 1) {
      if (cmnd[tau] < bestValue) {
        bestValue = cmnd[tau];
        bestTau = tau;
      }
    }
  }

  const clarity = Math.max(0, Math.min(1, 1 - cmnd[bestTau]));
  if (clarity < ANALYSIS_THRESHOLDS.minimumPitchClarity) return null;

  const left = bestTau > 1 ? cmnd[bestTau - 1] : cmnd[bestTau];
  const center = cmnd[bestTau];
  const right = bestTau < maximumTau ? cmnd[bestTau + 1] : cmnd[bestTau];
  const denominator = 2 * (2 * center - right - left);
  const adjustment = denominator === 0 ? 0 : (right - left) / denominator;
  const refinedTau = bestTau + Math.max(-0.5, Math.min(0.5, adjustment));
  const hz = sampleRate / refinedTau;

  return Number.isFinite(hz) && hz >= minimumHz && hz <= maximumHz
    ? { hz, clarity }
    : null;
}

export function spectralCentroidFromDecibels(
  decibels: Float32Array,
  sampleRate: number,
  fftSize: number,
): number | null {
  let weightedFrequency = 0;
  let totalMagnitude = 0;
  const binWidth = sampleRate / fftSize;

  for (let index = 1; index < decibels.length; index += 1) {
    const db = decibels[index];
    if (!Number.isFinite(db)) continue;
    const magnitude = 10 ** (db / 20);
    weightedFrequency += index * binWidth * magnitude;
    totalMagnitude += magnitude;
  }

  return totalMagnitude > 0 ? weightedFrequency / totalMagnitude : null;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function semitoneIqr(pitchesHz: number[]): number {
  if (pitchesHz.length < 2) return 0;
  const reference = median(pitchesHz);
  const semitones = pitchesHz.map((pitch) => 12 * Math.log2(pitch / reference));
  return percentile(semitones, 0.75) - percentile(semitones, 0.25);
}

export function analyzeCapturedFrames(
  frames: CapturedFrame[],
): { ok: true; result: AnalysisResult } | { ok: false; reason: AnalysisFailure } {
  if (frames.length === 0) return { ok: false, reason: "too-quiet" };

  const rmsValues = frames.map((frame) => frame.rms);
  if (median(rmsValues) < ANALYSIS_THRESHOLDS.minimumRms) {
    return { ok: false, reason: "too-quiet" };
  }

  const averageClipping =
    frames.reduce((sum, frame) => sum + frame.clippingRatio, 0) / frames.length;
  if (averageClipping > ANALYSIS_THRESHOLDS.maximumClippedSampleRatio) {
    return { ok: false, reason: "clipping" };
  }

  const voicedFrames = frames.filter(
    (frame): frame is CapturedFrame & { pitch: PitchEstimate } => frame.pitch !== null,
  );
  const voicedCoverage = voicedFrames.length / frames.length;
  const averageClarity =
    voicedFrames.reduce((sum, frame) => sum + frame.pitch.clarity, 0) /
    Math.max(1, voicedFrames.length);

  if (
    voicedFrames.length < ANALYSIS_THRESHOLDS.minimumVoicedFrames ||
    voicedCoverage < ANALYSIS_THRESHOLDS.minimumPitchCoverage ||
    averageClarity < ANALYSIS_THRESHOLDS.minimumPitchClarity
  ) {
    return { ok: false, reason: "low-confidence" };
  }

  const pitches = voicedFrames.map((frame) => frame.pitch.hz);
  const medianPitchHz = median(pitches);
  const variability = semitoneIqr(pitches);
  const centroids = voicedFrames
    .map((frame) => frame.spectralCentroidHz)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const spectralCentroidHz = centroids.length > 0 ? median(centroids) : 0;

  return {
    ok: true,
    result: {
      medianPitchHz,
      pitchBand: medianPitchHz < 145 ? "lower" : medianPitchHz > 210 ? "higher" : "middle",
      pitchVariabilitySemitones: variability,
      variabilityBand: variability < 1.5 ? "steady" : variability < 3.5 ? "moderate" : "varied",
      spectralCentroidHz,
      brightnessBand:
        spectralCentroidHz < 1_200
          ? "darker"
          : spectralCentroidHz > 2_200
            ? "brighter"
            : "balanced",
      qualityBand:
        voicedCoverage >= 0.65 && averageClarity >= 0.75 ? "good" : "fair",
      voicedCoverage,
    },
  };
}
