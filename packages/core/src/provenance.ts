/**
 * Provenance: where every number came from.
 *
 * Limited assurance under ISAE 3410 tests three things — methodology documentation,
 * traceability from the reported figure back to raw data, and emission factor testing.
 * All three are served by carrying a FactorRef alongside every value, so the export
 * pack can be generated mechanically rather than assembled by hand at year end.
 */

export type FactorKind =
  | "model-energy"
  | "grid-intensity"
  | "water-intensity"
  | "embodied"
  | "pricing"
  | "overhead";

export interface FactorRef {
  /** Stable identifier, e.g. "grid.US-CAISO" or "model.anthropic.claude-sonnet". */
  readonly id: string;
  readonly kind: FactorKind;
  /** Version of the factor set this value was drawn from, e.g. "2026.07.0". */
  readonly version: string;
  /** Human-readable citation. */
  readonly source: string;
  /** URL or DOI where the source can be checked. */
  readonly url?: string;
  /** ISO date the value was retrieved from the source. */
  readonly retrieved: string;
  /**
   * Free-text caveat shown next to the number in the export pack.
   * Use it. A caveat nobody reads is better than a caveat nobody wrote.
   */
  readonly note?: string;
}

export interface Restatement {
  readonly factorId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  /** ISO date the restatement was applied. */
  readonly applied: string;
  readonly reason: string;
  /** Fractional change in the affected figures, e.g. -0.18 for an 18% reduction. */
  readonly materialityEstimate?: number;
}

/**
 * A restatement log is a first-class artifact, not an afterthought.
 *
 * When EcoLogits switched its energy benchmark from HF LLM-Perf to ML.ENERGY in 2026,
 * every historical number moved. In a disclosed inventory that is a restatement event
 * requiring documentation. No tool in this market handles it, which is precisely why
 * it belongs in the core library rather than bolted on later.
 */
export class RestatementLog {
  readonly #entries: Restatement[] = [];

  add(entry: Restatement): void {
    this.#entries.push(entry);
  }

  get entries(): readonly Restatement[] {
    return [...this.#entries];
  }

  /** Restatements affecting a given factor, most recent first. */
  forFactor(factorId: string): readonly Restatement[] {
    return this.#entries
      .filter((e) => e.factorId === factorId)
      .sort((a, b) => b.applied.localeCompare(a.applied));
  }

  /** Restatements applied on or after a date — what a re-filed report must disclose. */
  since(isoDate: string): readonly Restatement[] {
    return this.#entries.filter((e) => e.applied >= isoDate);
  }
}
