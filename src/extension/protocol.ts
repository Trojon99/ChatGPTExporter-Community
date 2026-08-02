// Protocol shape adapted from GrokExporter commit 85922d6; authenticated operations are intentionally disabled.
export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export const PAGE_REQUEST_CHANNEL = "chatgpt-exporter:page-request:v1";
export const PAGE_RESPONSE_CHANNEL = "chatgpt-exporter:page-response:v1";

export interface FindTabResult {
  ok: boolean;
  tabId?: number;
  title?: string;
  error?: string;
}

export interface DisabledApiRequest {
  requestId: string;
  protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  operation: string;
  path: string;
  method: "GET" | "POST";
  timeoutMs: number;
}

export interface DisabledApiResponse {
  requestId: string;
  protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  ok: false;
  error: {
    name: string;
    message: string;
    code: "ENDPOINTS_NOT_IMPLEMENTED";
    retryable: false;
  };
}

export function disabledResponse(requestId: string): DisabledApiResponse {
  return {
    requestId,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    ok: false,
    error: {
      name: "ChatGPTExporterBaseline",
      message: "Authenticated endpoint adapters are not implemented in this baseline.",
      code: "ENDPOINTS_NOT_IMPLEMENTED",
      retryable: false,
    },
  };
}

export function requestId(value: unknown): string {
  if (!value || typeof value !== "object") return "unknown";
  const candidate = (value as { requestId?: unknown }).requestId;
  return typeof candidate === "string" && candidate ? candidate : "unknown";
}
