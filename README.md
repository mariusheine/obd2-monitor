# OBD-II Monitor

A **no-backend Progressive Web App** that connects to a **BLE ELM327 adapter** over
**Web Bluetooth**, continuously polls and logs OBD-II data, and analyses **DPF regeneration**
on a **Fiat Ducato** diesel. No install, no server, no data leaves the device.

> **Platform:** Web Bluetooth is BLE-only and unsupported on iOS/Safari, so this runs on
> **Android Chrome** (or desktop Chrome/Edge for development). No hardware? Pick **"Use simulator"**
> on the Connect screen to drive the whole app from a built-in vehicle simulator.

## Features

- 🔌 **Web Bluetooth transport** to BLE ELM327 adapters, with keep-alive and automatic backoff
  reconnect on an unexpected drop.
- 📊 **Live dashboard** — bandwidth-aware priority scheduler, uPlot time-series charts, gauges,
  and glanceable value cards.
- 💾 **Session logging** — Dexie/IndexedDB recording with CSV and JSON export, plus storage
  usage tracking.
- 🩺 **Diagnostic trouble codes** — read (Mode 03/07/0A) and clear (Mode 04), with a
  generic/diesel/DPF code description table.
- 🌫️ **DPF analysis** (experimental) — soot load, EGT, and regeneration tracking via
  manufacturer-specific Mode 22 PIDs.
- 📱 **Installable PWA** — offline shell, maskable icons, and Screen Wake Lock so the display
  stays on while recording.

## Getting started

This repo uses **pnpm** (pinned via the `packageManager` field) and Node 24.

```bash
corepack enable      # once, to activate the pinned pnpm
pnpm install
pnpm dev             # Vite dev server
```

Open the dev URL in Chrome. On the Connect screen, either pair a BLE ELM327 adapter or choose
**"Use simulator"** to run without any hardware.

## Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Vite dev server |
| `pnpm build` | Typecheck + production PWA build |
| `pnpm preview` | Preview the production build |
| `pnpm test` / `pnpm test:watch` | Vitest (run / watch) |
| `pnpm test:coverage` | Vitest with coverage report |
| `pnpm typecheck` | `vue-tsc --noEmit` (strict) |
| `pnpm lint` / `pnpm lint:fix` | ESLint (flat config) |
| `pnpm format` | Prettier |

## Architecture

Data flows **Transport → Elm327 → PID decode → stores → views**. Components never poll or decode
directly.

- `src/obd/transport/` — raw byte pipe behind the `Transport` interface: `BleTransport`
  (Web Bluetooth), `MockTransport` (simulator), and `Reconnector` (backoff retry).
- `src/obd/elm327/` — the `Elm327` driver (queued commands, `>`-prompt reassembly, init AT
  sequence) and pure, unit-tested response parsing.
- `src/obd/pids/` — the `PidDefinition` catalog: verified SAE J1979 standard PIDs, experimental
  Fiat Mode 22 PIDs, and a safe Torque-formula evaluator (never `eval`).
- `src/obd/dtc/` — SAE J2012 DTC decoding and descriptions.
- `src/obd/acquisition/` — the bandwidth-aware `AcquisitionScheduler`.
- `src/storage/` — Dexie database and CSV/JSON export.
- `src/stores/` — Pinia stores (connection, live values, config, sessions, DTCs).
- `src/views/`, `src/App.vue`, `src/router/` — mobile-first, dark, glanceable UI.

See [CLAUDE.md](CLAUDE.md) for the full layer-by-layer guide and conventions.

## Deployment

Pushing to `main` builds and publishes the PWA to **GitHub Pages** via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Project sites serve from
`/<repo>/`, so the build sets `VITE_BASE` accordingly; for a user/org page or custom domain,
set `VITE_BASE=/`.

## Tech stack

Vue 3 (`<script setup>`, Composition API) · strict TypeScript · Pinia · Vue Router · Vite ·
vite-plugin-pwa · Dexie · uPlot · Vitest.

## Disclaimer

This project was written **entirely with [Claude Code](https://claude.com/claude-code)**,
Anthropic's agentic coding tool.

This is a hobby diagnostics tool. The Fiat Ducato Mode 22 PIDs are **experimental** and
unverified until confirmed on the vehicle — do not rely on them for safety-critical decisions.
Use at your own risk.

## License

[MIT](LICENSE) © 2026 Marius Heine
