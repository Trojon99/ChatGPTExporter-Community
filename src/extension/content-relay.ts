// Relay shell adapted from GrokExporter commit 85922d6; no request reaches the page in this baseline.
import { disabledResponse, requestId } from "./protocol";

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const data = message as { type?: string; request?: unknown } | undefined;
  if (data?.type !== "CHATGPT_EXPORTER_PAGE_REQUEST") return false;
  sendResponse(disabledResponse(requestId(data.request)));
  return false;
});
