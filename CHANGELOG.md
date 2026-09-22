# Changelog

This changelog covers the unofficial community compatibility fork of [siraht/ChatGPTExporter](https://github.com/siraht/ChatGPTExporter). It is not an upstream-maintained release.

This fork uses its own calendar-based version line (`year.month.release`) to distinguish community releases from upstream versions. The Git tag for this release is `v2026.09.1`; tooling uses the equivalent numeric package version `2026.9.1`.

## 2026.09.1 — 2026-09-22

First independent community-fork release, based on upstream `0.1.6`.

- Accept longer bounded Project pagination cursors, including Base64 characters, colon, empty termination, and safe non-negative numeric cursors. Encode cursors in request URLs. This addresses the behavior described in upstream [PR #2](https://github.com/siraht/ChatGPTExporter/pull/2) and [Issue #4](https://github.com/siraht/ChatGPTExporter/issues/4).
- Retrieve conversations through the current plural conversation endpoint and older `/messages?before=` pages described in upstream [Issue #5](https://github.com/siraht/ChatGPTExporter/issues/5).
- Follow backward pagination to completion for long conversations, with cursor, progress, duplicate-boundary, page-count, and byte-limit checks. Preserve every raw page as evidence.
- Accept older message pages without an identity field while rejecting any mismatching identity that is present. Continue to require a matching recognized identity on the initial page.
- Add unit, integration, and packaged-extension coverage for the compatibility paths, including sanitized diagnostics and legacy-route fallback. Publish complete English and Simplified Chinese READMEs.

This tool uses undocumented/private ChatGPT web APIs, which may change without notice. The original MIT License and copyright notice are retained in [LICENSE](LICENSE).
