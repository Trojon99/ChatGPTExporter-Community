import type { JsonValue } from "../core/types";

export type ChatGptOperation =
  | "session_probe"
  | "accounts_list"
  | "conversation_page"
  | "project_page"
  | "project_conversation_page"
  | "conversation_batch"
  | "conversation_detail";

export type ChatGptOperationParameters =
  | { operation: "session_probe"; parameters: Record<string, never> }
  | { operation: "accounts_list"; parameters: Record<string, never> }
  | { operation: "conversation_page"; parameters: { offset: number; limit: number; archived: boolean } }
  | { operation: "project_page"; parameters: { cursor: string | null } }
  | { operation: "project_conversation_page"; parameters: { projectId: string; cursor: string | null; limit: number } }
  | { operation: "conversation_batch"; parameters: { conversationIds: string[] } }
  | { operation: "conversation_detail"; parameters: { conversationId: string } };

export interface ResolvedEndpoint {
  operation: ChatGptOperation;
  method: "GET" | "POST";
  path: string;
  body?: JsonValue;
  requiresAuthentication: boolean;
  responseLimitBytes: number;
}

const IDENTIFIER = /^[A-Za-z0-9_-]{1,256}$/;
const CURSOR = /^[A-Za-z0-9._~-]{1,512}$/;
const MAX_PAGE_SIZE = 100;
const MAX_BATCH_SIZE = 10;

export function resolveEndpoint(request: ChatGptOperationParameters): ResolvedEndpoint {
  switch (request.operation) {
    case "session_probe":
      return endpoint("GET", "/api/auth/session", false, 1_000_000, request.operation);
    case "accounts_list":
      return endpoint("GET", "/backend-api/accounts/check/v4-2023-04-27", true, 5_000_000, request.operation);
    case "conversation_page": {
      assertOffset(request.parameters.offset);
      assertLimit(request.parameters.limit);
      const query = new URLSearchParams({
        offset: String(request.parameters.offset),
        limit: String(request.parameters.limit),
        order: "updated",
        ...(request.parameters.archived ? { is_archived: "true" } : {}),
      });
      return endpoint("GET", `/backend-api/conversations?${query}`, true, 20_000_000, request.operation);
    }
    case "project_page": {
      const query = new URLSearchParams({ conversations_per_gizmo: "0" });
      if (request.parameters.cursor !== null) query.set("cursor", assertCursor(request.parameters.cursor));
      return endpoint("GET", `/backend-api/gizmos/snorlax/sidebar?${query}`, true, 20_000_000, request.operation);
    }
    case "project_conversation_page": {
      const projectId = assertIdentifier(request.parameters.projectId, "projectId");
      assertLimit(request.parameters.limit);
      const query = new URLSearchParams({ limit: String(request.parameters.limit) });
      if (request.parameters.cursor !== null) query.set("cursor", assertCursor(request.parameters.cursor));
      return endpoint("GET", `/backend-api/gizmos/${projectId}/conversations?${query}`, true, 20_000_000, request.operation);
    }
    case "conversation_batch": {
      const ids = request.parameters.conversationIds;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BATCH_SIZE) {
        throw new EndpointValidationError(`conversationIds must contain 1-${MAX_BATCH_SIZE} identifiers`);
      }
      if (new Set(ids).size !== ids.length) throw new EndpointValidationError("conversationIds must be unique");
      ids.forEach((id) => assertIdentifier(id, "conversationId"));
      return endpoint("POST", "/backend-api/conversations/batch", true, 100_000_000, request.operation, {
        conversation_ids: ids,
      });
    }
    case "conversation_detail": {
      const conversationId = assertIdentifier(request.parameters.conversationId, "conversationId");
      return endpoint("GET", `/backend-api/conversation/${conversationId}`, true, 100_000_000, request.operation);
    }
  }
}

