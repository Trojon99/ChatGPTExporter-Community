import { describe, expect, it } from "vitest";

import { BRIDGE_PROTOCOL_VERSION, disabledResponse, requestId } from "../../src/extension/protocol";

describe("extension protocol", () => {
  it("fails unimplemented authenticated requests closed", () => {
    expect(disabledResponse("request-1")).toEqual({
      requestId: "request-1",
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      ok: false,
      error: {
        name: "ChatGPTExporterBaseline",
        code: "ENDPOINTS_NOT_IMPLEMENTED",
        message: "Authenticated endpoint adapters are not implemented in this baseline.",
        retryable: false,
      },
    });
  });

  it("accepts only a present string request identifier", () => {
    expect(requestId({ requestId: "request-2" })).toBe("request-2");
    expect(requestId({ requestId: "" })).toBe("unknown");
    expect(requestId(null)).toBe("unknown");
  });
});
