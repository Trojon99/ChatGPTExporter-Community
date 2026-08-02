import type { JsonValue } from "../core/types";
import { parseOperationRequest, type ChatGptOperationParameters } from "../chatgpt/endpoints";

export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export const PAGE_REQUEST_CHANNEL = "chatgpt-exporter:page-request:v1";
export const PAGE_RESPONSE_CHANNEL = "chatgpt-exporter:page-response:v1";

export interface FindTabResult {
  ok: boolean;
  tabId?: number;
  title?: string;
  error?: string;
}

export type ApiRequest = ChatGptOperationParameters & {
  requestId: string;
  protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  workspaceId: string | null;
  timeoutMs: number;
};

export interface ApiSuccessResponse {
  requestId: string;
  protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  ok: true;
  status: number;
  body: JsonValue;
  responseBytes: number;
  correlationId: string;
}

export interface ApiFailureResponse {
  requestId: string;
  protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  ok: false;
  status?: number;
  error: {
    name: string;
    message: string;
    code: string;
    retryable: boolean;
    retryAfterMs?: number;
    correlationId: string;
    responseBytes?: number;
  };
}

export type ApiResponse = ApiSuccessResponse | ApiFailureResponse;

export function parseApiRequest(value: unknown): ApiRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("request must be an object");
  const input = value as Record<string, unknown>;
  const requestId = typeof input.requestId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(input.requestId)
    ? input.requestId
    : invalid("requestId is invalid");
  if (input.protocolVersion !== BRIDGE_PROTOCOL_VERSION) invalid("protocolVersion is invalid");
  if (!Number.isInteger(input.timeoutMs) || (input.timeoutMs as number) < 1_000 || (input.timeoutMs as number) > 120_000) {
    invalid("timeoutMs must be between 1000 and 120000");
  }
  if (input.workspaceId !== null && (typeof input.workspaceId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(input.workspaceId))) {
    invalid("workspaceId is invalid");
  }
  const operation = parseOperationRequest({ operation: input.operation, parameters: input.parameters });
  return {
    ...operation,
    requestId,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    workspaceId: input.workspaceId as string | null,
    timeoutMs: input.timeoutMs as number,
  } as ApiRequest;
}

export function isApiResponse(value: unknown): value is ApiResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Partial<ApiResponse>;
  return response.protocolVersion === BRIDGE_PROTOCOL_VERSION
    && typeof response.requestId === "string"
    && typeof response.ok === "boolean";
}

export function failureResponse(
  requestId: string,
  code: string,
  message: string,
  options: { status?: number; retryable?: boolean; retryAfterMs?: number; responseBytes?: number; correlationId?: string } = {},
): ApiFailureResponse {
  const correlationId = options.correlationId ?? crypto.randomUUID();
  return {
    requestId,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    ok: false,
    ...(options.status === undefined ? {} : { status: options.status }),
    error: {
      name: "ChatGPTExporterError",
      message,
      code,
      retryable: options.retryable ?? false,
      correlationId,
      ...(options.retryAfterMs === undefined ? {} : { retryAfterMs: options.retryAfterMs }),
      ...(options.responseBytes === undefined ? {} : { responseBytes: options.responseBytes }),
    },
  };
}

export function requestId(value: unknown): string {
  if (!value || typeof value !== "object") return "unknown";
  const candidate = (value as { requestId?: unknown }).requestId;
  return typeof candidate === "string" && candidate ? candidate : "unknown";
}

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 100) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value !== "object") return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function invalid(message: string): never {
  throw new Error(message);
}