export function parseOperationRequest(value: unknown): ChatGptOperationParameters {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EndpointValidationError("request must be an object");
  const request = value as { operation?: unknown; parameters?: unknown };
  if (typeof request.operation !== "string") throw new EndpointValidationError("operation must be a string");
  const parameters = requireParameterObject(request.parameters);
  switch (request.operation) {
    case "session_probe":
    case "accounts_list":
      assertOnlyKeys(parameters, []);
      return { operation: request.operation, parameters: {} };
    case "conversation_page":
      assertOnlyKeys(parameters, ["offset", "limit", "archived"]);
      return {
        operation: request.operation,
        parameters: {
          offset: requireNumber(parameters.offset, "offset"),
          limit: requireNumber(parameters.limit, "limit"),
          archived: requireBoolean(parameters.archived, "archived"),
        },
      };
    case "project_page":
      assertOnlyKeys(parameters, ["cursor"]);
      return { operation: request.operation, parameters: { cursor: requireNullableString(parameters.cursor, "cursor") } };
    case "project_conversation_page":
      assertOnlyKeys(parameters, ["projectId", "cursor", "limit"]);
      return {
        operation: request.operation,
        parameters: {
          projectId: requireString(parameters.projectId, "projectId"),
          cursor: requireNullableString(parameters.cursor, "cursor"),
          limit: requireNumber(parameters.limit, "limit"),
        },
      };
    case "conversation_batch":
      assertOnlyKeys(parameters, ["conversationIds"]);
      if (!Array.isArray(parameters.conversationIds) || !parameters.conversationIds.every((id) => typeof id === "string")) {
        throw new EndpointValidationError("conversationIds must be an array of strings");
      }
      return { operation: request.operation, parameters: { conversationIds: [...parameters.conversationIds] } };
    case "conversation_detail":
      assertOnlyKeys(parameters, ["conversationId"]);
      return {
        operation: request.operation,
        parameters: { conversationId: requireString(parameters.conversationId, "conversationId") },
      };
    default:
      throw new EndpointValidationError(`unsupported operation ${request.operation}`);
  }
}

export class EndpointValidationError extends Error {
  readonly code = "INVALID_BRIDGE_REQUEST";
  constructor(message: string) {
    super(message);
    this.name = "EndpointValidationError";
  }
}

function endpoint(
  method: "GET" | "POST",
  path: string,
  requiresAuthentication: boolean,
  responseLimitBytes: number,
  operation: ChatGptOperation,
  body?: JsonValue,
): ResolvedEndpoint {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("..") || new URL(path, "https://chatgpt.com").origin !== "https://chatgpt.com") {
    throw new EndpointValidationError("resolved endpoint escaped the ChatGPT origin");
  }
  return { operation, method, path, requiresAuthentication, responseLimitBytes, ...(body === undefined ? {} : { body }) };
}

function assertIdentifier(value: string, name: string): string {
  if (!IDENTIFIER.test(value)) throw new EndpointValidationError(`${name} contains invalid characters`);
  return value;
}

function assertCursor(value: string): string {
  if (!CURSOR.test(value)) throw new EndpointValidationError("cursor contains invalid characters");
  return value;
}

function assertOffset(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new EndpointValidationError("offset is invalid");
}

function assertLimit(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) throw new EndpointValidationError(`limit must be 1-${MAX_PAGE_SIZE}`);
}

function requireParameterObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EndpointValidationError("parameters must be an object");
  return value as Record<string, unknown>;
}

function assertOnlyKeys(value: Record<string, unknown>, expected: string[]): void {
  const unexpected = Object.keys(value).filter((key) => !expected.includes(key));
  if (unexpected.length) throw new EndpointValidationError(`unexpected parameters: ${unexpected.join(", ")}`);
  const missing = expected.filter((key) => !(key in value));
  if (missing.length) throw new EndpointValidationError(`missing parameters: ${missing.join(", ")}`);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new EndpointValidationError(`${name} must be a non-empty string`);
  return value;
}

function requireNullableString(value: unknown, name: string): string | null {
  if (value === null) return null;
  return requireString(value, name);
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number") throw new EndpointValidationError(`${name} must be a number`);
  return value;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new EndpointValidationError(`${name} must be a boolean`);
  return value;
}
