# World Route Atlas

A standalone route planner for runs, marathons, triathlons, hikes and rides
with weather, wind-vs-race analysis, area news, wildlife and downloadable
daily reports.

## Run locally

Requires [Bun](https://bun.sh) (or Node 20+).

```bash
bun install
bun run dev
```

Then open http://localhost:8080/atlas

## Build for production

```bash
bun run build
bun run start
```

## Main file
- `src/routes/atlas.tsx` — the entire World Route Atlas page
