# Pinterest Scraper API

This project exposes a lightweight Express API for searching Pinterest pins and proxying downloadable media assets.

Base URL
- Local: http://localhost:3000
- Hosted: use your deployment URL from Render or any Node host

Common headers
- Content-Type: application/json for POST requests
- Authentication: required for `/api/*` requests using `X-API-Key: <key>` or `Authorization: Bearer <key>`
- `/health` is public; `/api/keys` management endpoints use the `X-PinScrap-Admin-Key: <admin-secret>` header instead

Create and revoke API keys from the dashboard's **API Keys** page. Before creating keys, run `supabase/schema.sql` in the Supabase SQL Editor and configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PINSCRAP_ADMIN_KEY`, and `PINSCRAP_KEY_HASH_SECRET` on the server. The dashboard displays a newly created key only once.

Key-management endpoints:
- `GET /api/keys`: list key metadata (admin header required)
- `POST /api/keys` with `{"name":"Claude Desktop"}`: create a key; returns its secret once (admin header required)
- `DELETE /api/keys/{id}`: revoke a key (admin header required)
- `GET /api/keys/verify`: verify a supplied API key (API key header required)

The admin secret and HMAC hash secret must each be at least 32 bytes. Keep the HMAC hash secret stable; changing it invalidates existing keys. API keys are accepted in `X-API-Key` or `Authorization: Bearer` headers and must be sent with every protected API request.

Environment variables
- PORT: HTTP port for the app; defaults to 3000
- PINTEREST_COOKIE: optional browser session cookie string used to improve Pinterest access and AI filtering
- FILTER_GENAI: set to true by default; set to false to disable the AI filter on searches
- SCRAPE_DELAY: delay between scraper requests in milliseconds; defaults to 900

## Health check

### GET /health

Checks whether the API is online.

Example request
```bash
curl http://localhost:3000/health
```

Example response
```json
{
  "ok": true,
  "uptime": 12.34,
  "cached": 0
}
```

Status codes
- 200 OK

## Search pins

### GET /api/search

Search Pinterest for pins matching a query.

Query parameters
- q: required search text
- limit: optional integer between 1 and 200; default 30
- type: optional filter: all, image, video; default all
- filterGenAi: optional boolean; default follows FILTER_GENAI env var

Example request
```bash
curl -H "X-API-Key: $PINSCRAP_API_KEY" "http://localhost:3000/api/search?q=modern%20interior%20design&limit=10&type=image&filterGenAi=true"
```

Example response
```json
{
  "query": "modern interior design",
  "type": "image",
  "filterGenAi": true,
  "count": 10,
  "results": [
    {
      "id": "1234567890",
      "type": "image",
      "title": "Minimalist interior inspiration",
      "description": "Warm lighting and organic textures",
      "link": "https://www.pinterest.com/pin/1234567890/",
      "image_url": "https://i.pinimg.com/originals/...jpg",
      "video_url": null,
      "thumbnail_url": "https://i.pinimg.com/236x/...jpg",
      "pin_url": "https://www.pinterest.com/pin/1234567890/",
      "width": 1200,
      "height": 1600,
      "pinner_username": "designer_name",
      "pinner_name": "Jane Designer",
      "board": "Home Ideas"
    }
  ]
}
```

Status codes
- 200 OK
- 400 Bad Request if q is missing
- 502 Bad Gateway if Pinterest lookup fails

### POST /api/search

Run multiple searches in one request.

Request body
```json
{
  "queries": ["minimal living room", "boho bedroom"],
  "limit": 10,
  "type": "all",
  "filterGenAi": true
}
```

Example request
```bash
curl -X POST -H "X-API-Key: $PINSCRAP_API_KEY" -H "Content-Type: application/json" -d "{\"queries\":[\"minimal living room\",\"boho bedroom\"],\"limit\":10,\"type\":\"all\"}" "http://localhost:3000/api/search"
```

