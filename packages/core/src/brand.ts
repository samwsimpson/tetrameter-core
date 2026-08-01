/**
 * Mirrored from `brand.config.json` at the repo root.
 *
 * The published package must not read files outside its own directory at runtime,
 * so the literal lives here and `test/brand.test.ts` fails the build if it ever
 * drifts from the config. See RENAME.md.
 *
 * **Tetrameter**: tetra (four) + meter (measure). We measure four resources —
 * energy, carbon, water and land. Cost sits outside them as the same consumption
 * priced by the market, which is the founding thesis restated: for AI, cost and
 * carbon are the same variable because both scale with compute.
 */
export const BRAND = {
  slug: "tetrameter",
  name: "Tetrameter",
  wordmark: "Tetrameter",
  domain: "tetrameter.ai",
} as const;

export type Brand = typeof BRAND;
