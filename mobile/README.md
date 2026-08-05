# Mait mobile app

React Native + TypeScript field app for Maits (SRS §6.3), managed with **Expo SDK 54**.

## Running it

Two things need to be up: the API, and the Expo dev server.

```bash
# 1. API — bind 0.0.0.0, not 127.0.0.1, or the phone cannot reach it
cd backend
python manage.py runserver 0.0.0.0:8000

# 2. Expo
cd mobile
npm install
npx expo start -c
```

Scan the QR code with **Expo Go**. The phone and the computer must be on the same network.

### The API URL is worked out, not configured

`src/config/env.ts` reads the address Expo is serving the packager from and points the API at
that host on port 8000. A phone cannot reach `127.0.0.1` — that address is the phone itself —
and hardcoding a LAN IP means editing a file every time the laptop joins a different network.

A non-loopback `extra.apiUrl` in `app.json` overrides this, which is how staging and
production builds are pointed somewhere real.

If requests fail from the device, check in this order:

1. The API is bound to `0.0.0.0`, not `127.0.0.1`.
2. `DJANGO_ALLOWED_HOSTS` in `backend/.env` includes the computer's LAN IP.
3. Windows Firewall is not blocking inbound port 8000 — this is the usual culprit.
4. `npx expo start --tunnel` if the two devices are on networks that cannot see each other.

## Structure

```
src/
├── api/          RTK Query client, endpoints, contract types
├── components/   shared primitives — Button, TextField, ListRow, Banner
├── config/       runtime configuration and flow constants
├── features/     one folder per flow (auth, aiFlow)
├── i18n/         en/hi translations — no user-facing string lives outside here
├── navigation/   the six-step flow shell
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
spacing through `src/theme/tokens.ts`. Both are lint-enforced. Hindi is a tap away on the
login hero, and Devanagari runs taller and longer than English — never fix a button's height
to exactly its English label.

## Testing

```bash
npm test          # Jest + React Native Testing Library
npm run lint
npm run typecheck
```

Copy assertions resolve strings through i18n rather than hardcoding English, so rewording a
string is a copy change and not a broken test.

## Builds

There is no committed `android/` or `ios/` folder — this is a managed Expo project, and
release builds go through **EAS Build** rather than Gradle. CI proves the app bundles with
`expo export`; wiring `eas build` needs an Expo account and an `EXPO_TOKEN` secret.

Phase 3 adds the camera and the offline queue. Use `expo-camera` (camera-first capture, no
gallery picker — SRS §6.3 step 5) and `expo-sqlite` for the draft queue. Both run in Expo Go,
so the workflow above keeps working.
