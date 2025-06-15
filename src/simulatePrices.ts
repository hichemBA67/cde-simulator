export type PricePoint = {
  t: number;
  ref: number;
  oracle: number;
};

/**
 * Simulates a reference price (sinusoidal or random walk)
 * and an oracle price with lag, noise, or drift.
 */
export function simulatePrices(
  duration: number,
  options?: {
    basePrice?: number;
    useRandomWalk?: boolean;
    volatility?: number;
    oracleLag?: number;
    oracleNoise?: number;
    drift?: number;
  }
): PricePoint[] {
  const {
    basePrice = 100,
    useRandomWalk = false,
    volatility = 0.02,
    oracleLag = 0,
    oracleNoise = 0.5,
    drift = 0,
  } = options || {};

  const refPrices: number[] = [];
  const prices: PricePoint[] = [];

  let lastRef = basePrice;

  for (let t = 0; t < duration; t++) {
    // 1. Simulate reference price
    const ref = useRandomWalk
      ? lastRef + (Math.random() - 0.5) * volatility * basePrice
      : basePrice + 2 * Math.sin(t / 10) + drift * t;

    refPrices.push(ref);
    lastRef = ref;

    // 2. Simulate oracle price
    const refIndex = Math.max(0, t - oracleLag);
    const oracleBase = refPrices[refIndex];
    const oracle = oracleBase + (Math.random() - 0.5) * oracleNoise;

    prices.push({ t, ref, oracle });
  }

  return prices;
}
