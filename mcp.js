#!/usr/bin/env node
// PinScrap MCP server (stdio). Wraps the pinScrap REST API for AI agents.

const BASE = (process.env.PINSCRAP_URL || "https://pinscrap.onrender.com").replace(/\/+$/, "");
const TIMEOUT = Number(process.env.PINSCRAP_TIMEOUT_MS || 90000);

const qs = (values) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
};

async function api(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    return await fetch(new URL(path, `${BASE}/`), {
      ...init,
      signal: controller.signal,
      redirect: "manual",
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`PinScrap API request timed out after ${TIMEOUT}ms.`);
    }
    throw new Error(`PinScrap API request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// Keep MCP responses concise while retaining the fields useful to agents.
const slim = (pin) => ({
  id: pin.id,
  type: pin.type,
  title: pin.title,
  description: pin.description,
  image_url: pin.image_url,
  video_url: pin.video_url,
  hls_url: pin.hls_url,
  thumbnail_url: pin.thumbnail_url,
  pin_url: pin.pin_url || pin.link,
  width: pin.width,
  height: pin.height,
  pinner: pin.pinner_username,
  board: pin.board,
  download_url: `${BASE}/api/download?${qs({
    url: pin.video_url || pin.hls_url || pin.image_url,
    name: pin.id,
  })}`,
});

const ok = (data) => ({
  content: [{
    type: "text",
    text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
  }],
});

const fail = (message) => ({
  isError: true,
  content: [{ type: "text", text: String(message) }],
});

async function jsonOrError(response) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new Error(`PinScrap API ${response.status}: ${body?.error || text.slice(0, 300)}`);
  }
  return body;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const [{ McpServer }, { StdioServerTransport }, { z }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/mcp.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("zod"),
  ]);

  const server = new McpServer({ name: "pinscrap", version: "1.0.0" });
  const typeEnum = z.enum(["all", "image", "video"]).default("all");

  server.tool(
    "search_pins",
    "Search Pinterest pins by keyword. Returns image/video URLs, titles, pinner and board. Use for inspiration, moodboards or reference media.",
    {
      query: z.string().min(1).describe("Search text, e.g. 'modern interior design'"),
      limit: z.number().int().min(1).max(50).default(10).describe("Number of pins (1-50)"),
      type: typeEnum.describe("Filter by media type"),
      filter_gen_ai: z.boolean().optional().describe("Filter out AI-generated pins. Omit to use server default"),
    },
    async ({ query, limit, type, filter_gen_ai }) => {
      try {
        const response = await api(`/api/search?${qs({
          q: query,
          limit,
          type,
          filterGenAi: filter_gen_ai,
        })}`);
        const data = await jsonOrError(response);
        return ok({
          query: data.query,
          count: data.count,
          results: (data.results || []).map(slim),
        });
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  );

  server.tool(
    "batch_search_pins",
    "Run up to 10 Pinterest searches in one call. Returns pins grouped by query.",
    {
      queries: z.array(z.string().min(1)).min(1).max(10),
      limit: z.number().int().min(1).max(30).default(5).describe("Pins per query"),
      type: typeEnum,
      filter_gen_ai: z.boolean().optional(),
    },
    async ({ queries, limit, type, filter_gen_ai }) => {
      try {
        const response = await api("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queries,
            limit,
            type,
            filterGenAi: filter_gen_ai,
          }),
        });
        const data = await jsonOrError(response);
        const grouped = Object.fromEntries(
          Object.entries(data.queries || {}).map(([query, pins]) => [query, pins.map(slim)]),
        );
        return ok({ count: data.count, queries: grouped });
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  );

  server.tool(
    "get_random_pin",
    "Get one random pin asset URL for a keyword (proxied download link). Good when the agent just needs a single image or video.",
    { query: z.string().min(1), type: typeEnum },
    async ({ query, type }) => {
      try {
        const response = await api(`/api/random?${qs({ q: query, type })}`);
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) throw new Error("PinScrap API redirect did not include a location.");
          const downloadUrl = new URL(location, `${BASE}/`);
          if (downloadUrl.origin !== new URL(BASE).origin) {
            throw new Error("PinScrap API returned a redirect to an unexpected host.");
          }
          return ok({ query, type, download_url: downloadUrl.href });
        }
        await jsonOrError(response);
        return fail("Unexpected response from /api/random");
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  );

  server.tool(
    "get_download_url",
    "Build a proxied download URL for a Pinterest media asset (pinimg.com URLs only). Does not download the file.",
    {
      url: z.string().url().describe("image_url / video_url / hls_url from a search result"),
      name: z.string().optional().describe("File name base"),
    },
    async ({ url, name }) => {
      try {
        const hostname = new URL(url).hostname.toLowerCase();
        if (hostname !== "pinimg.com" && !hostname.endsWith(".pinimg.com")) {
          return fail("Only pinimg.com URLs are supported.");
        }
        return ok({
          download_url: `${BASE}/api/download?${qs({ url, name, dl: 1 })}`,
        });
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  );

  server.tool(
    "get_zip_url",
    "Build a URL that downloads a ZIP of media for a keyword (max 60 items). Does not fetch the ZIP itself.",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(60).default(10),
      type: typeEnum,
    },
    async ({ query, limit, type }) => ok({
      zip_url: `${BASE}/api/zip?${qs({ q: query, limit, type })}`,
    }),
  );

  server.tool(
    "pinscrap_health",
    "Check whether the pinScrap API is online (also wakes it from sleep). Returns uptime and cache size.",
    {},
    async () => {
      try {
        return ok(await jsonOrError(await api("/health")));
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  );

  await server.connect(new StdioServerTransport());
  console.error(`pinscrap-mcp running, API: ${BASE}`);
}

main().catch((error) => {
  console.error(`pinscrap-mcp failed to start: ${errorMessage(error)}`);
  process.exitCode = 1;
});
