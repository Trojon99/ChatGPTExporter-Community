[English](README.md) | [简体中文](README.zh-CN.md)

# ChatGPTExporter Community

**Unofficial community compatibility fork** of [siraht/ChatGPTExporter](https://github.com/siraht/ChatGPTExporter), updated for current ChatGPT web Project pagination and paginated conversation-history endpoints. This fork is not affiliated with or endorsed by OpenAI.

ChatGPTExporter Community is a privacy-first, local Chromium extension for ChatGPT conversation export and history backup. It inventories main and archived conversations, Projects, and shared chats in workspaces you explicitly select, then captures available conversation content, account artifacts, files, and attachments. It supports accessible personal and ChatGPT Business/Team workspaces as separate local archives.

Authentication stays inside the normal `chatgpt.com` page. The extension never asks for a token or cookie, has no backend or telemetry, and writes only to a directory you choose.

**Private API warning:** This tool uses undocumented ChatGPT web APIs. They change over time and may change again without notice. Review validation reports and raw evidence before relying on a ChatGPT backup or migration.

## Why this fork exists

Upstream `0.1.6` was affected by changes in current ChatGPT web behavior: real-world Project pagination cursors can be longer and contain Base64 characters; conversation history now uses paginated plural endpoints; long histories require backward pagination; and older message pages may legitimately omit conversation identity fields. This fork adapts to those response shapes while preserving strict initial-page identity checks and fail-closed validation. It does not simply remove identity validation.

The changes relate to upstream [PR #2](https://github.com/siraht/ChatGPTExporter/pull/2), [Issue #4](https://github.com/siraht/ChatGPTExporter/issues/4), and [Issue #5](https://github.com/siraht/ChatGPTExporter/issues/5). The fork has been validated against a real ChatGPT Business workspace containing hundreds of conversations and multiple Projects. Conversation capture and local validation completed successfully. No private workspace identifiers or content are included here.

## Compatibility changes

- Project pagination accepts bounded longer cursors, including Base64 characters and a colon where required. Empty cursors terminate normally; safe non-negative numeric cursors are normalized, and requests use URL encoding.
- Conversation capture starts at `/backend-api/conversations/{id}?include_has_versions=true&num_turns=100`, then follows `/backend-api/conversations/{id}/messages?before=...` backward until the provider reports no older page. Legacy full-graph routes remain available when the current route returns 404.
- Backward pagination checks each page for progress, rejects missing or repeated cursors, handles a stable duplicate boundary, and enforces page and byte limits. Raw provider pages are retained as source evidence.
- The initial conversation page must carry at least one recognized identity field, and every field present must match the requested conversation. Older message pages may omit identity fields, but every field they do provide must match. Invalid or conflicting identities fail closed with diagnostics that omit raw IDs and content.
- Existing resume, archive hashing, inventory reconciliation, and independent validation still apply. An incomplete capture is reported as incomplete rather than silently accepted.

The paginated endpoint supplies message pages rather than a full branch graph. The derived mapping represents the ordered messages returned by those pages; the original pages remain in the raw archive for inspection.

See [CHANGELOG.md](CHANGELOG.md) for this fork's release notes.

## What it preserves

- Every conversation found by normally terminating main, archived, project, and shared inventory chains.
- Separate histories for every explicitly selected accessible personal or Business/Team workspace. This supports ChatGPT Business export without mixing workspaces.
- The complete provider graph, including branches and inactive nodes, when supplied by a legacy full-graph route; ordered messages and every raw source page from the paginated route.
- Citations, browsing/tool/code records, Canvas content, completed deep research, unknown future content blocks, and raw provider extensions.
- Uploaded files, generated images, audio, video, inline binaries, research files, and project-level files when ChatGPT permits retrieval.
- Account artifacts such as ChatGPT memories, custom instructions, settings, and beta features are captured when the corresponding current ChatGPT web endpoint is available. Availability may vary by workspace or plan; sanitized workspace/session metadata is recorded separately.
- Previous local conversations that disappear from a later remote inventory, marked absent rather than deleted.

## Install from source

Requirements are Node.js 20+ and a Chromium browser that supports Manifest V3 and the File System Access API.

```sh
git clone https://github.com/Trojon99/ChatGPTExporter-Community.git
cd ChatGPTExporter-Community
npm ci
npm run check
npm run test:e2e
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/extension`. Click the extension icon to open its dashboard.

## Export your history

1. Open a normal signed-in `https://chatgpt.com/` tab.
2. In the extension dashboard, find the tab and explicitly select the workspaces to archive.
3. Run preflight, then choose a parent directory. Each workspace receives an isolated `ChatGPTExport-<fingerprint>` directory.
4. Select inventory scopes, build the inventory, review its aggregate counts and termination evidence, and confirm it.
5. Start or resume capture. You can pause before the next request, resume, cancel safely, or rerun to retry incomplete records.
6. Require the final state you need: `complete` means conversations and requested assets passed the independent audit; `conversations complete / assets partial` identifies explicit file exceptions; `incomplete` means the archive is not accepted.
7. Read `reports/validation.md` inside each workspace archive. Use **Revalidate only** to prove local files without contacting ChatGPT.

Do not run multiple exporters against the same account simultaneously. The default 250 ms delay, concurrency 1, and batch size 10 are deliberately conservative.

## Security model and known limitations

- The extension requests only `https://chatgpt.com/*` host access. Authenticated requests run in the existing ChatGPT page; tokens and signed asset URLs stay there. Asset hosts and redirects are validated before local download. There is no backend, telemetry, analytics, or remote archive upload.
- The archive contains sensitive conversations, memories, titles, file names, and attachments. Keep the selected local directory private. Do not attach raw archives or validation reports to public issues without reviewing them.
- The exporter can capture only content the signed-in workspace can access through the current web endpoints. Temporary, deleted, inaccessible, or unavailable content cannot be reconstructed. Some legacy or unavailable asset references may return HTTP 404 even when conversation content is complete; validation reports the asset scope as partial.
- Current paginated responses supply ordered messages rather than a full branch graph. The derived mapping is a linear representation; every provider page is retained as raw evidence. A changed endpoint, malformed page, repeated cursor, or configured page/byte limit produces an explicit incomplete result instead of silent truncation.

## Local archive and validation

Raw listing/detail/batch revisions are append-preserving under `source/`; paginated details also retain every provider page in `source_pages`. Normalized JSON, Markdown, indexes, and reports are derived and rebuildable. Completion markers are written last and contain hashes of every required conversation artifact.

See [Architecture](docs/ARCHITECTURE.md), [web contract](docs/WEB_CONTRACT.md), [privacy model](docs/PRIVACY.md), and [troubleshooting](docs/TROUBLESHOOTING.md) for the operational details.

## Optional advanced integration

ChatGPTExporter works independently: no other tool is needed to export or validate its local archives. `asm` / Agent Session Archive is a separate external project, relevant only if you choose a later migration or import workflow. It is not bundled with or required by this extension.

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
