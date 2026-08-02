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
}, (request, response) => {
  const requestUrl = new URL(request.url ?? "/", "https://chatgpt.com");
  if (requestUrl.pathname === "/api/auth/session") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ accessToken: "synthetic-page-local-secret", expires: "2099-01-01T00:00:00.000Z" }));
    return;
  }
  if (requestUrl.pathname === "/backend-api/conversations") {
    if (requestUrl.searchParams.get("offset") === "42") {
      response.writeHead(429, { "Content-Type": "application/json", "Retry-After": "2" });
      response.end(JSON.stringify({ private_fixture_body: "must-not-cross-error-boundary" }));
      return;
    }
    const authorized = request.headers.authorization === "Bearer synthetic-page-local-secret"
      && request.headers["x-authorization"] === "Bearer synthetic-page-local-secret";
    response.writeHead(authorized ? 200 : 401, { "Content-Type": "application/json" });
    response.end(JSON.stringify(authorized ? {
      items: [{ id: "conversation-1", title: "Synthetic", create_time: 1, update_time: 2 }],
      total: 1,
      offset: 0,
      limit: 1,
    } : { error: "fixture rejected request" }));
    return;
  }
  if (requestUrl.pathname === "/backend-api/accounts/check/v4-2023-04-27") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      accounts: {
        synthetic: {
          account: { account_id: "account-1", account_name: "Synthetic workspace", account_plan: "business" },
          structure: "workspace",
          is_deactivated: false,
        },
      },
    }));
    return;
  }
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

  const sessionProbe = await dashboard.evaluate(async ({ tabId }) => chrome.runtime.sendMessage({
    type: "CHATGPT_EXPORTER_API_REQUEST",
    tabId,
    request: {
      requestId: "session-probe",
      protocolVersion: 1,
      workspaceId: null,
      operation: "session_probe",
      parameters: {},
      timeoutMs: 10_000,
    },
  }), { tabId: tab.tabId });
  assert(sessionProbe.ok && sessionProbe.body?.authenticated, `Page-local session probe failed: ${JSON.stringify(sessionProbe)}`);
  assert(!JSON.stringify(sessionProbe).includes("synthetic-page-local-secret"), "Session token crossed the page-world bridge.");

  const listing = await dashboard.evaluate(async ({ tabId }) => chrome.runtime.sendMessage({
    type: "CHATGPT_EXPORTER_API_REQUEST",
    tabId,
    request: {
      requestId: "conversation-page",
      protocolVersion: 1,
      workspaceId: null,
      operation: "conversation_page",
      parameters: { offset: 0, limit: 1, archived: false },
      timeoutMs: 10_000,
    },
  }), { tabId: tab.tabId });
  assert(listing.ok && listing.body?.items?.[0]?.id === "conversation-1", `Authenticated listing failed: ${JSON.stringify(listing)}`);
  assert(!JSON.stringify(listing).includes("synthetic-page-local-secret"), "Authorization token crossed the page-world bridge.");

  const rejected = await dashboard.evaluate(async ({ tabId }) => chrome.runtime.sendMessage({
    type: "CHATGPT_EXPORTER_API_REQUEST",
    tabId,
    request: {
      requestId: "rejected-request",
      protocolVersion: 1,
      workspaceId: null,
      operation: "conversation_detail",
      parameters: { conversationId: "../../private", url: "https://evil.example/private" },
      timeoutMs: 10_000,
    },
  }), { tabId: tab.tabId });
  assert(!rejected.ok && rejected.error?.code === "INVALID_BRIDGE_REQUEST", "Typed transport did not fail closed.");

  const rateLimited = await dashboard.evaluate(async ({ tabId }) => chrome.runtime.sendMessage({
    type: "CHATGPT_EXPORTER_API_REQUEST",
    tabId,
    request: {
      requestId: "rate-limited-request",
      protocolVersion: 1,
      workspaceId: null,
      operation: "conversation_page",
      parameters: { offset: 42, limit: 1, archived: false },
      timeoutMs: 10_000,
    },
  }), { tabId: tab.tabId });
  assert(!rateLimited.ok && rateLimited.error?.code === "RATE_LIMITED" && rateLimited.error?.retryAfterMs === 2_000, "Rate-limit metadata was not preserved.");
  assert(!JSON.stringify(rateLimited).includes("must-not-cross-error-boundary"), "HTTP error response body crossed the redacted bridge boundary.");

  await dashboard.locator("#find-chatgpt").click();
  await dashboard.locator("#workspace-select:not([disabled])").waitFor();
  assert(await dashboard.locator("#workspace-select option").count() === 2, "Dashboard did not render explicit workspace selection.");
  await dashboard.locator("#workspace-select").selectOption({ index: 1 });
  await dashboard.locator("#preflight-workspace").click();
  await dashboard.locator("#choose-directory:not([disabled])").waitFor();
  assert((await dashboard.locator("#status").textContent())?.includes("Verified 1 selected workspace"), "Dashboard preflight did not reach the verified state.");
  console.log("Chromium page-local authentication and allowlisted bridge test passed.");
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
