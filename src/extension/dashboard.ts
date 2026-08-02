import { ChatGptClient, type DiscoveredWorkspace } from "../chatgpt/client";
import { DirectoryArchiveFileSystem } from "../core/filesystem";
import { DEFAULT_INVENTORY_SETTINGS, runWorkspaceInventories } from "../chatgpt/inventory";
import { ChatGptCaptureEngine } from "../chatgpt/capture-engine";
import { ensureDirectoryPermission, loadDirectoryHandle, saveDirectoryHandle } from "./handle-store";
import { BridgeResponseError, RuntimeApiTransport, type FindTabResult } from "./protocol";

const chooseButton = element<HTMLButtonElement>("choose-directory");
const openButton = element<HTMLButtonElement>("open-chatgpt");
const findButton = element<HTMLButtonElement>("find-chatgpt");
const preflightButton = element<HTMLButtonElement>("preflight-workspace");
const inventoryButton = element<HTMLButtonElement>("run-inventory");
const captureButton = element<HTMLButtonElement>("run-capture");
const workspaceSelect = element<HTMLSelectElement>("workspace-select");
const archivedScope = element<HTMLInputElement>("scope-archived");
const projectScope = element<HTMLInputElement>("scope-projects");
const sharedScope = element<HTMLInputElement>("scope-shared");
const directoryLabel = element<HTMLElement>("directory-label");
const status = element<HTMLElement>("status");
const log = element<HTMLElement>("log");

let directoryHandle: FileSystemDirectoryHandle | undefined;
let client: ChatGptClient | undefined;
let runtimeTransport: RuntimeApiTransport | undefined;
let workspaces: DiscoveredWorkspace[] = [];
let verifiedWorkspaces: DiscoveredWorkspace[] = [];

chooseButton.addEventListener("click", () => void chooseDirectory());
openButton.addEventListener("click", () => void chrome.tabs.create({ url: "https://chatgpt.com/" }));
findButton.addEventListener("click", () => void findTabAndWorkspaces());
preflightButton.addEventListener("click", () => void preflightWorkspace());
inventoryButton.addEventListener("click", () => void runInventory());
captureButton.addEventListener("click", () => void runCapture());
workspaceSelect.addEventListener("change", () => {
  verifiedWorkspaces = [];
  chooseButton.disabled = true;
  inventoryButton.disabled = true;
  captureButton.disabled = true;
  preflightButton.disabled = workspaceSelect.selectedOptions.length === 0;
  directoryLabel.textContent = workspaceSelect.selectedOptions.length ? "Verify selected workspaces first" : "Select one or more workspaces first";
});
void restoreDirectory();

async function restoreDirectory(): Promise<void> {
  directoryHandle = await loadDirectoryHandle();
}

