import { describe, expect, it, vi } from "vitest";

import { ControlledTransport } from "../../src/core/request-control";
import type { ChatGptTransport } from "../../src/chatgpt/client";
import type { ApiSuccessResponse } from "../../src/extension/protocol";

const response: ApiSuccessResponse = {
  requestId: "request",
  protocolVersion: 1,
  ok: true,
  status: 200,
  body: {},
  responseBytes: 2,
  correlationId: "correlation",
};

describe("cooperative provider request control", () => {
  it("pauses before the next request and resumes it without losing the operation", async () => {
    const inner = transport();
    const controlled = new ControlledTransport(inner, { delayMs: 0, maxConcurrency: 1 });
    controlled.pause();
    const pending = controlled.request({ operation: "session_probe", parameters: {} }, null);
    await Promise.resolve();
    expect(inner.request).not.toHaveBeenCalled();
    controlled.resume();
    await expect(pending).resolves.toEqual(response);
    expect(inner.request).toHaveBeenCalledTimes(1);
  });

  it("cancels queued requests with a retryable terminal error", async () => {
    const inner = transport();
    const controlled = new ControlledTransport(inner, { delayMs: 0, maxConcurrency: 1 });
    controlled.pause();
    const pending = controlled.request({ operation: "session_probe", parameters: {} }, null);
    controlled.cancel();
    await expect(pending).rejects.toMatchObject({ code: "RUN_CANCELLED", retryable: true });
    expect(inner.request).not.toHaveBeenCalled();
  });

  it("enforces the configured delay between completed requests", async () => {
    let now = 1_000;
    const sleep = vi.fn(async (milliseconds: number) => { now += milliseconds; });
    const inner = transport();
    const controlled = new ControlledTransport(inner, { delayMs: 250, maxConcurrency: 1, now: () => now, sleep });
    await controlled.request({ operation: "session_probe", parameters: {} }, null);
    await controlled.request({ operation: "session_probe", parameters: {} }, null);
    expect(sleep).toHaveBeenLastCalledWith(250);
  });
});

function transport(): ChatGptTransport & { request: ReturnType<typeof vi.fn> } {
  return { request: vi.fn(async () => response) } as ChatGptTransport & { request: ReturnType<typeof vi.fn> };
}
