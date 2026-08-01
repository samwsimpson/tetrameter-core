/**
 * Where recorded calls go.
 *
 * The JSONL file sink is the one that matters right now. It means SiteBeacon can
 * be instrumented and the engine run over its real traffic **without any backend
 * existing** — no ingest service, no database, no deploy. That pulls the first
 * real case study, which is the P1 exit criterion, months earlier than the
 * roadmap assumed.
 *
 * Every sink follows one rule: never throw into the caller. The Collector catches
 * anyway, but a sink that throws on a full disk during someone's incident is a
 * collector that gets deleted.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { RecordedCall, Sink } from "./types.js";

/** Errors that mean "this path will never be writable", not "try again". */
function isUnwritable(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return (
    code === "EROFS" ||
    code === "EACCES" ||
    code === "EPERM" ||
    code === "ENOENT" ||
    code === "ENOTDIR"
  );
}

/** Turn a synchronous throw into a rejection so `allSettled` can see it. */
async function attempt<T>(fn: () => T | Promise<T>): Promise<T> {
  return await fn();
}

/** Keeps everything in memory. For tests and short scripts. */
export class MemorySink implements Sink {
  readonly name = "memory";
  readonly calls: RecordedCall[] = [];

  write(calls: readonly RecordedCall[]): void {
    this.calls.push(...calls);
  }

  clear(): void {
    this.calls.length = 0;
  }
}

/**
 * Newline-delimited JSON, appended.
 *
 * JSONL rather than a JSON array because appends need no read-modify-write, a
 * truncated file is still readable up to the last complete line, and the engine
 * can stream it. A crashed process loses at most the final line.
 */
export class JsonlFileSink implements Sink {
  readonly name = "jsonl";
  #ensured = false;
  #explained = false;

  constructor(private readonly path: string) {}

  async write(calls: readonly RecordedCall[]): Promise<void> {
    if (calls.length === 0) return;
    if (!this.#ensured) {
      await mkdir(dirname(this.path), { recursive: true }).catch(() => {});
      this.#ensured = true;
    }
    const lines = calls.map((c) => JSON.stringify(c)).join("\n") + "\n";

    try {
      await appendFile(this.path, lines, "utf8");
    } catch (err) {
      // Serverless filesystems are read-only outside the temp directory. Left
      // alone, every batch failed into a generic warning and the capture came
      // back empty — a report that looks complete and is not.
      //
      // Explained once, then the raw error: repeating a paragraph every batch
      // buries the signal in the customer's logs, which is its own way of being
      // ignored.
      if (!this.#explained && isUnwritable(err)) {
        this.#explained = true;
        throw new Error(
          `Cannot write ${this.path} — the filesystem is not writable. On Vercel, ` +
            `Lambda and most serverless runtimes only the temp directory is. Set ` +
            `TETRAMETER_CAPTURE to a path under os.tmpdir(), or use an HTTP sink. ` +
            `File capture is a development tool, not a production one.`,
          { cause: err },
        );
      }
      throw err;
    }
  }
}

export interface HttpSinkOptions {
  readonly url: string;
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  /** Milliseconds before a batch POST is abandoned. */
  readonly timeoutMs?: number;
}

/**
 * Batched HTTP POST to an ingest endpoint.
 *
 * Not usable until the ingest service exists; written now so the switch from
 * file to service is a config change. Note the timeout: telemetry that hangs on
 * a slow network must not hold the host process open.
 */
export class HttpSink implements Sink {
  readonly name = "http";
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(private readonly opts: HttpSinkOptions) {
    this.#fetch = opts.fetchImpl ?? globalThis.fetch;
    this.#timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async write(calls: readonly RecordedCall[]): Promise<void> {
    if (calls.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const res = await this.#fetch(this.opts.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({ calls }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`ingest returned ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Writes to several sinks. One failing must not stop the others. */
export class MultiSink implements Sink {
  readonly name = "multi";

  constructor(private readonly sinks: readonly Sink[]) {}

  /**
   * `Promise.allSettled` only catches *rejections*. A sink whose `write` throws
   * synchronously blows up inside `.map()` before allSettled is ever reached,
   * taking the healthy sinks down with it — which defeats the entire point of a
   * MultiSink. Wrapping each call converts a sync throw into a rejection first.
   *
   * Caught by a test asserting the healthy sink still received its batch.
   */
  async write(calls: readonly RecordedCall[]): Promise<void> {
    const results = await Promise.allSettled(this.sinks.map((s) => attempt(() => s.write(calls))));
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length === this.sinks.length && failed.length > 0) {
      throw new Error(`all ${failed.length} sinks failed`);
    }
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.sinks.map((s) => attempt(() => s.flush?.())));
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.sinks.map((s) => attempt(() => s.close?.())));
  }
}