Response
```json
{
  "count": 2,
  "queries": {
    "minimal living room": [
      { "id": "123", "type": "image" }
    ],
    "boho bedroom": [
      { "id": "456", "type": "video" }
    ]
  }
}
```

Notes
- Maximum of 10 queries per request
- Each result entry is tagged with the q value used for that result set

## Download media

### GET /api/download

Proxy a Pinterest media asset through the local API.

Query parameters
- url: required asset URL from a Pinterest-hosted image/video source
- name: optional filename base
- dl: optional download flag; defaults to true when not set to 0

Example request
```bash
curl -H "X-API-Key: $PINSCRAP_API_KEY" "http://localhost:3000/api/download?url=https://i.pinimg.com/originals/abc.jpg&name=my_photo&dl=1"
```

Behavior
- Accepts image and video URLs from allowed hosts such as pinimg.com
- Resolves m3u8 playlist URLs to the best MP4 version when possible
- Streams the binary asset back to the client
- Sets Content-Disposition for downloads unless dl=0

Status codes
- 200 OK
- 206 Partial Content for range requests
- 400 Bad Request if url is missing or invalid

## Random result

### GET /api/random

Pick a random item from search results and redirect to a downloadable asset.

Query parameters
- q: required search text
- type: optional filter, defaults to all
- filterGenAi: optional boolean

Example request
```bash
curl -H "X-API-Key: $PINSCRAP_API_KEY" -L "http://localhost:3000/api/random?q=forest%20aesthetic&type=image"
```

Behavior
- Performs a search with a higher result count internally
- Filters results to the requested media type
- Redirects to /api/download for the selected asset

Status codes
- 302 Found redirect to the proxied download URL
- 400 Bad Request if q is missing
- 404 Not Found if no matching media is found
- 502 Bad Gateway if the upstream scrape fails

## Zip download

### GET /api/zip

Create a ZIP archive of multiple downloadable assets associated with a search query.

Query parameters
- q: required search text
- limit: optional integer up to 60; default is the global request default and capped internally
- type: optional filter: all, image, video
- filterGenAi: optional boolean

Example request
```bash
curl -H "X-API-Key: $PINSCRAP_API_KEY" -L "http://localhost:3000/api/zip?q=cyberpunk%20city&limit=20&type=image" -o cyberpunk.zip
```

Behavior
- Collects a maximum of 60 assets to keep memory usage safe
- Downloads assets individually and adds them to the ZIP archive
- Sends the archive as application/zip

Status codes
- 200 OK with ZIP attachment
- 400 Bad Request if q is missing
- 404 Not Found if no downloadable assets exist
- 502 Bad Gateway if archive generation fails

## Example pin object

Each entry in the search results includes enough metadata for a front-end client to render cards and download assets.

```json
{
  "id": "123456789",
  "type": "video",
  "title": "Beach sunset clip",
  "description": "Ocean wave timelapse",
  "link": "https://www.pinterest.com/pin/123456789/",
  "image_url": "https://i.pinimg.com/originals/...jpg",
  "video_url": "https://i.pinimg.com/videos/...mp4",
  "hls_url": null,
  "thumbnail_url": "https://i.pinimg.com/236x/...jpg",
  "pin_url": "https://www.pinterest.com/pin/123456789/",
  "width": 1080,
  "height": 1920,
  "pinner_username": "beachlover",
  "pinner_name": "Alex Carter",
  "board": "Travel Reels"
}
```

## Error format

API errors are returned in JSON shape:

```json
{
  "error": "Missing ?q= parameter"
}
```

Common codes
- 400: bad client input
- 404: no search results or assets available
- 502: Pinterest scrape or upstream request issue

## Notes

- Search responses are cached for 10 minutes to reduce repeated requests.
- The app restricts download proxies to pinimg.com hosts for safety.
- For production use, set PINTEREST_COOKIE if the target site blocks anonymous requests.
- Use filterGenAi=false only when you intentionally want to disable the Less-AI filter.
