// Page-world shell adapted from GrokExporter commit 85922d6; it performs no fetches in this baseline.
import { disabledResponse, PAGE_REQUEST_CHANNEL, PAGE_RESPONSE_CHANNEL, requestId } from "./protocol";

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data as { channel?: string; request?: unknown } | undefined;
  if (data?.channel !== PAGE_REQUEST_CHANNEL) return;
  window.postMessage({
    channel: PAGE_RESPONSE_CHANNEL,
    response: disabledResponse(requestId(data.request)),
  }, location.origin);
});
