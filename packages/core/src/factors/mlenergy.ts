/**
 * ML.ENERGY Benchmark — ingested measurements.
 *
 * GENERATED FILE. Regenerate with `scripts/ingest-mlenergy.md` rather than editing
 * by hand, so the numbers always trace back to a published snapshot.
 *
 * Source:  https://ml.energy/leaderboard  (ml-energy/leaderboard, public/data)
 * Paper:   The ML.ENERGY Benchmark, arXiv:2505.06371
 * Snapshot last_updated: 2026-02-16
 * Retrieved: 2026-07-31
 *
 * ── What these numbers are ───────────────────────────────────────────────────
 *
 * `energy_per_token_joules` in the source is total request energy divided by
 * output tokens, so the cost of prefilling a typical benchmark prompt is already
 * amortised into it. That is why `prefillRatio` in models.ts is small: it covers
 * input tokens *beyond* a typical prompt, not the baseline prefill.
 *
 * These are **accelerator energy only** — the GPU, measured at the device. Host
 * CPU/RAM/NIC power, idle and reserve capacity, and facility overhead are applied
 * separately in overhead.ts. Do not add a PUE-style multiplier here.
 *
 * ── Why every model carries a range, not a value ─────────────────────────────
 *
 * Per-token energy varies 4–35x for the *same model* purely with serving
 * configuration — batch size, GPU generation, parallelism, weight precision.
 * Qwen3-14B measures 0.699 J/token at batch 8 and 0.167 J/token at batch 64.
 *
 * A customer buying inference through an API has no idea what batch size their
 * provider runs. So the spread across configurations is not noise to be averaged
 * away — it IS the uncertainty, and quoting a single figure would be false
 * precision. We take p10 / median / p90 across all measured configurations.
 *
 * ── Two regimes ─────────────────────────────────────────────────────────────
 *
 * The same model costs more per token on long-context reasoning work than on
 * chat, because attention cost grows with context. Qwen3-14B: 0.040 Wh/1k on
 * chat, 0.116 Wh/1k on GPQA. Reasoning models are therefore expensive on both
 * axes — roughly 3x per token AND 10–20x more tokens emitted (median output
 * length 5,400–11,445 on GPQA against 634 on chat). That compounds to the ~65x
 * spread Jegham et al. observed across commercial models.
 */

export type EnergyRegime = "chat" | "reasoning";

export interface MlEnergyRow {
  readonly modelId: string;
  readonly regime: EnergyRegime;
  /** Wh per 1,000 output tokens, 10th percentile across serving configurations. */
  readonly lo: number;
  /** Median across serving configurations. */
  readonly mid: number;
  /** 90th percentile. */
  readonly hi: number;
  /** Number of distinct serving configurations measured. */
  readonly configs: number;
  readonly activatedParamsB: number;
  readonly totalParamsB: number;
  readonly architecture: string;
  readonly gpus: string;
}

export const MLENERGY_SNAPSHOT = "2026-02-16";
export const MLENERGY_RETRIEVED = "2026-07-31";

