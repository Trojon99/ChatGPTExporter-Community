import { describe, expect, it, vi } from "vitest";

import { ChatGptDetailFetcher } from "../../src/chatgpt/capture";
import type { ChatGptTransport, DiscoveredWorkspace } from "../../src/chatgpt/client";
import type { ChatGptOperationParameters } from "../../src/chatgpt/endpoints";
import { fetchPaginatedDetail, PaginatedDetailError } from "../../src/chatgpt/paginated-detail";
import type { InventoryConversation, JsonValue } from "../../src/core/types";
import { BRIDGE_PROTOCOL_VERSION, type ApiSuccessResponse } from "../../src/extension/protocol";

const workspace: DiscoveredWorkspace = {
  accountId: "account-1", workspaceFingerprint: "a".repeat(32), label: "Synthetic", kind: "business", deactivated: false,
};
const inventory: InventoryConversation = {
  logicalKey: `${workspace.workspaceFingerprint}/conversation-1`, conversationId: "conversation-1",
  title: "Synthetic", createTime: 1, updateTime: 2, memberships: [{ scope: "main" }], listingHashes: ["listing-1"],
};

function message(id: string): JsonValue {
  return { id, author: { role: id.startsWith("u") ? "user" : "assistant" }, create_time: 1,
    content: { content_type: "text", parts: [id] }, metadata: {} };
}

function page(ids: string[], hasPrevious: boolean, startCursor: string | null): JsonValue {
  return { conversation_id: "conversation-1", title: "Synthetic", create_time: 1, update_time: 2,
    messages: ids.map(message), page_info: { has_previous_page: hasPrevious, has_next_page: false, start_cursor: startCursor } };
}

function withoutIdentity(value: JsonValue): JsonValue {
  const copy = { ...(value as Record<string, JsonValue>) };
  delete copy.id;
  delete copy.conversation_id;
  delete copy.conversation;
  return copy;
}

function transportFor(handler: (operation: ChatGptOperationParameters) => JsonValue): ChatGptTransport & { request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(async (operation: ChatGptOperationParameters): Promise<ApiSuccessResponse> => {
    const body = handler(operation);
    return { requestId: "synthetic", protocolVersion: BRIDGE_PROTOCOL_VERSION, ok: true, status: 200,
      body, responseBytes: JSON.stringify(body).length, correlationId: "synthetic-correlation" };
  });
  return { request };
}

