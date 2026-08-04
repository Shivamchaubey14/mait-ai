# Mait mobile app

React Native + TypeScript field app for Maits (SRS §6.3). Android-first.

## Native projects are not committed yet

`android/` and `ios/` are absent. Generate them once, on a machine with the Android SDK:

```bash
cd mobile
npx react-native@0.75.4 init MaitApp --directory . --skip-install --title "Mait AI"
npm install
```

Then commit the generated folders. Until that happens the `android-build` job in
`.github/workflows/mobile-ci.yml` will skip rather than pass — lint, typecheck and Jest all
run regardless.

## Development

```bash
npm ci
npm start                 # Metro bundler
npm run android           # build and install on a device/emulator
```

The app points at `http://10.0.2.2:8000/api/v1` in debug builds — that address is the host
machine as seen from the Android emulator, so `make up` at the repo root is enough to have a
backend. Release builds point at the production API and can be redirected over the air
(SRS §15).

## Structure

```
src/
├── api/          RTK Query client + injected endpoint slices
├── config/       runtime configuration and flow constants
├── features/     one folder per flow (auth, aiFlow, inventory, indents, payments)
├── i18n/         en/hi translations — no user-facing string lives outside here
├── offline/      SQLite draft queue and the sync engine
├── store/        Redux Toolkit store
└── theme/        design tokens (SRS §10)
```

## Three things that are easy to get wrong

**Every write must be safe to retry.** The app queues AI events offline and drains the queue
on reconnect, often over a connection that drops mid-flight. Writes carry the event's
client-generated UUID as an `Idempotency-Key` (ADR 0003), so a blind retry is safe. Do not
add a write path that skips it.

**Never trust local inventory as the gate.** The cached straw count drives the UI, but the
server is the authority. The scan step calls `/semen-batches/{no}/validate/`, and completion
can still fail with `insufficient-stock` — handle it, do not assume the local count was right.

**No hardcoded strings, no hardcoded colours.** Text goes through `src/i18n/`, colour and
spacing through `src/theme/tokens.ts`. Both are lint-enforced. Devanagari runs taller and
longer than English — never fix a button's height to exactly its English label.

## Testing

```bash
npm test              # Jest + React Native Testing Library
npm run lint
npm run typecheck
```

Detox covers the end-to-end capture flow on a device (SRS §13); it runs outside CI for now
because it needs an emulator with a camera.
