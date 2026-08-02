import type { ChatGptTransport } from "../chatgpt/client";
import type { ChatGptOperationParameters } from "../chatgpt/endpoints";
import type { ApiSuccessResponse } from "../extension/protocol";

export type RequestControlState = "running" | "paused" | "cancelled";

export class ControlledTransport implements ChatGptTransport {
  private state: RequestControlState = "running";
  private active = 0;
  private lastRequestFinishedAt = 0;
  private waiters = new Set<() => void>();

  constructor(
    private readonly inner: ChatGptTransport,
    private readonly options: {
      delayMs: number;
      maxConcurrency: number;
      now?: () => number;
      sleep?: (milliseconds: number) => Promise<void>;
      onState?: (state: RequestControlState, active: number) => void;
    },
  ) {
    if (!Number.isInteger(options.delayMs) || options.delayMs < 0 || options.delayMs > 60_000) throw new Error("Request delay must be between 0 and 60000 milliseconds.");
    if (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1 || options.maxConcurrency > 8) throw new Error("Request concurrency must be between 1 and 8.");
  }

  pause(): void {
    if (this.state === "cancelled") return;
    this.state = "paused";
    this.notify();
  }

  resume(): void {
    if (this.state === "cancelled") return;
    this.state = "running";
    this.wake();
    this.notify();
  }

  cancel(): void {
    this.state = "cancelled";
    this.wake();
    this.notify();
  }

  getState(): RequestControlState {
    return this.state;
  }

  async request(operation: ChatGptOperationParameters, workspaceId: string | null, timeoutMs?: number): Promise<ApiSuccessResponse> {
    await this.acquire();
    try {
      return await this.inner.request(operation, workspaceId, timeoutMs);
    } finally {
      this.active -= 1;
      this.lastRequestFinishedAt = this.now();
      this.wake();
      this.notify();
    }
  }

  private async acquire(): Promise<void> {
    while (true) {
      this.throwIfCancelled();
      if (this.state === "running" && this.active < this.options.maxConcurrency) {
        const waitMs = Math.max(0, this.options.delayMs - (this.now() - this.lastRequestFinishedAt));
        if (waitMs > 0) await (this.options.sleep ?? defaultSleep)(waitMs);
        this.throwIfCancelled();
        if (this.state !== "running" || this.active >= this.options.maxConcurrency) continue;
        this.active += 1;
        this.notify();
        return;
      }
      await new Promise<void>((resolve) => this.waiters.add(resolve));
    }
  }

  private throwIfCancelled(): void {
    if (this.state === "cancelled") throw new RequestCancelledError();
  }

  private wake(): void {
    const waiters = [...this.waiters];
    this.waiters.clear();
    waiters.forEach((resolve) => resolve());
  }

  private notify(): void {
    this.options.onState?.(this.state, this.active);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}

export class RequestCancelledError extends Error {
  readonly code = "RUN_CANCELLED";
  readonly retryable = true;

  constructor() {
    super("The export was cancelled before the next provider request.");
    this.name = "RequestCancelledError";
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
