# Changelog

All notable changes to PagePulse are documented in this file.

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
