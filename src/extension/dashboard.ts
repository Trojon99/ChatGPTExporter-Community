import { ChatGptClient, type DiscoveredWorkspace } from "../chatgpt/client";
import { ensureDirectoryPermission, loadDirectoryHandle, saveDirectoryHandle } from "./handle-store";
import { BridgeResponseError, RuntimeApiTransport, type FindTabResult } from "./protocol";

const chooseButton = element<HTMLButtonElement>("choose-directory");
const openButton = element<HTMLButtonElement>("open-chatgpt");
const findButton = element<HTMLButtonElement>("find-chatgpt");
const preflightButton = element<HTMLButtonElement>("preflight-workspace");
const workspaceSelect = element<HTMLSelectElement>("workspace-select");
const directoryLabel = element<HTMLElement>("directory-label");
const status = element<HTMLElement>("status");
const log = element<HTMLElement>("log");

let directoryHandle: FileSystemDirectoryHandle | undefined;
let client: ChatGptClient | undefined;
let workspaces: DiscoveredWorkspace[] = [];
let verifiedWorkspace: DiscoveredWorkspace | undefined;

chooseButton.addEventListener("click", () => void chooseDirectory());
openButton.addEventListener("click", () => void chrome.tabs.create({ url: "https://chatgpt.com/" }));
findButton.addEventListener("click", () => void findTabAndWorkspaces());
preflightButton.addEventListener("click", () => void preflightWorkspace());
workspaceSelect.addEventListener("change", () => {
  verifiedWorkspace = undefined;
  chooseButton.disabled = true;
  preflightButton.disabled = workspaceSelect.value === "";
  directoryLabel.textContent = workspaceSelect.value ? "Verify this workspace first" : "Select a workspace first";
});
void restoreDirectory();

async function restoreDirectory(): Promise<void> {
  directoryHandle = await loadDirectoryHandle();
}

async function chooseDirectory(): Promise<void> {
  if (!verifiedWorkspace) {
    setStatus("Verify a workspace before choosing its archive directory.", "error");
    return;
  }
  try {
    const selectedHandle = await window.showDirectoryPicker({ id: `chatgpt-exporter-${verifiedWorkspace.workspaceFingerprint}`, mode: "readwrite" });
    directoryHandle = selectedHandle;
    await saveDirectoryHandle(selectedHandle);
    directoryLabel.textContent = selectedHandle.name;
    setStatus("Workspace and archive directory are ready for inventory.", "ready");
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) showError(error);
  }
}

async function findTabAndWorkspaces(): Promise<void> {
  setBusy(findButton, true);
  resetWorkspaceSelection();
  setStatus("Checking the signed-in ChatGPT session and accessible workspaces…", "busy");
  try {
    const tab = await chrome.runtime.sendMessage<{ type: "CHATGPT_EXPORTER_FIND_TAB" }, FindTabResult>({ type: "CHATGPT_EXPORTER_FIND_TAB" });
    if (!tab.ok || tab.tabId === undefined) throw new Error(tab.error ?? "No ChatGPT tab was found.");
    client = new ChatGptClient(new RuntimeApiTransport(tab.tabId));
    workspaces = (await client.discoverWorkspaces()).filter((workspace) => !workspace.deactivated);
    if (workspaces.length === 0) throw new Error("ChatGPT returned no active accessible workspaces.");
    renderWorkspaces(workspaces);
    setStatus(`Found ${workspaces.length} accessible workspace${workspaces.length === 1 ? "" : "s"}. Select one explicitly.`, "ready");
    log.textContent = "Only sanitized workspace labels are shown. Account identifiers will be hashed before any directory or report name is written.";
  } catch (error) {
    showError(error);
  } finally {
    setBusy(findButton, false);
  }
}

async function preflightWorkspace(): Promise<void> {
  const workspace = workspaces.find((candidate) => candidate.workspaceFingerprint === workspaceSelect.value);
  if (!client || !workspace) {
    setStatus("Choose an accessible workspace first.", "error");
    return;
  }
  setBusy(preflightButton, true);
  setStatus("Verifying session, workspace access, and conversation listing…", "busy");
  try {
    const result = await client.preflight(workspace);
    verifiedWorkspace = result.workspace;
    chooseButton.disabled = false;
    const conversationState = result.recognizedEmptyAccount ? "a recognized empty conversation history" : "an accessible conversation sample";
    setStatus(`Workspace verified with ${conversationState}. Choose its archive directory.`, "ready");
    if (directoryHandle && await ensureDirectoryPermission(directoryHandle, false)) {
      directoryLabel.textContent = `${directoryHandle.name} (previous selection; choose again to confirm for this workspace)`;
    } else {
      directoryLabel.textContent = "No directory selected for this workspace";
    }
    log.textContent = `Preflight passed for workspace ${workspace.workspaceFingerprint.slice(0, 12)}…. No access token or raw account identifier crossed into this dashboard.`;
  } catch (error) {
    verifiedWorkspace = undefined;
    chooseButton.disabled = true;
    if (error instanceof BridgeResponseError && error.code === "AUTHENTICATION_REQUIRED") {
      setStatus("ChatGPT sign-in expired. Sign in or refresh the ChatGPT tab, then find it again.", "error");
    } else if (error instanceof BridgeResponseError && error.code === "RATE_LIMITED") {
      const wait = error.retryAfterMs === undefined ? "the server's cooldown" : `${Math.ceil(error.retryAfterMs / 1_000)} seconds`;
      setStatus(`ChatGPT rate-limited preflight. Wait ${wait}, then verify again.`, "error");
    } else {
      showError(error);
    }
  } finally {
    setBusy(preflightButton, false);
  }
}

function renderWorkspaces(values: DiscoveredWorkspace[]): void {
  workspaceSelect.replaceChildren(option("", "Choose a workspace…"));
  for (const workspace of values) {
    workspaceSelect.append(option(workspace.workspaceFingerprint, `${workspace.label} · ${workspace.kind}`));
  }
  workspaceSelect.disabled = false;
  preflightButton.disabled = true;
}

function resetWorkspaceSelection(): void {
  workspaces = [];
  client = undefined;
  verifiedWorkspace = undefined;
  workspaceSelect.replaceChildren(option("", "Checking ChatGPT…"));
  workspaceSelect.disabled = true;
  preflightButton.disabled = true;
  chooseButton.disabled = true;
  directoryLabel.textContent = "Verify a workspace first";
}

function option(value: string, text: string): HTMLOptionElement {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = text;
  return item;
}

function setBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
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
