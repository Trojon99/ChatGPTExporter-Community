import { describe, expect, it, vi } from "vitest";

import { MemoryArchiveFileSystem } from "../../src/core/filesystem";
import { prettyJson } from "../../src/core/serialization";
import type { ConversationInventory, JsonValue } from "../../src/core/types";
import { ChatGptCaptureEngine } from "../../src/chatgpt/capture-engine";
import type { ChatGptTransport, DiscoveredWorkspace } from "../../src/chatgpt/client";
import type { ChatGptOperationParameters } from "../../src/chatgpt/endpoints";
import { BRIDGE_PROTOCOL_VERSION, type ApiSuccessResponse } from "../../src/extension/protocol";
import { conversationDetail } from "../fixtures/chatgpt";

const workspace: DiscoveredWorkspace = {
  accountId: "account-1",
  workspaceFingerprint: "a".repeat(32),
  label: "Synthetic",
  kind: "personal",
  deactivated: false,
};

describe("journaled ChatGPT capture engine", () => {
  it("writes raw revisions before deterministic derived files and a final completion marker", async () => {
    const filesystem = await fixtureFilesystem();
    const transport = fixtureTransport();
    const result = await new ChatGptCaptureEngine({ transport, filesystem, workspace, runId: "run-1", now: clock() }).run();
    expect(result).toMatchObject({ capturedCount: 1, rebuiltCount: 0, skippedCount: 0, failedCount: 0 });
    const paths = filesystem.paths();
    expect(paths).toEqual(expect.arrayContaining([
      "conversations/conversation-1/assets.json",
      "conversations/conversation-1/complete.json",
      "conversations/conversation-1/conversation.json",
      "conversations/conversation-1/conversation.md",
      "conversations/conversation-1/raw-complete.json",
      "runs/run-1.json",
    ]));
    expect(paths.some((path) => path.includes("/source/detail-"))).toBe(true);
    expect(paths.some((path) => path.includes("/source/batch-"))).toBe(true);
    const journal = JSON.parse((await filesystem.readText("runs/run-1.json"))!);
    expect(journal.entries.map((entry: { to: string }) => entry.to)).toEqual(["pending", "capturing", "writing", "complete"]);
  });

  it("performs an unchanged repeat without network requests", async () => {
    const filesystem = await fixtureFilesystem();
    await new ChatGptCaptureEngine({ transport: fixtureTransport(), filesystem, workspace, runId: "run-1", now: clock() }).run();
    const repeatTransport = fixtureTransport();
    const result = await new ChatGptCaptureEngine({ transport: repeatTransport, filesystem, workspace, runId: "run-2", now: clock() }).run();
    expect(result).toMatchObject({ capturedCount: 0, rebuiltCount: 0, skippedCount: 1 });
    expect(repeatTransport.request).not.toHaveBeenCalled();
  });

  it("rebuilds corrupted derived output from validated raw bytes without refetching", async () => {
    const filesystem = await fixtureFilesystem();
    await new ChatGptCaptureEngine({ transport: fixtureTransport(), filesystem, workspace, runId: "run-1", now: clock() }).run();
    await filesystem.writeTextAtomic("conversations/conversation-1/conversation.md", "corrupt\n");
    const transport = fixtureTransport();
    const result = await new ChatGptCaptureEngine({ transport, filesystem, workspace, runId: "run-2", now: clock() }).run();
    expect(result.rebuiltCount).toBe(1);
    expect(transport.request).not.toHaveBeenCalled();
    expect(await filesystem.readText("conversations/conversation-1/conversation.md")).toContain("Synthetic response.");
  });

  it("refetches when changed inventory listing evidence invalidates the raw marker", async () => {
    const filesystem = await fixtureFilesystem();
    await new ChatGptCaptureEngine({ transport: fixtureTransport(), filesystem, workspace, runId: "run-1", now: clock() }).run();
    const inventory = JSON.parse((await filesystem.readText("inventory.json"))!) as ConversationInventory;
    inventory.conversations[0]!.listingHashes = ["changed-listing"];
    await filesystem.writeTextAtomic("inventory.json", prettyJson(inventory));
    const transport = fixtureTransport();
    const result = await new ChatGptCaptureEngine({ transport, filesystem, workspace, runId: "run-2", now: clock() }).run();
    expect(result.capturedCount).toBe(1);
    expect(transport.request).toHaveBeenCalledTimes(1);
  });
});

async function fixtureFilesystem(): Promise<MemoryArchiveFileSystem> {
  const filesystem = new MemoryArchiveFileSystem();
  const inventory: ConversationInventory = {
    schemaVersion: 1,
    provider: "chatgpt-web",
    workspaceFingerprint: workspace.workspaceFingerprint,
    generatedAt: "2026-08-01T00:00:00.000Z",
    complete: true,
    chains: [{ chainId: "main", scope: "main", complete: true, terminationReason: "declared_total_reached", pageCount: 1, itemCount: 1, uniqueConversationCount: 1 }],
    pages: [],
    conversations: [{
      logicalKey: `${workspace.workspaceFingerprint}/conversation-1`,
      conversationId: "conversation-1",
      title: "Synthetic",
      createTime: 1,
      updateTime: 2,
      memberships: [{ scope: "main" }],
      listingHashes: ["listing-1"],
      listingRecords: [{ id: "conversation-1", title: "Synthetic" }],
    }],
  };
  await filesystem.writeTextAtomic("inventory.json", prettyJson(inventory));
  return filesystem;
}

function fixtureTransport(): ChatGptTransport & { request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(async (operation: ChatGptOperationParameters): Promise<ApiSuccessResponse> => {
    if (operation.operation !== "conversation_batch") throw new Error(`unexpected ${operation.operation}`);
    const body = [conversationDetail() as unknown as JsonValue];
    return { requestId: "request", protocolVersion: BRIDGE_PROTOCOL_VERSION, ok: true, status: 200, body, responseBytes: JSON.stringify(body).length, correlationId: "correlation" };
  });
  return { request } as ChatGptTransport & { request: ReturnType<typeof vi.fn> };
}

function clock(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 1, 0, 0, tick++));
}