describe("plural paginated conversation detail", () => {
  it("accepts an initial page with a matching identity", async () => {
    const body: JsonValue = { ...page(["u1", "a2"], false, "u1") as object, id: "conversation-1" };
    delete (body as Record<string, JsonValue>).conversation_id;
    const result = await new ChatGptDetailFetcher(transportFor(() => body), workspace).fetchAll([inventory]);
    expect(result.conversations[0]?.source).toBe("paginated");
  });

  it("rejects an initial page with no identity", async () => {
    const transport = transportFor(() => withoutIdentity(page(["u1", "a2"], false, "u1")));
    const error = await new ChatGptDetailFetcher(transport, workspace).fetchAll([inventory]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaginatedDetailError);
    expect(String(error)).toContain("initial page");
    expect(String(error)).toContain("conversation_id:present=false,type=absent,matches=false");
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it("accepts an identity-free older page scoped by the requested endpoint", async () => {
    const transport = transportFor((operation) => operation.operation === "conversation_current"
      ? page(["u3", "a4"], true, "u3")
      : withoutIdentity(page(["u1", "a2", "u3"], false, "u1")));
    const result = await new ChatGptDetailFetcher(transport, workspace).fetchAll([inventory]);
    expect(Object.keys(result.conversations[0]!.detail.mapping)).toHaveLength(5);
    expect((result.conversations[0]!.raw as Record<string, JsonValue>).source_pages).toHaveLength(2);
  });

  it("accepts an older page whose present identity matches", async () => {
    const transport = transportFor((operation) => operation.operation === "conversation_current"
      ? page(["u3", "a4"], true, "u3")
      : { ...withoutIdentity(page(["u1", "a2", "u3"], false, "u1")) as object, id: "conversation-1" });
    const result = await new ChatGptDetailFetcher(transport, workspace).fetchAll([inventory]);
    expect(Object.keys(result.conversations[0]!.detail.mapping)).toHaveLength(5);
  });

  it("rejects a mismatching identity on an older page", async () => {
    const transport = transportFor((operation) => operation.operation === "conversation_current"
      ? page(["u3", "a4"], true, "u3")
      : { ...withoutIdentity(page(["u1", "a2", "u3"], false, "u1")) as object, id: "different-private-id" });
    const error = await new ChatGptDetailFetcher(transport, workspace).fetchAll([inventory]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaginatedDetailError);
    expect(String(error)).toContain("older page");
    expect(String(error)).toContain("id:present=true,type=string,matches=false");
    expect(String(error)).not.toContain("different-private-id");
  });

  it("recognizes matching nested identity and rejects nested conflicts", async () => {
    const nestedOnly = { ...withoutIdentity(page(["u1", "a2"], false, "u1")) as object,
      conversation: { conversation_id: "conversation-1" } };
    const accepted = await new ChatGptDetailFetcher(transportFor(() => nestedOnly), workspace).fetchAll([inventory]);
    expect(accepted.conversations[0]?.source).toBe("paginated");

    const conflict = { ...page(["u1", "a2"], false, "u1") as object,
      conversation: { id: "different-private-id" } };
    const error = await new ChatGptDetailFetcher(transportFor(() => conflict), workspace)
      .fetchAll([inventory]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaginatedDetailError);
    expect(String(error)).toContain("conversation.id:present=true,type=string,matches=false");
    expect(String(error)).not.toContain("different-private-id");
  });

  it("retrieves all older pages, deduplicates a stable boundary, and archives every source page", async () => {
    const transport = transportFor((operation) => {
      if (operation.operation === "conversation_current") return page(["u5", "a6"], true, "u5");
      if (operation.operation === "conversation_messages" && operation.parameters.before === "u5") {
        return { ...page(["u3", "a4", "u5"], true, "u3") as object,
          page_info: { has_previous_page: true, has_next_page: true, start_cursor: "u3" } };
      }
      if (operation.operation === "conversation_messages" && operation.parameters.before === "u3") {
        return { ...page(["u1", "a2", "u3"], false, "u1") as object,
          page_info: { has_previous_page: false, has_next_page: true, start_cursor: "u1" } };
      }
      throw new Error(`unexpected ${operation.operation}`);
    });
    const result = await new ChatGptDetailFetcher(transport, workspace).fetchAll([inventory]);
    const retrieved = result.conversations[0]!;
    expect(retrieved.source).toBe("paginated");
    expect(Object.keys(retrieved.detail.mapping)).toHaveLength(7);
    expect(retrieved.detail.current_node).toBe("a6");
    expect(retrieved.detail.mapping.a2?.parent).toBe("u1");
    expect(retrieved.detail.mapping.a4?.parent).toBe("u3");
    expect((retrieved.raw as Record<string, JsonValue>).source_pages).toHaveLength(3);
    expect(result.batches).toHaveLength(0);
    expect(transport.request.mock.calls.map(([operation]) => operation.operation)).toEqual(["conversation_current", "conversation_messages", "conversation_messages"]);
  });

  it("fails closed on missing or repeated cursors, identity drift, and non-progress", async () => {
    const cases = [
      { first: page(["u3", "a4"], true, null), older: null },
      { first: page(["u3", "a4"], true, "u3"), older: page(["u3", "a4"], true, "u3") },
      { first: page(["u3", "a4"], true, "u3"), older: { ...page(["u1", "a2", "u3"], true, "u3") as object,
        page_info: { has_previous_page: true, has_next_page: true, start_cursor: "u3" } } },
      { first: page(["u3", "a4"], true, "u3"), older: { ...page(["u1", "a2"], false, "u1") as object, conversation_id: "other" } },
      { first: page([], true, "u3"), older: page(["u1", "a2"], false, "u1") },
    ];
    for (const item of cases) {
      const transport = transportFor((operation) => operation.operation === "conversation_current" ? item.first : item.older as JsonValue);
      await expect(new ChatGptDetailFetcher(transport, workspace).fetchAll([inventory])).rejects.toBeInstanceOf(PaginatedDetailError);
    }
  });

  it("rejects malformed plural 200 responses without trying legacy routes", async () => {
    const malformed = transportFor(() => ({ conversation_id: "conversation-1", messages: [] }));
    await expect(new ChatGptDetailFetcher(malformed, workspace).fetchAll([inventory])).rejects.toBeInstanceOf(PaginatedDetailError);
    expect(malformed.request).toHaveBeenCalledTimes(1);
  });

  it("rejects a conversation that exceeds the total byte or page limit", async () => {
    const oversized: ChatGptTransport = {
      request: async () => ({ requestId: "synthetic", protocolVersion: BRIDGE_PROTOCOL_VERSION, ok: true, status: 200,
        body: page(["u1"], false, "u1"), responseBytes: 500_000_001, correlationId: "synthetic-correlation" }),
    };
    await expect(fetchPaginatedDetail(oversized, inventory.conversationId, workspace.accountId))
      .rejects.toThrow("total response byte limit");

    let nextMessage = 1_001;
    const endless = transportFor(() => {
      const id = `u${nextMessage--}`;
      return page([id], true, id);
    });
    await expect(fetchPaginatedDetail(endless, inventory.conversationId, workspace.accountId))
      .rejects.toThrow("page limit");
    expect(endless.request).toHaveBeenCalledTimes(1_000);
  });

  it("reports only fixed identity-field presence, types, and match booleans", async () => {
    const secret = "synthetic-private-body-and-token";
    const firstBody: JsonValue = {
      ...page(["u1", "a2"], false, "u1") as object,
      id: 42,
      conversation_id: "different-provider-id",
      conversation: { id: "conversation-1", conversation_id: null },
      private_payload: secret,
    };
    const firstError = await new ChatGptDetailFetcher(transportFor(() => firstBody), workspace)
      .fetchAll([inventory]).catch((caught: unknown) => caught);
    expect(firstError).toBeInstanceOf(PaginatedDetailError);
    expect(String(firstError)).toContain("initial page");
    expect(String(firstError)).toContain("id:present=true,type=number,matches=false");
    expect(String(firstError)).toContain("conversation_id:present=true,type=string,matches=false");
    expect(String(firstError)).toContain("conversation.id:present=true,type=string,matches=true");
    for (const privateValue of [secret, "different-provider-id", "conversation-1"]) {
      expect(String(firstError)).not.toContain(privateValue);
    }

    const older = transportFor((operation) => operation.operation === "conversation_current"
      ? page(["u3", "a4"], true, "u3")
      : { ...page(["u1", "a2"], false, "u1") as object, conversation_id: null });
    const olderError = await new ChatGptDetailFetcher(older, workspace).fetchAll([inventory]).catch((caught: unknown) => caught);
    expect(String(olderError)).toContain("older page");
    expect(String(olderError)).toContain("conversation_id:present=true,type=null,matches=false");
    expect(String(olderError)).toContain("id:present=false,type=absent,matches=false");
    expect(String(olderError)).not.toContain("conversation-1");
  });

  it("still rejects conflicting top-level identities when one matches", async () => {
    const body: JsonValue = { ...page(["u1", "a2"], false, "u1") as object, id: "another-id" };
    const error = await new ChatGptDetailFetcher(transportFor(() => body), workspace)
      .fetchAll([inventory]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaginatedDetailError);
    expect(String(error)).toContain("id:present=true,type=string,matches=false");
    expect(String(error)).toContain("conversation_id:present=true,type=string,matches=true");
    expect(String(error)).not.toContain("another-id");
  });
});
