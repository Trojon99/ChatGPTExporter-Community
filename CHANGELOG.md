# Changelog

This changelog covers the unofficial community compatibility fork of [siraht/ChatGPTExporter](https://github.com/siraht/ChatGPTExporter). It is not an upstream-maintained release.

## 0.1.6-compat.1 — 2026-09-22

- Accept longer bounded Project pagination cursors, including Base64 characters, colon, empty termination, and safe non-negative numeric cursors. Encode cursors in request URLs. This addresses the behavior described in upstream [PR #2](https://github.com/siraht/ChatGPTExporter/pull/2) and [Issue #4](https://github.com/siraht/ChatGPTExporter/issues/4).
- Retrieve conversations through the current plural conversation endpoint and older `/messages?before=` pages described in upstream [Issue #5](https://github.com/siraht/ChatGPTExporter/issues/5).
- Follow backward pagination to completion for long conversations, with cursor, progress, duplicate-boundary, page-count, and byte-limit checks. Preserve every raw page as evidence.
- Accept older message pages without an identity field while rejecting any mismatching identity that is present. Continue to require a matching recognized identity on the initial page.
- Add unit, integration, and packaged-extension coverage for the compatibility paths, including sanitized diagnostics and legacy-route fallback.

This tool uses undocumented/private ChatGPT web APIs, which may change without notice. The original MIT License and copyright notice are retained in [LICENSE](LICENSE).
