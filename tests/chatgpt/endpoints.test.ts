import { describe, expect, it } from "vitest";

import { EndpointValidationError, parseOperationRequest, resolveEndpoint } from "../../src/chatgpt/endpoints";
import { BRIDGE_PROTOCOL_VERSION, parseApiRequest } from "../../src/extension/protocol";

describe("ChatGPT endpoint allowlist", () => {
  it("constructs listing endpoints from typed parameters", () => {
    expect(resolveEndpoint({
      operation: "conversation_page",
      parameters: { offset: 28, limit: 28, archived: true },
    })).toMatchObject({
      method: "GET",
      path: "/backend-api/conversations?offset=28&limit=28&order=updated&is_archived=true",
      requiresAuthentication: true,
    });
  });

  it("accepts only bounded identifiers, cursors, pages, and batch sizes", () => {
    expect(() => resolveEndpoint({
      operation: "conversation_detail",
      parameters: { conversationId: "../../api/auth/session" },
    })).toThrow(EndpointValidationError);
    expect(() => resolveEndpoint({
      operation: "conversation_page",
      parameters: { offset: 0, limit: 101, archived: false },
    })).toThrow("limit must be 1-100");
    expect(() => resolveEndpoint({
      operation: "conversation_batch",
      parameters: { conversationIds: Array.from({ length: 11 }, (_, index) => `conversation-${index}`) },
    })).toThrow("1-10");
  });

  it("rejects arbitrary paths, methods, bodies, headers, and extra parameters structurally", () => {
    expect(() => parseOperationRequest({
      operation: "conversation_detail",
      parameters: { conversationId: "conversation-1", path: "http://localhost/private" },
    })).toThrow("unexpected parameters");
    expect(() => parseOperationRequest({ operation: "DELETE", parameters: {} })).toThrow("unsupported operation");
  });

  it("validates the complete versioned bridge request at both boundaries", () => {
    const request = parseApiRequest({
      requestId: "request-1",
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      workspaceId: "account-1",
      timeoutMs: 10_000,
      operation: "conversation_page",
      parameters: { offset: 0, limit: 28, archived: false },
    });
    expect(request.operation).toBe("conversation_page");
    expect(() => parseApiRequest({ ...request, timeoutMs: 999 })).toThrow("timeoutMs");
    expect(() => parseApiRequest({ ...request, protocolVersion: 999 })).toThrow("protocolVersion");
  });
});
