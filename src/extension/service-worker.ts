// Runtime shell adapted from GrokExporter commit 85922d6; every API operation fails closed.
import { disabledResponse, type FindTabResult, requestId } from "./protocol";

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
  const request = message as { type?: string; request?: unknown } | undefined;
  if (request?.type === "CHATGPT_EXPORTER_FIND_TAB") {
    void findChatGptTab().then(sendResponse);
    return true;
  }
  if (request?.type === "CHATGPT_EXPORTER_API_REQUEST") {
    sendResponse(disabledResponse(requestId(request.request)));
    return false;
  }
  return false;
});

async function findChatGptTab(): Promise<FindTabResult> {
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*"] });
  const tab = tabs.find((candidate) => candidate.active) ?? tabs[0];
  if (tab?.id === undefined) return { ok: false, error: "Open and sign in to chatgpt.com, then try again." };
  return { ok: true, tabId: tab.id, ...(tab.title === undefined ? {} : { title: tab.title }) };
}
