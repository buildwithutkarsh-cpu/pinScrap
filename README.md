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

The app reads these environment variables:

- PORT: optional server port, default 3000
- PINTEREST_COOKIE: optional Pinterest session cookie string for authenticated access
- FILTER_GENAI: default true, disables the AI-filtered search mode when set to false
- SCRAPE_DELAY: optional delay between scraper requests, default 900ms

Example:

```bash
export PORT=3000
export FILTER_GENAI=true
export SCRAPE_DELAY=900
export PINTEREST_COOKIE="sessionid=...; csrftoken=..."
```

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

## Quick examples

### Search for pins

```bash
curl "http://localhost:3000/api/search?q=modern%20architecture&limit=5&type=image"
```

### Download a media file

```bash
curl "http://localhost:3000/api/download?url=https://i.pinimg.com/originals/example.jpg&name=my_photo"
```

### Zip a set of results

```bash
curl -L "http://localhost:3000/api/zip?q=summer%20travel&limit=10&type=image" -o summer-travel.zip
```

### Random pin asset

```bash
curl -L "http://localhost:3000/api/random?q=forest%20aesthetic&type=video"
```

## API documentation

See [API.md](./API.md) for the full request/response documentation and endpoint reference.

## Deployment

This project includes a Render configuration in [render.yaml](./render.yaml). It deploys as a Node.js web service and uses the health endpoint at `/health`.

## Notes

- Search results are cached for 10 minutes.
- Downloaded files are only proxied when the URL resolves to an allowed host.
- In production, setting PINTEREST_COOKIE can improve reliability if Pinterest blocks anonymous requests.
