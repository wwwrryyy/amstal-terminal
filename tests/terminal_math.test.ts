import { describe, expect, it } from "vitest";

function computeStationaryVector(A: number[][]): number[] {
  let pi = [1 / 3, 1 / 3, 1 / 3];
  for (let iter = 0; iter < 500; iter++) {
    const next = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        next[j] += pi[i] * A[i][j];
      }
    }
    const sum = next[0] + next[1] + next[2];
    pi = next.map((v) => v / sum);
  }
  return pi;
}

function computeTargetTrackGeometry(params: {
  low: number;
  high: number;
  current: number;
  mean: number;
  median: number;
}) {
  const minBound = Math.min(params.low, params.high, params.current, params.mean, params.median);
  const maxBound = Math.max(params.low, params.high, params.current, params.mean, params.median);
  const span = Math.max(1e-6, maxBound - minBound);
  const toPct = (v: number) => Math.max(0, Math.min(100, ((v - minBound) / span) * 100));
  const curPct = toPct(params.current);
  const meanPct = toPct(params.mean);
  return {
    curPct,
    meanPct,
    medPct: toPct(params.median),
    lowPct: toPct(params.low),
    highPct: toPct(params.high),
    barLeft: Math.min(curPct, meanPct),
    barWidth: Math.abs(meanPct - curPct),
    isDownside: params.mean < params.current,
  };
}

function mergeBarrierAutoscale(
  baseRange: { minValue: number; maxValue: number } | null | undefined,
  tp: number | null | undefined,
  sl: number | null | undefined
): { minValue: number; maxValue: number } | null {
  if (!baseRange) return null;
  if (!tp || !sl || tp <= 0 || sl <= 0 || tp <= sl) {
    return baseRange;
  }
  return {
    minValue: Math.min(baseRange.minValue, sl * 0.995),
    maxValue: Math.max(baseRange.maxValue, tp * 1.005),
  };
}

describe("Quant & chart geometry invariants", () => {
  it("computes true Markov stationary distribution, dwell time, and half-life", () => {
    const A = [
      [0.95, 0.04, 0.01],
      [0.05, 0.90, 0.05],
      [0.02, 0.08, 0.90],
    ];
    const pi = computeStationaryVector(A);
    expect(pi[0] + pi[1] + pi[2]).toBeCloseTo(1.0, 8);
    expect(pi[0]).toBeGreaterThan(pi[2]);

    const expectedDwellS0 = 1 / (1 - A[0][0]);
    expect(expectedDwellS0).toBeCloseTo(20.0, 5);

    const halfLifeS0 = Math.log(0.5) / Math.log(A[0][0]);
    expect(halfLifeS0).toBeCloseTo(13.5134, 3);
  });

  it("computes continuous volatility-adjusted Kelly kappa haircut monotonically", () => {
    const baseKappa = 0.25;
    const calcKappa = (pS1: number, pS2: number) => baseKappa * (1 - 0.8 * pS2) * (1 - 0.2 * pS1);

    const kLowVol = calcKappa(0.05, 0.02);
    const kNormal = calcKappa(0.70, 0.05);
    const kCrisis = calcKappa(0.10, 0.85);

    expect(kLowVol).toBeGreaterThan(kNormal);
    expect(kNormal).toBeGreaterThan(kCrisis);
    expect(kCrisis).toBeGreaterThan(0);
  });

  it("renders valid target track bounds for both upside and downside consensus targets", () => {
    const upside = computeTargetTrackGeometry({
      low: 150,
      current: 175,
      median: 205,
      mean: 210,
      high: 250,
    });
    expect(upside.isDownside).toBe(false);
    expect(upside.barLeft).toBe(upside.curPct);
    expect(upside.barWidth).toBeCloseTo(upside.meanPct - upside.curPct, 6);

    const downside = computeTargetTrackGeometry({
      low: 120,
      mean: 140,
      median: 145,
      high: 165,
      current: 190,
    });
    expect(downside.isDownside).toBe(true);
    expect(downside.barLeft).toBe(downside.meanPct);
    expect(downside.barWidth).toBeCloseTo(downside.curPct - downside.meanPct, 6);
    expect(downside.curPct).toBeLessThanOrEqual(100);
    expect(downside.barLeft + downside.barWidth).toBeLessThanOrEqual(100.0001);
  });

  it("guards candlestick autoscale against missing/zero triple-barrier levels", () => {
    const candleRange = { minValue: 170, maxValue: 190 };
    expect(mergeBarrierAutoscale(candleRange, 0, 0)).toEqual(candleRange);
    expect(mergeBarrierAutoscale(candleRange, 160, 175)).toEqual(candleRange);
    expect(mergeBarrierAutoscale(null, 210, 160)).toBeNull();

    const expanded = mergeBarrierAutoscale(candleRange, 210, 160);
    expect(expanded?.minValue).toBeCloseTo(159.2, 4);
    expect(expanded?.maxValue).toBeCloseTo(211.05, 4);
  });
});
