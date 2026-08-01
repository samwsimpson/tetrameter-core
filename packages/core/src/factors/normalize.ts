/**
 * Model identifier normalisation, and why the resolver must accept both spellings.
 *
 * ── The bug this exists to prevent ──────────────────────────────────────────
 *
 * Providers write the same model two ways. SiteBeacon calls Anthropic's Haiku as
 * `anthropic/claude-haiku-4.5` through the AI Gateway and `claude-haiku-4-5` in
 * another route. Left alone, a model breakdown shows one model as two rows and
 * understates each.
 *
 * The collector therefore normalises `4.5` → `4-5` on the way out. But that
 * created a second, worse bug: our own catalogues store some ids WITH dots —
 * `gemini/gemini-2.5-flash`, `meta-llama/llama-3.1-8b-instruct` — so a normalised
 * id missed the lookup entirely and fell back to a class median. Silently. The
 * numbers still looked plausible, which is the failure mode this codebase exists
 * to prevent, and it was live on real SiteBeacon traffic before it was caught.
 *
 * ── The fix ─────────────────────────────────────────────────────────────────
 *
 * Index every catalogue entry under both its raw key and its normalised key. Then
 * whichever spelling arrives resolves, and neither the collector nor the caller
 * has to know which form our data happens to use.
 *
 * Deliberately narrow: only a dot between two digits is treated as notational.
 * `claude-sonnet-4-5` and `claude-sonnet-4-5-20250929` stay distinct, because a
 * dated snapshot genuinely differs in price and behaviour from its floating
 * alias. A wrong merge silently averages two models; a duplicate row is at least
 * visible.
 *
 * Kept in sync with the identical function in the SDK, which cannot import this
 * one without taking a runtime dependency on the engine. `test/normalize.test.ts`
 * asserts the shared cases in both packages.
 */

/** Canonicalise a model id: lowercase, trimmed, `4.5` → `4-5`. */
export function normalizeModelId(model: string): string {
  const trimmed = model.trim().toLowerCase();
  if (trimmed.length === 0) return trimmed;

  const slash = trimmed.indexOf("/");
  const prefix = slash > 0 ? trimmed.slice(0, slash + 1) : "";
  const name = slash > 0 ? trimmed.slice(slash + 1) : trimmed;

  return prefix + name.replace(/(\d)\.(\d)/g, "$1-$2");
}

/**
 * Register a value under both the raw key and its normalised form.
 *
 * The raw key wins on collision: if a catalogue genuinely contains both
 * `foo-4.5` and `foo-4-5` as distinct entries, neither should be clobbered by
 * the other's alias.
 */
export function indexBothSpellings<T>(map: Map<string, T>, key: string, value: T): void {
  const raw = key.toLowerCase();
  map.set(raw, value);
  const normalized = normalizeModelId(raw);
  if (normalized !== raw && !map.has(normalized)) map.set(normalized, value);
}
