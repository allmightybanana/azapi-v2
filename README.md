# AniAtlas Metadata API

AniAtlas is a standalone REST API and responsive frontend for AniZone's public anime catalog and streaming endpoints. It turns source-page details into predictable JSON with normalized HTTPS links, HLS stream sources, cursor pagination, safe-search defaults, caching, and clean error responses.

## Quick start

```bash
npm install
npm start
```

Open [http://localhost:3100](http://localhost:3100). The OpenAPI 3.1 document is available at [http://localhost:3100/api/v1/openapi.json](http://localhost:3100/api/v1/openapi.json).

For development with automatic restarts:

```bash
npm run dev
```

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health` | API and upstream health |
| `GET` | `/api/v1/home` | Latest anime, latest episodes, top tags |
| `GET` | `/api/v1/anime` | Search, filter, sort, cursor pagination, and AniList ID lookup (`?anilistId=...`) |
| `GET` | `/api/v1/anime/:id` | Anime metadata with score-based AniList ID referencing and episodes |
| `GET` | `/api/v1/anime/anilist/:anilistId` | Direct anime lookup by AniList ID |
| `GET` | `/api/v1/anime/anilist/:anilistId/stream/:episode` | Direct HLS stream lookup by AniList ID and episode |
| `GET` | `/api/v1/anime/:id/episodes/:episode/stream` | HLS master playlist, subtitles, audio, servers, and AniList ID |
| `GET` | `/api/v1/stream/:id/:episode` | Convenience alias for episode HLS stream details |
| `GET` | `/api/v1/stream/proxy` | CORS-enabled proxy for HLS playlists, segments, and keys |
| `GET` | `/api/v1/episodes` | Public episode index metadata |
| `GET` | `/api/v1/tags` | Source taxonomy |
| `GET` | `/api/v1/mappings` | Verified AniList ID to AniZone slug mapping registry |
| `GET` | `/api/v1/openapi.json` | OpenAPI 3.1 schema |

Example:

```bash
curl "http://localhost:3100/api/v1/anime/anilist/150672"
curl "http://localhost:3100/api/v1/anime/anilist/150672/stream/1"
```

Responses use one envelope:

```json
{
  "success": true,
  "data": {
    "items": [],
    "nextCursor": null,
    "hasMore": false
  },
  "meta": {
    "cache": "hit",
    "cacheAgeMs": 1210,
    "responseTimeMs": 4,
    "generatedAt": "2026-08-16T05:00:00.000Z"
  }
}
```

Search at the source can occasionally be slow. AniAtlas tries the source search briefly, then falls back to filtering the current catalog window and marks the response with `partial: true` plus a warning. Cached successful searches continue to be served while fresh upstream requests fail.

## Configuration

Copy `.env.example` to `.env` and adjust the values as needed. The app loads this file from the project root; variables already supplied by the shell, PM2, or Docker take precedence.

- `PORT` — HTTP port, default `3100`
- `ANIZONE_BASE_URL` — source origin
- `REQUEST_TIMEOUT_MS` — upstream request timeout
- `CACHE_TTL_MS` — fresh cache lifetime
- `CACHE_STALE_MS` — maximum stale fallback lifetime
- `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX` — per-client API limits
- `ANIZONE_PROXY` (or `HTTPS_PROXY` / `HTTP_PROXY`) — authenticated outbound forward proxy (e.g. `http://user:pass@host:port`) for scraping AniZone and AniList

## Docker

```bash
docker build -t aniatlas-api .
docker run --rm -p 3100:3100 aniatlas-api
```

From the workspace root, `docker compose up anizone` starts the same service.

## Quality checks

```bash
npm run check
npm test
npm run verify
```

`verify` makes live source requests. Unit and HTTP contract tests do not require AniZone.

## Source etiquette

AniZone's `robots.txt` currently allows crawling and marks search-index use as permitted. AniAtlas identifies itself in requests, caches responses for five minutes by default, limits client traffic, and serves stale cached metadata during short upstream outages. Re-check the site's rules before public deployment and respect applicable terms and copyright law.
