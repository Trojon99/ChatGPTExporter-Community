import { describe, expect, it, vi } from "vitest";

import { AccountArtifactCapture } from "../../src/chatgpt/account-artifacts";
import { MemoryArchiveFileSystem } from "../../src/core/filesystem";
import type { JsonValue } from "../../src/core/types";
import type { ChatGptTransport, DiscoveredWorkspace } from "../../src/chatgpt/client";
import type { ChatGptOperationParameters } from "../../src/chatgpt/endpoints";
import { BRIDGE_PROTOCOL_VERSION, type ApiSuccessResponse } from "../../src/extension/protocol";

const workspace: DiscoveredWorkspace = { accountId: "account-private", workspaceFingerprint: "a".repeat(32), label: "Synthetic", kind: "personal", deactivated: false };

describe("auxiliary account artifacts", () => {
  it("captures append-preserving memories, instructions, and sanitized session metadata", async () => {
    const filesystem = new MemoryArchiveFileSystem();
    const transport = artifactTransport();
    const capture = new AccountArtifactCapture({ transport, filesystem, workspace, now: () => new Date("2026-08-01T00:00:00.000Z") });
    const manifest = await capture.capture();
    expect(manifest.status).toBe("complete");
    expect(manifest.artifacts.map((artifact) => artifact.kind)).toEqual(["session_metadata", "memories", "custom_instructions"]);
    expect(filesystem.paths().filter((path) => path.startsWith("source/account/"))).toHaveLength(7);
    expect(JSON.stringify(manifest)).not.toContain("account-private");
  });

  it("uses a validated marker for unchanged repeats and refreshes explicitly", async () => {
    const filesystem = new MemoryArchiveFileSystem();
    const transport = artifactTransport();
    const capture = new AccountArtifactCapture({ transport, filesystem, workspace });
    await capture.capture();
    await capture.capture();
    expect(transport.request).toHaveBeenCalledTimes(2);
    await capture.capture(true);
    expect(transport.request).toHaveBeenCalledTimes(4);
  });

  it("reports auxiliary failures as partial without hiding successful artifacts", async () => {
    const filesystem = new MemoryArchiveFileSystem();
    const transport = artifactTransport("custom_instructions");
    const manifest = await new AccountArtifactCapture({ transport, filesystem, workspace }).capture();
    expect(manifest.status).toBe("partial");
    expect(manifest.artifacts.find((artifact) => artifact.kind === "memories")?.status).toBe("complete");
    expect(manifest.artifacts.find((artifact) => artifact.kind === "custom_instructions")?.failure?.code).toBe("SYNTHETIC_FAILURE");
  });
});

function artifactTransport(failing?: string): ChatGptTransport & { request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(async (operation: ChatGptOperationParameters): Promise<ApiSuccessResponse> => {
    if (operation.operation !== "account_artifact") throw new Error(`unexpected ${operation.operation}`);
    if (operation.parameters.kind === failing) throw Object.assign(new Error("Synthetic failure."), { code: "SYNTHETIC_FAILURE", correlationId: "failure" });
    const body: JsonValue = operation.parameters.kind === "memories" ? { memories: [{ content: "Synthetic memory" }] } : { about_user_message: "Synthetic instructions" };
    return { requestId: "request", protocolVersion: BRIDGE_PROTOCOL_VERSION, ok: true, status: 200, body, responseBytes: JSON.stringify(body).length, correlationId: "correlation" };
  });
  return { request } as ChatGptTransport & { request: ReturnType<typeof vi.fn> };
}
