# ChatGPTExporter

**Unofficial community compatibility fork** of [siraht/ChatGPTExporter](https://github.com/siraht/ChatGPTExporter), updated for current ChatGPT web Project pagination and paginated conversation-history endpoints. This fork is not affiliated with or endorsed by OpenAI.

ChatGPTExporter is a local, resumable browser extension for archiving the ChatGPT web history available to your signed-in account. It inventories main, archived, project, shared, and explicitly selected workspace scopes before downloading conversation graphs, account artifacts, and referenced files.

Authentication stays inside the normal `chatgpt.com` page. The extension never asks for a token or cookie, has no backend or telemetry, and writes only to a directory you choose.

**Private API warning:** This tool uses undocumented ChatGPT web APIs. They change over time and may change again without notice. Review validation reports and raw evidence before relying on an export.

## Compatibility changes

- Project pagination accepts bounded longer cursors, including Base64 characters and a colon where required. Empty cursors terminate normally; safe non-negative numeric cursors are normalized, and requests use URL encoding.
- Conversation capture starts at `/backend-api/conversations/{id}?include_has_versions=true&num_turns=100`, then follows `/backend-api/conversations/{id}/messages?before=...` backward until the provider reports no older page. Legacy full-graph routes remain available when the current route returns 404.
- Backward pagination checks each page for progress, rejects missing or repeated cursors, handles a stable duplicate boundary, and enforces page and byte limits. Raw provider pages are retained as source evidence.
- The initial conversation page must carry at least one recognized identity field, and every field present must match the requested conversation. Older message pages may omit identity fields, but every field they do provide must match. Invalid or conflicting identities fail closed with diagnostics that omit raw IDs and content.
- Existing resume, archive hashing, inventory reconciliation, and independent validation still apply. An incomplete capture is reported as incomplete rather than silently accepted.

The paginated endpoint supplies message pages rather than a full branch graph. The derived mapping represents the ordered messages returned by those pages; the original pages remain in the raw archive for inspection.

These changes follow upstream [PR #2](https://github.com/siraht/ChatGPTExporter/pull/2), [Issue #4](https://github.com/siraht/ChatGPTExporter/issues/4), and [Issue #5](https://github.com/siraht/ChatGPTExporter/issues/5). See [CHANGELOG.md](CHANGELOG.md) for this fork's release notes.

## What it preserves

- Every conversation found by normally terminating main, archived, project, and shared inventory chains.
- Separate histories for every explicitly selected accessible workspace.
- The complete provider graph, including branches and inactive nodes, when supplied by a legacy full-graph route; ordered messages and every raw source page from the paginated route.
- Citations, browsing/tool/code records, Canvas content, completed deep research, unknown future content blocks, and raw provider extensions.
- Uploaded files, generated images, audio, video, inline binaries, research files, and project-level files when ChatGPT permits retrieval.
- Memories, custom instructions, settings, beta-feature settings, and sanitized workspace/session metadata as auxiliary account artifacts.
- Previous local conversations that disappear from a later remote inventory, marked absent rather than deleted.

## Install from source

Requirements are Node.js 20+ and a Chromium browser that supports Manifest V3 and the File System Access API.

```sh
git clone https://github.com/OWNER/ChatGPTExporter.git
cd ChatGPTExporter
npm ci
npm run check
npm run test:e2e
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/extension`. Click the extension icon to open its dashboard.

Replace `OWNER` with the account or organization that publishes this compatibility fork. The upstream repository above is the original project and does not contain these fork changes.

## Export your history

1. Open a normal signed-in `https://chatgpt.com/` tab.
2. In the extension dashboard, find the tab and explicitly select the workspaces to archive.
3. Run preflight, then choose a parent directory. Each workspace receives an isolated `ChatGPTExport-<fingerprint>` directory.
4. Select inventory scopes, build the inventory, review its aggregate counts and termination evidence, and confirm it.
5. Start or resume capture. You can pause before the next request, resume, cancel safely, or rerun to retry incomplete records.
6. Require the final state you need: `complete` means conversations and requested assets passed the independent audit; `conversations complete / assets partial` identifies explicit file exceptions; `incomplete` means the archive is not accepted.
7. Read `reports/validation.md` inside each workspace archive. Use **Revalidate only** to prove local files without contacting ChatGPT.

Do not run multiple exporters against the same account simultaneously. The default 250 ms delay, concurrency 1, and batch size 10 are deliberately conservative.

## Archive and import contract

Raw listing/detail/batch revisions are append-preserving under `source/`; paginated details also retain every provider page in `source_pages`. Normalized JSON, Markdown, indexes, and reports are derived and rebuildable. Completion markers are written last and contain hashes of every required conversation artifact.

The audited directory is directly consumable by the unified Agent Session Archive adapter; it does not need a giant synthesized `conversations.json`:

```sh
asm web-import ./ChatGPTExport-WORKSPACE-FINGERPRINT \
  --provider chatgpt-web --account-label personal --dry-run --json
```

See [Architecture](docs/ARCHITECTURE.md), [web contract](docs/WEB_CONTRACT.md), [privacy model](docs/PRIVACY.md), and [troubleshooting](docs/TROUBLESHOOTING.md) for the operational details.

## Development

```sh
npm test
npm run typecheck
npm run privacy:check
npm run test:e2e
npm run package
```

The project has no runtime dependencies. Playwright, Vitest, TypeScript, and esbuild are development-only. Contributions must use synthetic fixtures and pass the staged privacy scanner; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License and provenance

This fork preserves the original [MIT License](LICENSE) and copyright notice from [siraht/ChatGPTExporter](https://github.com/siraht/ChatGPTExporter). Narrow storage, dashboard, and build primitives in the original project were adapted from GrokExporter, and endpoint/content-shape research was informed by pinned MIT upstream projects. Exact revisions and accepted/rejected ideas are recorded in [UPSTREAM_RESEARCH.md](docs/UPSTREAM_RESEARCH.md).
