# Pinterest API

A Node.js Express API that searches Pinterest pins and streams image/video assets through a local proxy.

## Features

- Search Pinterest pins by keyword
- Filter by image or video results
- Optionally disable the AI filter for search results
- Proxy downloadable media files through /api/download
- Return random results via redirect-based random endpoint
- Download grouped results as a ZIP archive
- Lightweight caching for repeated searches

## Project structure

```text
.
├── API.md
├── dashboard/
├── mcp.js
├── package.json
├── pinterest.js
├── render.yaml
├── server.js
└── node_modules/
```

## Requirements

- Node.js 20+
- npm

## Installation

```bash
npm install
```

## Configuration

The web API reads these environment variables:

- PORT: optional server port, default 3000
- PINTEREST_COOKIE: optional Pinterest session cookie string for authenticated access
- FILTER_GENAI: default true, disables the AI-filtered search mode when set to false
- SCRAPE_DELAY: optional delay between scraper requests, default 900ms
- SUPABASE_URL: Supabase project URL for API-key storage
- SUPABASE_SERVICE_ROLE_KEY: server-only Supabase service-role key
- PINSCRAP_ADMIN_KEY: server-only secret required to create, list, and revoke API keys
- PINSCRAP_KEY_HASH_SECRET: secret used to HMAC-hash API keys before storing them

The MCP server additionally reads:

- PINSCRAP_API_KEY: MCP client key created from the dashboard (set in the MCP client's environment)
- PINSCRAP_URL: optional API base URL for the MCP server; defaults to the hosted PinScrap service
- PINSCRAP_TIMEOUT_MS: optional MCP API timeout in milliseconds; defaults to 90000
- PINSCRAP_MCP_RATE_LIMIT: optional shared MCP tool-call limit per minute; defaults to 30

Example:

```bash
export PORT=3000
export FILTER_GENAI=true
export SCRAPE_DELAY=900
export PINTEREST_COOKIE="sessionid=...; csrftoken=..."
```

`PINSCRAP_ADMIN_KEY` and `PINSCRAP_KEY_HASH_SECRET` must each be at least 32 bytes. Use independently generated random values; keep the hash secret unchanged to preserve existing API keys.

## Run locally

```bash
npm start
```

The server starts on:

```text
http://localhost:3000
```

Open the PinScrap dashboard at either URL:

```text
http://localhost:3000/dashboard
http://localhost:3000/dashboard/
```

The dashboard is built with plain HTML, CSS, and JavaScript and uses the API served by the same app.

## API key setup

1. Run [supabase/schema.sql](./supabase/schema.sql) in the Supabase SQL Editor.
2. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PINSCRAP_ADMIN_KEY`, and `PINSCRAP_KEY_HASH_SECRET` as server environment variables. Use separate random secrets for the admin key and hash secret, and never expose these values in the browser.
3. Restart the PinScrap server and open the dashboard's **API Keys** page. Unlock key management with `PINSCRAP_ADMIN_KEY`, then create a named key.
4. Copy the generated `ps_...` key immediately; it is shown only once. API keys are stored as HMAC hashes in Supabase.

All `/api/*` routes require an API key in the `X-API-Key` or `Authorization: Bearer` header, except `/api/keys` management routes, which require the `X-PinScrap-Admin-Key` header. `/health` remains public. The dashboard keeps its connected API key in the current browser tab's session storage. When using MCP, set `PINSCRAP_API_KEY` in the MCP server environment.

Keep `PINSCRAP_KEY_HASH_SECRET` stable: changing it invalidates every existing API key. Configure the same Supabase and admin environment variables in Render before using API-key management on the deployed service.

## MCP server

The stdio MCP server provides tools for Pinterest search, batch search, random pins, download URLs, ZIP URLs, and API health.
It reads `PINSCRAP_URL` (default `https://pinscrap.onrender.com`), `PINSCRAP_TIMEOUT_MS` (default `90000` milliseconds), `PINSCRAP_MCP_RATE_LIMIT` (default `30` tool calls per minute, shared across all tools), and `PINSCRAP_API_KEY`. Set the latter to a key created in the dashboard so MCP tool requests can authenticate to PinScrap.

Run it with:

```bash
npm run mcp
```

To connect it to the local API, set `PINSCRAP_URL` before starting it. In PowerShell:

```powershell
$env:PINSCRAP_URL = "http://localhost:3000"
$env:PINSCRAP_API_KEY = "ps_your_api_key"
npm run mcp
```

Configure your MCP client to launch Node.js with the absolute path to `mcp.js`. Set `PINSCRAP_URL` in the client environment when using a non-default API URL. The MCP server writes diagnostics to standard error and uses standard input/output for MCP messages.

## Quick examples

### Search for pins

```bash
curl -H "X-API-Key: $PINSCRAP_API_KEY" "http://localhost:3000/api/search?q=modern%20architecture&limit=5&type=image"
```

### Download a media file

```bash
curl -H "X-API-Key: $PINSCRAP_API_KEY" "http://localhost:3000/api/download?url=https://i.pinimg.com/originals/example.jpg&name=my_photo"
```

### Zip a set of results

```bash
curl -H "X-API-Key: $PINSCRAP_API_KEY" -L "http://localhost:3000/api/zip?q=summer%20travel&limit=10&type=image" -o summer-travel.zip
```

### Random pin asset

```bash
curl -H "X-API-Key: $PINSCRAP_API_KEY" -L "http://localhost:3000/api/random?q=forest%20aesthetic&type=video"
```

## API documentation

See [API.md](./API.md) for the full request/response documentation and endpoint reference.

## Deployment

This project includes a Render configuration in [render.yaml](./render.yaml). It deploys as a Node.js web service and uses the health endpoint at `/health`.

## Notes

- Search results are cached for 10 minutes.
- Downloaded files are only proxied when the URL resolves to an allowed host.
- In production, setting PINTEREST_COOKIE can improve reliability if Pinterest blocks anonymous requests.