async function chooseDirectory(): Promise<void> {
  if (verifiedWorkspaces.length === 0) {
    setStatus("Verify one or more workspaces before choosing their parent archive directory.", "error");
    return;
  }
  try {
    const selectedHandle = await window.showDirectoryPicker({ id: "chatgpt-exporter-parent", mode: "readwrite" });
    directoryHandle = selectedHandle;
    await saveDirectoryHandle(selectedHandle);
    directoryLabel.textContent = selectedHandle.name;
    inventoryButton.disabled = false;
    captureButton.disabled = true;
    setStatus(`${verifiedWorkspaces.length} workspace${verifiedWorkspaces.length === 1 ? " is" : "s are"} ready for isolated inventory directories.`, "ready");
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
    runtimeTransport = new RuntimeApiTransport(tab.tabId);
    client = new ChatGptClient(runtimeTransport);
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
  const selectedFingerprints = new Set([...workspaceSelect.selectedOptions].map((item) => item.value));
  const selected = workspaces.filter((candidate) => selectedFingerprints.has(candidate.workspaceFingerprint));
  if (!client || selected.length === 0) {
    setStatus("Choose one or more accessible workspaces first.", "error");
    return;
  }
  setBusy(preflightButton, true);
  setStatus("Verifying session, workspace access, and conversation listing…", "busy");
  try {
    const verified: DiscoveredWorkspace[] = [];
    let emptyCount = 0;
    for (const workspace of selected) {
      const result = await client.preflight(workspace);
      verified.push(result.workspace);
      if (result.recognizedEmptyAccount) emptyCount += 1;
    }
    verifiedWorkspaces = verified;
    chooseButton.disabled = false;
    inventoryButton.disabled = true;
    captureButton.disabled = true;
    setStatus(`Verified ${verified.length} selected workspace${verified.length === 1 ? "" : "s"}${emptyCount ? ` (${emptyCount} empty)` : ""}. Choose their parent archive directory.`, "ready");
    if (directoryHandle && await ensureDirectoryPermission(directoryHandle, false)) {
      directoryLabel.textContent = `${directoryHandle.name} (previous selection; choose again to confirm for this workspace)`;
    } else {
      directoryLabel.textContent = "No directory selected for this workspace";
    }
    log.textContent = `Preflight passed for ${verified.length} workspace fingerprint${verified.length === 1 ? "" : "s"}. Each archive will use ChatGPTExport-<fingerprint>; no raw account identifier is written.`;
  } catch (error) {
    verifiedWorkspaces = [];
    chooseButton.disabled = true;
    inventoryButton.disabled = true;
    captureButton.disabled = true;
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
  runtimeTransport = undefined;
  verifiedWorkspaces = [];
  workspaceSelect.replaceChildren(option("", "Checking ChatGPT…"));
  workspaceSelect.disabled = true;
  preflightButton.disabled = true;
  chooseButton.disabled = true;
  inventoryButton.disabled = true;
  captureButton.disabled = true;
  directoryLabel.textContent = "Verify a workspace first";
}

async function runInventory(): Promise<void> {
  if (verifiedWorkspaces.length === 0 || !directoryHandle || !runtimeTransport) {
    setStatus("Verify selected workspaces and choose their parent archive directory first.", "error");
    return;
  }
  if (!await ensureDirectoryPermission(directoryHandle, true)) {
    setStatus("Write permission for the archive directory is required.", "error");
    return;
  }
  setBusy(inventoryButton, true);
  chooseButton.disabled = true;
  workspaceSelect.disabled = true;
  preflightButton.disabled = true;
  setStatus("Building complete inventory; conversation bodies are not being downloaded yet…", "busy");
  try {
    const targets = await Promise.all(verifiedWorkspaces.map(async (workspace) => ({
      workspace,
      filesystem: new DirectoryArchiveFileSystem(await directoryHandle!.getDirectoryHandle(`ChatGPTExport-${workspace.workspaceFingerprint}`, { create: true })),
    })));
    const inventories = await runWorkspaceInventories({
      transport: runtimeTransport,
      targets,
      settings: {
        ...DEFAULT_INVENTORY_SETTINGS,
        includeArchived: archivedScope.checked,
        includeProjects: projectScope.checked,
        includeShared: sharedScope.checked,
      },
      onProgress: (workspaceFingerprint, progress) => {
        setStatus(`Inventorying ${workspaceFingerprint.slice(0, 8)}… / ${progress.chainId}, page ${progress.pageNumber}; ${progress.uniqueConversations} unique conversations found…`, "busy");
      },
    });
    const conversationCount = [...inventories.values()].reduce((sum, inventory) => sum + inventory.conversations.length, 0);
    const pageCount = [...inventories.values()].reduce((sum, inventory) => sum + inventory.pages.length, 0);
    setStatus(`Inventory complete: ${conversationCount} workspace-scoped conversations across ${inventories.size} isolated archives.`, "ready");
    log.textContent = `Published each inventory and reconciliation report after ${pageCount} raw page artifacts were written. Conversation capture is ready.`;
    captureButton.disabled = false;
  } catch (error) {
    showError(error);
  } finally {
    inventoryButton.disabled = false;
    chooseButton.disabled = false;
    workspaceSelect.disabled = false;
    preflightButton.disabled = false;
  }
}

async function runCapture(): Promise<void> {
  if (verifiedWorkspaces.length === 0 || !directoryHandle || !runtimeTransport) {
    setStatus("Complete workspace preflight, destination selection, and inventory first.", "error");
    return;
  }
  if (!await ensureDirectoryPermission(directoryHandle, true)) {
    setStatus("Write permission for the archive directory is required.", "error");
    return;
  }
  setBusy(captureButton, true);
  inventoryButton.disabled = true;
  chooseButton.disabled = true;
  workspaceSelect.disabled = true;
  preflightButton.disabled = true;
  let captured = 0;
  let rebuilt = 0;
  let skipped = 0;
  try {
    for (const workspace of verifiedWorkspaces) {
      const archive = await directoryHandle.getDirectoryHandle(`ChatGPTExport-${workspace.workspaceFingerprint}`, { create: true });
      const runId = `capture-${Date.now()}-${crypto.randomUUID()}`;
      const result = await new ChatGptCaptureEngine({
        transport: runtimeTransport,
        filesystem: new DirectoryArchiveFileSystem(archive),
        workspace,
        runId,
        onProgress: (progress) => {
          setStatus(`Capturing ${workspace.workspaceFingerprint.slice(0, 8)}…: ${progress.completed}/${progress.total} complete (${progress.phase})…`, "busy");
        },
      }).run();
      captured += result.capturedCount;
      rebuilt += result.rebuiltCount;
      skipped += result.skippedCount;
    }
    setStatus(`Conversation capture complete: ${captured} fetched, ${rebuilt} rebuilt from raw, ${skipped} unchanged.`, "ready");
    log.textContent = "Every inventory record has a hash-validated completion marker. Referenced asset download is the next implementation gate.";
  } catch (error) {
    showError(error);
  } finally {
    captureButton.disabled = false;
    inventoryButton.disabled = false;
    chooseButton.disabled = false;
    workspaceSelect.disabled = false;
    preflightButton.disabled = false;
  }
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