export const MLENERGY_ROWS: readonly MlEnergyRow[] = [
  { modelId: "qwen/qwen3-14b", regime: "chat", lo: 0.01972, mid: 0.03987, hi: 0.14408, configs: 17, activatedParamsB: 14.0, totalParamsB: 14.0, architecture: "Dense Transformer", gpus: "B200/H100" },
  { modelId: "qwen/qwen3-235b-a22b-instruct-2507", regime: "chat", lo: 0.08783, mid: 0.33536, hi: 1.5503, configs: 31, activatedParamsB: 22.0, totalParamsB: 235.0, architecture: "MoE", gpus: "B200/H100" },
  { modelId: "qwen/qwen3-235b-a22b-instruct-2507-fp8", regime: "chat", lo: 0.22849, mid: 0.45185, hi: 2.22118, configs: 23, activatedParamsB: 22.0, totalParamsB: 235.0, architecture: "MoE", gpus: "B200/H100" },
  { modelId: "qwen/qwen3-30b-a3b-instruct-2507", regime: "chat", lo: 0.02209, mid: 0.05163, hi: 0.16836, configs: 31, activatedParamsB: 3.0, totalParamsB: 30.0, architecture: "MoE", gpus: "B200/H100" },
  { modelId: "qwen/qwen3-32b", regime: "chat", lo: 0.04261, mid: 0.08572, hi: 0.41297, configs: 22, activatedParamsB: 32.0, totalParamsB: 32.0, architecture: "Dense Transformer", gpus: "B200/H100" },
  { modelId: "qwen/qwen3-8b", regime: "chat", lo: 0.01714, mid: 0.02684, hi: 0.08139, configs: 19, activatedParamsB: 8.0, totalParamsB: 8.0, architecture: "Dense Transformer", gpus: "B200/H100" },
  { modelId: "deepseek-ai/deepseek-v3.1", regime: "chat", lo: 0.17504, mid: 0.36364, hi: 1.68512, configs: 11, activatedParamsB: 37.0, totalParamsB: 671.0, architecture: "MoE", gpus: "B200" },
  { modelId: "google/gemma-3-12b-it", regime: "chat", lo: 0.03263, mid: 0.05579, hi: 0.17195, configs: 13, activatedParamsB: 12.0, totalParamsB: 12.0, architecture: "Dense Transformer", gpus: "B200/H100" },
  { modelId: "google/gemma-3-27b-it", regime: "chat", lo: 0.07017, mid: 0.13769, hi: 0.39791, configs: 16, activatedParamsB: 27.0, totalParamsB: 27.0, architecture: "Dense Transformer", gpus: "B200/H100" },
  { modelId: "meta-llama/llama-3.1-405b-instruct", regime: "chat", lo: 0.29056, mid: 0.52954, hi: 3.08297, configs: 12, activatedParamsB: 405.0, totalParamsB: 405.0, architecture: "Dense Transformer", gpus: "B200" },
  { modelId: "meta-llama/llama-3.1-405b-instruct-fp8", regime: "chat", lo: 0.42285, mid: 0.73914, hi: 3.00747, configs: 15, activatedParamsB: 405.0, totalParamsB: 405.0, architecture: "Dense Transformer", gpus: "B200/H100" },
  { modelId: "meta-llama/llama-3.1-70b-instruct", regime: "chat", lo: 0.06419, mid: 0.13819, hi: 0.5756, configs: 22, activatedParamsB: 70.0, totalParamsB: 70.0, architecture: "Dense Transformer", gpus: "B200/H100" },
  { modelId: "meta-llama/llama-3.1-8b-instruct", regime: "chat", lo: 0.01658, mid: 0.02686, hi: 0.07653, configs: 20, activatedParamsB: 8.0, totalParamsB: 8.0, architecture: "Dense Transformer", gpus: "B200/H100" },
  { modelId: "meta-llama/llama-3.3-70b-instruct", regime: "chat", lo: 0.0934, mid: 0.16767, hi: 0.66797, configs: 19, activatedParamsB: 70.0, totalParamsB: 70.0, architecture: "Dense Transformer", gpus: "B200/H100" },
  { modelId: "meta-llama/llama-4-maverick-17b-128e-instruct-fp8", regime: "chat", lo: 0.15145, mid: 0.23577, hi: 0.55932, configs: 9, activatedParamsB: 17.0, totalParamsB: 400.0, architecture: "MoE", gpus: "H100" },
  { modelId: "meta-llama/llama-4-scout-17b-16e-instruct", regime: "chat", lo: 0.11859, mid: 0.22245, hi: 0.94325, configs: 20, activatedParamsB: 17.0, totalParamsB: 109.0, architecture: "MoE", gpus: "H100" },
  { modelId: "nvidia/nvidia-nemotron-nano-12b-v2", regime: "chat", lo: 0.04568, mid: 0.06473, hi: 0.16541, configs: 14, activatedParamsB: 12.0, totalParamsB: 12.0, architecture: "Mamba-Transformer Hybrid", gpus: "B200/H100" },
  { modelId: "nvidia/nvidia-nemotron-nano-9b-v2", regime: "chat", lo: 0.04342, mid: 0.05537, hi: 0.12988, configs: 14, activatedParamsB: 9.0, totalParamsB: 9.0, architecture: "Mamba-Transformer Hybrid", gpus: "B200/H100" },
  { modelId: "qwen/qwen3-14b", regime: "reasoning", lo: 0.07227, mid: 0.11613, hi: 0.27015, configs: 9, activatedParamsB: 14.0, totalParamsB: 14.0, architecture: "Dense Transformer", gpus: "B200/H100" },
  { modelId: "qwen/qwen3-235b-a22b-thinking-2507", regime: "reasoning", lo: 0.21508, mid: 0.70902, hi: 1.77165, configs: 18, activatedParamsB: 22.0, totalParamsB: 235.0, architecture: "MoE", gpus: "B200/H100" },
  { modelId: "qwen/qwen3-235b-a22b-thinking-2507-fp8", regime: "reasoning", lo: 0.1539, mid: 0.76803, hi: 2.48567, configs: 22, activatedParamsB: 22.0, totalParamsB: 235.0, architecture: "MoE", gpus: "B200/H100" },
  { modelId: "qwen/qwen3-30b-a3b-thinking-2507", regime: "reasoning", lo: 0.0458, mid: 0.11922, hi: 0.22833, configs: 15, activatedParamsB: 3.0, totalParamsB: 30.0, architecture: "MoE", gpus: "B200/H100" },
  { modelId: "qwen/qwen3-32b", regime: "reasoning", lo: 0.12114, mid: 0.22271, hi: 0.57698, configs: 9, activatedParamsB: 32.0, totalParamsB: 32.0, architecture: "Dense Transformer", gpus: "B200/H100" },
  { modelId: "qwen/qwen3-8b", regime: "reasoning", lo: 0.06008, mid: 0.09888, hi: 0.21098, configs: 10, activatedParamsB: 8.0, totalParamsB: 8.0, architecture: "Dense Transformer", gpus: "B200/H100" },
  { modelId: "deepseek-ai/deepseek-r1-0528", regime: "reasoning", lo: 0.82475, mid: 1.47927, hi: 2.43696, configs: 5, activatedParamsB: 37.0, totalParamsB: 671.0, architecture: "MoE", gpus: "B200" },
  { modelId: "deepseek-ai/deepseek-v3.1", regime: "reasoning", lo: 0.43565, mid: 1.24661, hi: 2.41608, configs: 6, activatedParamsB: 37.0, totalParamsB: 671.0, architecture: "MoE", gpus: "B200" },
  { modelId: "nvidia/nvidia-nemotron-nano-12b-v2", regime: "reasoning", lo: 0.04013, mid: 0.06875, hi: 0.2111, configs: 13, activatedParamsB: 12.0, totalParamsB: 12.0, architecture: "Mamba-Transformer Hybrid", gpus: "B200/H100" },
  { modelId: "nvidia/nvidia-nemotron-nano-9b-v2", regime: "reasoning", lo: 0.03223, mid: 0.04431, hi: 0.14058, configs: 15, activatedParamsB: 9.0, totalParamsB: 9.0, architecture: "Mamba-Transformer Hybrid", gpus: "B200/H100" },
  { modelId: "openai/gpt-oss-120b", regime: "reasoning", lo: 0.01659, mid: 0.04183, hi: 0.14586, configs: 39, activatedParamsB: 5.0, totalParamsB: 117.0, architecture: "MoE", gpus: "B200/H100" },
  { modelId: "openai/gpt-oss-20b", regime: "reasoning", lo: 0.00987, mid: 0.01738, hi: 0.05774, configs: 26, activatedParamsB: 4.0, totalParamsB: 21.0, architecture: "MoE", gpus: "B200/H100" },
];

/**
 * Class aggregates, derived from the same measurements rather than asserted.
 *
 * small / mid / large are grouped by *activated* parameters from the chat task
 * (<=9B, <=32B, >32B). MoE models are placed by activated rather than total
 * params, since that is what drives compute — though they carry a memory
 * bandwidth penalty visible in the spread.
 *
 * `reasoning` is derived from the GPQA task restricted to models with >=20B
 * activated parameters. Restricting matters: the unrestricted GPQA median is
 * dragged down to 0.104 Wh/1k by small efficient models like gpt-oss-20b, which
 * would badly understate a frontier reasoning model such as o3 or DeepSeek-R1.
 */
export const MLENERGY_CLASS: Readonly<
  Record<"small" | "mid" | "large" | "reasoning", { lo: number; mid: number; hi: number; configs: number }>
> = {
  small: { lo: 0.01911, mid: 0.04254, hi: 0.12543, configs: 84 },
  mid: { lo: 0.04474, mid: 0.15593, hi: 0.97752, configs: 165 },
  large: { lo: 0.103, mid: 0.31853, hi: 1.70362, configs: 79 },
  reasoning: { lo: 0.1735, mid: 0.66403, hi: 2.2712, configs: 60 },
} as const;

