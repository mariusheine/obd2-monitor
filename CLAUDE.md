# OBD-II Monitor — project guide

A **no-backend PWA** that connects to a **BLE ELM327 adapter** via **Web Bluetooth**, continuously
polls & logs OBD-II data, and analyses **DPF regeneration** on a **Fiat Ducato** diesel. Runs on
**Android Chrome** (Web Bluetooth is BLE-only and unsupported on iOS). No install, no server.

## Commands

- `pnpm dev` — Vite dev server
- `pnpm test` / `pnpm test:watch` — Vitest
- `pnpm typecheck` — `vue-tsc --noEmit` (strict)
- `pnpm lint` / `pnpm lint:fix` — ESLint (flat config)
- `pnpm build` — typecheck + production PWA build

This repo uses **pnpm** (pinned via the `packageManager` field). Run `corepack enable` once, then
`pnpm install`.

Always keep `test`, `typecheck`, and `lint` green.

## Architecture (layers, bottom-up)

- `src/obd/transport/` — raw byte pipe to the adapter behind the `Transport` interface.
  - `BleTransport` (Web Bluetooth, browser-only), `MockTransport` (simulator, drives the app with
    no hardware), `simulator.ts` (`VehicleSimulator` incl. a DPF soot/regen cycle).
- `src/obd/elm327/` — `Elm327` driver (queued commands, `>`-prompt reassembly, init AT sequence)
  and `parse.ts` (response → bytes, ISO-TP multi-line, error tokens). Pure parsing is unit-tested.
- `src/obd/pids/` — `PidDefinition` catalog. `standardPids.ts` (verified SAE J1979), `fiatDpf.ts`
  (**experimental** Mode 22, placeholders), `formula.ts` (safe Torque-formula evaluator — **never
  `eval`**), `catalog.ts` (lookup + `DPF_PRESET_IDS`).
- `src/stores/` — Pinia: `connection` (transport/elm lifecycle), `live` (latest values; Phase-1
  sequential poller, to become a priority scheduler).
- `src/views/`, `src/App.vue`, `src/router/` — UI. Mobile-first, dark, glanceable while driving.

Data flows: **Transport → Elm327 → PID decode → stores → views**. Components never poll or decode
directly; that lives in the store/acquisition layer.

## Conventions

- Vue 3 `<script setup lang="ts">`, Composition API only. **Strict TS** (`noUncheckedIndexedAccess`
  is on — array access is `T | undefined`; guard it, don't `!` it).
- Keep class instances (transport/elm) out of deep reactivity — use `shallowRef`.
- Decoders return `number | null` (null = insufficient/undecodable bytes), never throw.
- Experimental Fiat PIDs must stay flagged `experimental` with a `source` until verified on the car.

## Verifying without a car

`MockTransport` answers the ELM327 init + Mode 01/22 requests from `VehicleSimulator`, including a
periodic DPF regeneration (EGT spike + soot drop). Pick **"Use simulator"** on the Connect screen,
or use it in tests (see `src/obd/elm327/Elm327.test.ts`).

## Subagents (`.claude/agents/`)

`obd-protocol` (ELM327/PID/Fiat decoding), `vue-frontend` (Vue/TS/UI/charts), `web-bluetooth-pwa`
(transport + PWA/offline), `obd-test` (Vitest + simulator). Reuse the `dataviz` skill for charts and
`verify`/`run` for end-to-end checks.

## Roadmap

Phase 0 scaffold ✅ · Phase 1 transport/ELM327/PIDs + live MVP ✅ · Phase 2 priority scheduler +
uPlot charts + gauges ✅ · Phase 3 Dexie logging + sessions + export ✅ · Phase 4 DTC read/clear ✅ ·
Phase 5 DPF analysis (**remaining — needs on-vehicle data**) · Phase 6 wake-lock + auto-reconnect +
PWA ✅. Full plan: `~/.claude/plans/i-want-to-build-jiggly-pebble.md`.

Phase 6 additions: `src/lib/useWakeLock.ts` (Screen Wake Lock, re-acquires on `visibilitychange`;
App keeps it while `live.polling`), `src/obd/transport/Reconnector.ts` (backoff retry) wired into
`src/stores/connection.ts` — on an unexpected BLE drop it stops the scheduler, shows a
`reconnecting` status, silently re-opens the permitted device, re-inits ELM, and `live.resume()`s so
recording continues. PWA now ships PNG maskable icons (`public/pwa-{192,512}.png` via ImageMagick).
Keep session/Dexie out of the initial bundle — only lazy views import the session store.

Phase 4 additions: `src/obd/dtc/decode.ts` (`decodeDtc` per SAE J2012, `parseDtcResponse` for
Mode 03/07/0A incl. CAN count-byte + `0000` padding + `NO DATA`), `src/obd/dtc/descriptions.ts`
(generic/diesel/DPF code table), `src/stores/dtc.ts` (read all + Mode 04 clear), and
`src/views/DtcView.vue`. `MockTransport` answers 03/07/0A/04 (two stored + one pending DTC,
clearable). Clearing is gated behind a confirm and warns it wipes freeze-frame data.

Phase 2 additions: `src/obd/acquisition/scheduler.ts` (bandwidth-aware `AcquisitionScheduler`,
`buildPollSpecs`/`defaultPollMs`), `src/lib/TimeSeries.ts` (ring buffer), `src/stores/config.ts`
(persisted poll specs), reworked `src/stores/live.ts` (latest values + per-PID histories +
`revision`), and components `TimeSeriesChart.vue` (uPlot), `GaugeDial.vue`, `ValueCard.vue`.

Phase 3 additions: `src/storage/db.ts` (Dexie `sessions`/`samples`, `[sessionId+ts]` index,
`deleteSession`, `storageEstimate`), `src/storage/export.ts` (pure `buildCsv`/`buildSessionJson` +
`downloadText`), `src/stores/session.ts` (batched recorder tapping `live.addSampleListener`), and
`src/views/SessionsView.vue` (history, storage bar, CSV/JSON export, delete). Recording toggle lives
on the Live dashboard; polling keeps running across view changes while recording. Storage tests use
`fake-indexeddb` (jsdom has no IndexedDB).
