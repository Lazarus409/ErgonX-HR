# ErgonX frontend

ErgonX is the tenant-aware Next.js interface for the Django API in
`../Ergonx-backend`.

## Development

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. The local proxy forwards `/api/v1/*` to the
configured Django backend; see `.env.local.example` for the optional target.

## Production-style local run

```bash
npm run build
npm run start
```

`npm run start` uses the standalone build and copies `public/` plus
`.next/static/` into the standalone runtime before starting it. This mirrors
the production Docker image, so the web manifest, service worker, and static
assets are available locally.

## PWA boundary

Production builds expose an installable application shell with a manifest,
service worker, and `/offline` fallback. The service worker caches only static
frontend assets. It never caches navigations, `/api/` responses, report
exports, browser tokens, institution context, or tenant data, and it never
queues writes. Offline mode therefore presents a reconnection page rather than
stale operational data.

Run checks before delivery:

```bash
npx tsc --noEmit
npm run lint
npm run build
```
