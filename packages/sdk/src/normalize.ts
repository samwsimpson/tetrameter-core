/**
 * Model identifier normalisation.
 *
 * ── The bug this prevents ───────────────────────────────────────────────────
 *
 * SiteBeacon calls the same Anthropic model two ways: `anthropic/claude-haiku-4.5`
 * through the Vercel AI Gateway fleet, and `claude-haiku-4-5` in the outreach
 * rewrite route. Both resolve correctly in the pricing catalogue, so costs would
 * have been right — but a model breakdown would have listed one model as **two
 * separate rows**, splitting its footprint and quietly understating whichever row
 * a reader looked at.
 *
 * Found by reading their code before writing ours. It would have been very hard
 * to spot in a report, because both rows look plausible.
 *
 * ── What this does NOT do ───────────────────────────────────────────────────
 *
 * It does not map model families onto each other, guess at aliases, or strip
 * version suffixes. `claude-haiku-4-5` and `claude-haiku-4-5-20251001` stay
 * distinct, because they are distinct — a dated snapshot can differ in price and
 * behaviour from its floating alias.
 *
 * The rule is narrow on purpose: only differences that are *purely notational*
 * get collapsed. Anything that might be a real difference is preserved, because a
 * wrong merge is far worse than a duplicate row. A duplicate row is visible; a
 * wrong merge silently averages two different models together.
 */

/**
 * Canonicalise a model identifier.
 *
 *   anthropic/claude-haiku-4.5  →  anthropic/claude-haiku-4-5
 *   claude-haiku-4.5            →  claude-haiku-4-5
 *   Claude-Sonnet-5             →  claude-sonnet-5
 *
 * The provider prefix is preserved: `anthropic/claude-haiku-4-5` via a gateway
 * genuinely may be priced differently from the same model direct, and the pricing
 * catalogue carries both. Collapsing them would lose that.
 */
export function normalizeModelId(model: string): string {
  const trimmed = model.trim().toLowerCase();
  if (trimmed.length === 0) return trimmed;

  const slash = trimmed.indexOf("/");
  const prefix = slash > 0 ? trimmed.slice(0, slash + 1) : "";
  const name = slash > 0 ? trimmed.slice(slash + 1) : trimmed;

  // Version separators only: a dot between two digits becomes a hyphen, so
  // "4.5" and "4-5" stop being different models. Dots elsewhere are left alone.
  const canonical = name.replace(/(\d)\.(\d)/g, "$1-$2");

  return prefix + canonical;
}

/**
 * True when two identifiers denote the same model under normalisation, ignoring
 * the provider prefix. Useful for reconciling a gateway route against a direct
 * one when you deliberately want them merged in a report.
 */
export function sameModel(a: string, b: string): boolean {
  const strip = (m: string) => {
    const n = normalizeModelId(m);
    const i = n.indexOf("/");
    return i > 0 ? n.slice(i + 1) : n;
  };
  return strip(a) === strip(b);
}
