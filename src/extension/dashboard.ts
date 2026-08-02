// Dashboard shell adapted from GrokExporter commit 85922d6; capture remains unavailable by design.
import { ensureDirectoryPermission, loadDirectoryHandle, saveDirectoryHandle } from "./handle-store";
import type { FindTabResult } from "./protocol";

const chooseButton = element<HTMLButtonElement>("choose-directory");
const openButton = element<HTMLButtonElement>("open-chatgpt");
const findButton = element<HTMLButtonElement>("find-chatgpt");
const directoryLabel = element<HTMLElement>("directory-label");
const status = element<HTMLElement>("status");
const log = element<HTMLElement>("log");
let directoryHandle: FileSystemDirectoryHandle | undefined;

chooseButton.addEventListener("click", () => void chooseDirectory());
openButton.addEventListener("click", () => void chrome.tabs.create({ url: "https://chatgpt.com/" }));
findButton.addEventListener("click", () => void findTab());
void restoreDirectory();

async function restoreDirectory(): Promise<void> {
  directoryHandle = await loadDirectoryHandle();
  if (directoryHandle && await ensureDirectoryPermission(directoryHandle, false)) {
    directoryLabel.textContent = directoryHandle.name;
  } else if (directoryHandle) {
    directoryLabel.textContent = `${directoryHandle.name} (permission required)`;
  }
}

async function chooseDirectory(): Promise<void> {
  try {
    const selectedHandle = await window.showDirectoryPicker({ id: "chatgpt-exporter-archive", mode: "readwrite" });
    directoryHandle = selectedHandle;
    await saveDirectoryHandle(selectedHandle);
    directoryLabel.textContent = selectedHandle.name;
    setStatus("Archive directory ready; authenticated capture is not enabled yet.", "ready");
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) showError(error);
  }
}

async function findTab(): Promise<void> {
  const tab = await chrome.runtime.sendMessage<{ type: "CHATGPT_EXPORTER_FIND_TAB" }, FindTabResult>({ type: "CHATGPT_EXPORTER_FIND_TAB" });
  if (!tab.ok || tab.tabId === undefined) {
    setStatus(tab.error ?? "No ChatGPT tab was found.", "error");
    return;
  }
  setStatus("ChatGPT tab found. The no-network baseline is healthy.", "ready");
  log.textContent = "Authenticated endpoint adapters remain disabled until token-confinement tests are implemented.";
}

function setStatus(message: string, state: string): void {
  status.textContent = message;
  status.dataset.state = state;
}

function showError(error: unknown): void {
  setStatus(error instanceof Error ? error.message : String(error), "error");
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing dashboard element: ${id}`);
  return value as T;
}
