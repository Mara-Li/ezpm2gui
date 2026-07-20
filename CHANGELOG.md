# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [1.12.2](https://github.com/Mara-Li/ezpm2gui/compare/v1.12.1...v1.12.2) (2026-07-20)

### Bug Fixes

* **ui:** stop main content pushing the whole page wide on mobile ([9f31ca7](https://github.com/Mara-Li/ezpm2gui/commit/9f31ca7cd3c5369a10240b3ac47ea46fa7ccf289))
## [1.12.1](https://github.com/Mara-Li/ezpm2gui/compare/v1.12.0...v1.12.1) (2026-07-20)
## [1.12.0](https://github.com/Mara-Li/ezpm2gui/compare/v1.11.1...v1.12.0) (2026-07-20)

### Features

* **logs:** parse ANSI escape codes and render logs in color ([656445e](https://github.com/Mara-Li/ezpm2gui/commit/656445e98a9c57f85cbaa16d23f880c57eb32cdb))

### Bug Fixes

* **auth:** block initial render until the password-gate check resolves ([5a38d04](https://github.com/Mara-Li/ezpm2gui/commit/5a38d04589315e80073535d9f7e7f7705eccb4c0))
* **auth:** break the unauthorized-reload loop and stop racing the lock screen ([d573c61](https://github.com/Mara-Li/ezpm2gui/commit/d573c61fafc1d66670b37845315df7adedd81305))
* **auth:** gate remaining protected-endpoint effects on unlock state ([0ae7b03](https://github.com/Mara-Li/ezpm2gui/commit/0ae7b034b24c5b122c2e8b5dc544c0aaa27c5f19))
* **auth:** stop the loading spinner getting stuck forever while locked ([ae0fe2d](https://github.com/Mara-Li/ezpm2gui/commit/ae0fe2d0a3309e3e0b6a5bceb219e1d5420cd95b))
* include the missed .gitignore entries from the previous commit ([65871af](https://github.com/Mara-Li/ezpm2gui/commit/65871af4a950aef0e25162f2323a3851204fc666))
* **logs:** parse ANSI colors in the remote-connections floating log panel ([e809d52](https://github.com/Mara-Li/ezpm2gui/commit/e809d524837d0483ffec1def076583812c799d15))
* **security:** stop tracking runtime-generated server state in git ([12f5186](https://github.com/Mara-Li/ezpm2gui/commit/12f5186eefab88c19b385649977225e19408acfc))
* **ui:** fix misaligned toggle knob and select arrow overlap in Settings ([34709b6](https://github.com/Mara-Li/ezpm2gui/commit/34709b6a72e38d2d48cef8038c1e5033b85acfee))
* **ui:** reclaim vertical padding on the log toolbar's select/inputs ([b829511](https://github.com/Mara-Li/ezpm2gui/commit/b8295113bccd3193a60690b437ac7b071b1bb98f))
* **ui:** stop global focus ring from overriding focus:outline-none ([96a08e6](https://github.com/Mara-Li/ezpm2gui/commit/96a08e6378eb0eda77961383aac5ea48eddf1467))
* **ui:** stop top nav bar from overflowing on mobile ([aa85112](https://github.com/Mara-Li/ezpm2gui/commit/aa85112c0c8b932b869be463c48de0e5934672f1))
* **update:** use the ezpm2gui@npm: alias form for install/upgrade commands ([ca84f07](https://github.com/Mara-Li/ezpm2gui/commit/ca84f070f2cd4e47cb7ad09b549d2d77dc1678b0))
## [1.10.0] - 2026-05-28

### Added
- **Full i18n / multi-language support** — entire UI is now internationalised using `i18next` + `react-i18next`. Every page, component, dialog, toast, tooltip, and navbar label is driven by translation keys.
- **English (en) locale** — complete `translation.json` covering all UI strings; serves as the fallback language.
- **Nepali (ne) locale** — full Nepali translation for all UI strings; first non-English language shipped.
- **Language Switcher component** — `LanguageSwitcher.tsx` added to the navbar; selected language persists via `localStorage` (`ezpm2gui-language` key).
- **Contributor translation guide** — `CONTRIBUTING_TRANSLATIONS.md` added to the repository so the community can add new locales.

### Changed
- All hardcoded English strings across Dashboard, System Metrics, Monitoring, Metrics, Log Viewer, Deploy, Cluster, Modules, Cron Jobs, Settings, Remote Connections, and utility dialogs replaced with `t('key')` calls.
- Chinese (zh) locale removed from active language list (translation file retained for future contribution).

---

## [1.9.0] - 2025-07-11

### Added
- **End-to-end password encryption for remote connections** — browser generates a one-time AES-256-GCM key, wraps it with the server's RSA-OAEP public key, and encrypts credentials before transmission. Server decrypts via `decryptTransitPayload()`. Backward-compatible with legacy plain-string fields via `decryptField()`.
- **Sidebar quick-action buttons** — per-process restart, start/stop, and logs buttons revealed on hover in the sidebar process tree.
- **Log viewer search highlighting** — search term matches are highlighted inline in both `LogStreamEnhanced` and `EnhancedLogManagement` components.
- **Log timestamp range filter** — filter log output by start/end timestamp; polling automatically pauses while filter is active to preserve the snapshot.
- **Remote log polling** — logs from remote servers are periodically fetched and displayed in a floating log panel.
- **Configurable dev proxy** — new `setupProxy.js` replaces the static `proxy` field in `src/client/package.json`; reads `REACT_APP_API_URL` or defaults to `http://localhost:3101`.
- **Port and host from environment** — server reads `PORT` and `HOST` from environment variables with sane defaults (`3101` / `localhost`).

### Changed
- Theme and active-server preferences now persist across page reloads via `localStorage`.
- Remote Connections UI: improved start/stop button styling.

### Fixed
- Removed extra blue focus ring on MUI `OutlinedInput` components (CSS override in both `App.tsx` theme and `index.css`).

---

## [1.8.0] - 2024-12-01

### Added
- Advanced Monitoring Dashboard with real-time performance charts and health scoring.
- Metrics page with live per-process sparklines (rolling 1-hour window, updated every 3s).
- Metrics History tab backed by SQLite for long-term CPU and memory charts.
- Remote Server Management — connect and manage PM2 on remote servers via SSH.
- Cron Jobs — schedule recurring tasks with a visual cron expression builder.
- What's New page and in-app changelog viewer.
- Page-level authentication support.

### Changed
- UI migrated to Tailwind CSS for a compact, responsive, dark/light-friendly design.

---

## [1.6.0] - 2024-09-01

### Added
- Enhanced log streaming with WebSocket-based real-time updates.
- Process detail page with per-process performance charts.
- Ecosystem configuration generator.
- PM2 module management.

---

## [1.5.0] - 2024-07-01

### Added
- System metrics dashboard (CPU cores, memory, load averages, uptime).
- Cluster management UI — scale instances, switch fork/cluster mode, zero-downtime reload.

---

## [1.4.0] - 2024-05-01

### Added
- Application deployment form — launch new PM2 processes from the UI.
- Dark/light mode toggle.
- Filter processes by status or name.

---

## [1.3.0] - 2024-03-01

### Added
- Initial public release.
- Real-time process monitoring via WebSocket (Socket.IO).
- Start, stop, restart, and delete PM2 processes from the browser.
- Process CPU and memory charts.
