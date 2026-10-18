# Changelog

All notable changes to PagePulse are documented in this file.

## 1.1.1

### Security

- **DNS pinning** — webpage fetches now connect only to addresses validated by the SSRF guard (custom DNS lookup), closing the DNS-rebinding TOCTOU window between resolve and connect. Regression test stubs system DNS to a private IP and asserts the pin is used.
- **IPv4-mapped IPv6** — `::ffff:7f00:1`-style addresses are decoded and blocked as private when appropriate.
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Resource-Policy`, and a restrictive `Content-Security-Policy` on all responses.
- **`Accept-Encoding: identity`** — raw HTTP client requests uncompressed bodies (no silent gzip).

### Fixed

- **Stuck `checking` monitors** — monitors left in `checking` after a crash/restart (or a hung check) are recovered on startup and by the scheduler so they are not skipped forever.
- **Timezone-safe recovery** — age is compared in SQLite (`datetime('now', …)`), not via `Date.parse` on zone-less UTC strings.
- **Live-check protection** — recovery skips monitors with an in-flight `runCheck` in this process.
- **Hard total fetch deadline** — per-hop timeout covers connect + headers + body (not socket idle only); slow-drip responses time out.
- **`alertsCreated` count** — now counts unique notifications only (duplicate value changes no longer inflate the counter).

### Added

- **Quiet report** — when a check finds page changes but creates no alert, the API and monitor detail UI show evidence-backed “Why no alert?” items (cosmetic vs off-intent), matching PagePulse’s evidence-first contract.
- Regression tests for SSRF pinning under rebinding, mapped IPv6, security headers, TZ-safe stuck-check recovery, live-check skip, hard fetch deadline, and quiet reports.

## 1.1.0

### Added

- **Guided Demo** — recruiter-friendly walkthrough on the fictional Transfer GPA lab page. Creates a real monitor, saves a 3.20 baseline, applies equivalent rewording (no alert), applies an unrelated deadline/footer change (ignored), then applies a 3.20 → 3.40 GPA change and produces an evidence-backed alert using the live monitoring pipeline.
- **Monitor health presentation** — clearer statuses including Healthy, Due soon, Checking, Meaningful change detected, No relevant change, Blocked, Failed, Uncertain, and Manual only, with icon + text (not color alone).
- **Fetch duration + last-check summary** persisted on each monitor for dashboard and detail views.
- **Richer version comparison** — confirmed fact changes, unchanged facts, and ignored unrelated changes alongside side-by-side evidence, timestamps, and intent/meaning confidence.
- Improved empty states for no monitors / no demo, with safer next actions.
- `GET /api/health` now reports `version: 1.1.0`.
- Deterministic tests covering the guided demo, health derivation, evidence summaries, duplicate-alert prevention, and blocked-page messaging.

### Improved

- Theme preference handling survives unavailable `localStorage`.
- Navigation includes Guided Demo; landing and dashboard link into the walkthrough.
- Accessibility/responsive polish: larger touch targets on primary actions, clearer focus, stacked mobile evidence cards.

### Notes

- No paid APIs, authentication, or external LLM were added.
- Scheduled monitoring still requires a persistent Node process.
