# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versioning follows semver.

## [0.2.0] - 2026-08-23

### Added

- Multi-room homes: Home/Room sidebar tabs, home templates (studio / 1br / 2br),
  top-down HomeEditor (drag & resize rooms), room list with add/remove,
  interior open-ups (打通) and balcony parapets
- Optional local AI via your own codex CLI: floor-plan import (Home tab) and
  photoreal AI repaint with style presets, swipe compare and history —
  local-only by design, gracefully badged on the online demo
- Pan interactions: right-drag / Shift+left-drag / TopBar pan-mode toggle
- `npm run doctor` environment preflight, `npm run scan:public` leak scan (CI),
  INSTALL.md agent runbook

### Changed

- persist `openhome3d` v1 → v2 (pass-through migrate — existing rooms,
  furniture and seeds survive)
- audit:ui now covers 14 states × 2 viewports; smoke suite is 205 checks

### Fixed

- Camera follow no longer pulls the orbit target back after a user pan

## [0.1.0] - 2026-08-03

Initial open-source release: single-room cartoon home designer, fully
client-side.
