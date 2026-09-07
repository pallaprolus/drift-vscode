# Changelog

All notable changes to the Drift extension are documented here.

## [0.6.0] - 2026-09-07

This release completes the original roadmap.

### Added
- **README code block sync**: fenced code blocks in `README.md` and `docs/**/*.md` are checked against real code for renamed symbols, stale example signatures, wrong argument counts, and functions that no longer exist. Configure with `drift.scanMarkdown` and `drift.markdownPatterns`.
- **Git change tracking**: uses `git blame` and the working-tree diff to flag uncommitted code edits whose docs were not touched, and documentation that is older than the code by more than `drift.git.staleDays`. Toggle with `drift.git.enabled`.
- **AI semantic checks** (on demand): an **AI Check** CodeLens and two commands ask a model whether the documentation still describes the code. Works with the VS Code Language Model API (e.g. GitHub Copilot) or the Anthropic API via `Drift: Set Anthropic API Key`. Configure with `drift.ai.provider` and `drift.ai.model`. Nothing is ever sent automatically.
- **Export reports**: `Drift: Export Report` writes Markdown, self-contained HTML, or JSON. Also available from the dashboard toolbar.
- CodeLens now appears for Go, Rust, and Java files.
- `npm run test:unit` for the fast unit test suite.

### Changed
- Minimum VS Code version is now 1.90 (required for the Language Model API).
- Default `drift.supportedLanguages` now lists every language Drift can parse.
- Runtime dependencies are bundled with esbuild, so the extension package no longer ships `node_modules`.

### Fixed
- Lint errors across the codebase; the build now runs lint as part of `npm test`.

## [0.5.1] - 2025-12-12
- Handle multi-line signatures correctly.

## [0.5.0] - 2025-12-11
- Add NumPy docstring support.

## [0.4.0] - 2025-12-10
- Quick Fixes for missing and stale parameters.

## [0.3.0] - 2025-12-09
- Add Go, Rust, and Java support.

## [0.2.0] - 2025-12-02
- Initial release.
