// Adapted from GrokExporter commit 85922d6; this baseline proves tab discovery and deny-by-default transport.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

await import("./build.mjs");
const root = process.cwd();
const extensionPath = path.join(root, "dist", "extension");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-exporter-e2e-"));
const certificatePath = path.join(temporaryRoot, "certificate.pem");
const keyPath = path.join(temporaryRoot, "key.pem");
execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-nodes",
  "-keyout", keyPath,
  "-out", certificatePath,
  "-subj", "/CN=chatgpt.com",
  "-addext", "subjectAltName=DNS:chatgpt.com",
  "-days", "1",
], { stdio: "ignore" });

const server = https.createServer({
  key: await readFile(keyPath),
  cert: await readFile(certificatePath),
}, (_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end("<!doctype html><title>Synthetic ChatGPT</title><main>Fixture</main>");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Synthetic ChatGPT server did not expose a TCP port.");

let context;
try {
  const chromeExecutable = await findChromeExecutable();
  if (!chromeExecutable) {
    throw new Error("Chromium executable not found; run `npx playwright install chromium` or set CHATGPT_EXPORTER_CHROME.");
  }
  context = await chromium.launchPersistentContext(path.join(temporaryRoot, "profile"), {
    executablePath: chromeExecutable,
    headless: true,
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--host-resolver-rules=MAP chatgpt.com 127.0.0.1",
      "--ignore-certificate-errors",
      "--no-proxy-server",
    ],
  });
  const chatgptPage = await context.newPage();
  await chatgptPage.goto(`https://chatgpt.com:${address.port}/`, { waitUntil: "domcontentloaded" });

  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  const dashboard = await context.newPage();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`);

  const tab = await dashboard.evaluate(async () => chrome.runtime.sendMessage({ type: "CHATGPT_EXPORTER_FIND_TAB" }));
  assert(tab.ok && Number.isInteger(tab.tabId), "Service worker did not discover the synthetic ChatGPT tab.");

  const rejected = await dashboard.evaluate(async ({ tabId }) => chrome.runtime.sendMessage({
    type: "CHATGPT_EXPORTER_API_REQUEST",
    tabId,
    request: {
      requestId: "rejected-request",
      protocolVersion: 1,
      operation: "unimplemented",
      path: "https://evil.example/private",
      method: "GET",
      timeoutMs: 10_000,
    },
  }), { tabId: tab.tabId });
  assert(!rejected.ok && rejected.error?.code === "ENDPOINTS_NOT_IMPLEMENTED", "Baseline transport did not fail closed.");
  console.log("Chromium no-network extension baseline passed.");
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function findChromeExecutable() {
  const candidates = [process.env.CHATGPT_EXPORTER_CHROME, chromium.executablePath()];
  const cacheRoot = path.join(os.homedir(), ".cache", "ms-playwright");
  try {
    const installs = (await readdir(cacheRoot))
      .filter((entry) => entry.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const install of installs) {
      candidates.push(path.join(cacheRoot, install, "chrome-linux64", "chrome"));
    }
  } catch {
    // A fresh checkout may not have a Playwright cache yet.
  }
  candidates.push("/usr/bin/chromium", "/usr/bin/google-chrome");
  return candidates.find((candidate) => candidate && existsSync(candidate));
}
