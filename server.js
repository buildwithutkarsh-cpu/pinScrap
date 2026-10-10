const express = require("express");
const cors = require("cors");
const { Readable } = require("node:stream");
const archiver = require("archiver");
const PinterestScraper = require("./pinterest");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ---------- singleton scraper, lazily warmed ----------
let scraperPromise = null;

function getScraper() {
  if (!scraperPromise) {
    scraperPromise = (async () => {
      const s = new PinterestScraper({
        delay: Number(process.env.SCRAPE_DELAY || 900),
        filterGenAi: process.env.FILTER_GENAI !== "false",
        aiHeuristic: true,
        useFallback: true,
      });
      await s.init();
      return s;
    })().catch((e) => {
      scraperPromise = null; // let the next request retry
      throw e;
    });
  }
  return scraperPromise;
}

// ---------- response cache (never caches a rejection) ----------
const cache = new Map();
const TTL = 10 * 60 * 1000;

function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return Promise.resolve(hit.value);

  const value = fn().catch((err) => {
    cache.delete(key); // a transient 429 shouldn't poison the query for 10 min
    throw err;
  });
  cache.set(key, { ts: Date.now(), value });
  return value;
}

// ---------- asset URL safety ----------
const ALLOWED_HOSTS = ["pinimg.com"];
function assertSafeUrl(raw) {
  const u = new URL(raw);
  const ok = ALLOWED_HOSTS.some(
    (h) => u.hostname === h || u.hostname.endsWith("." + h)
  );
  if (!ok) throw new Error(`Host not allowed: ${u.hostname}`);
  return u;
}

// If handed an .m3u8, walk down the qualities until an mp4 actually resolves.
async function resolveAsset(url) {
  if (!/\.m3u8(\?|$)/i.test(url)) return url;

  const headers = { "User-Agent": BROWSER_UA, Referer: "https://www.pinterest.com/" };
  for (const q of ["720p", "540p", "480p", "360p"]) {
    const cand = url
      .replace(/\/hls\//, `/${q}/`)
      .replace(/\.m3u8(\?.*)?$/, ".mp4");
    try {
      const r = await fetch(cand, { method: "HEAD", headers });
      if (r.ok) {
        console.log(`resolved m3u8 -> ${q} mp4`);
        return cand;
      }
    } catch { /* try next quality */ }
  }
  return url; // give up, stream the playlist
}

// filterGenAi always resolves to a boolean
function parseOpts(req) {
  const q = (req.query.q || req.query.query || "").trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit ?? "30", 10) || 30, 1), 200);
  const type = (req.query.type ?? "all").toLowerCase();
  const filterGenAi =
    req.query.filterGenAi !== undefined
      ? req.query.filterGenAi !== "false"
      : process.env.FILTER_GENAI !== "false";
  return { q, limit, type, filterGenAi };
}

async function runSearch({ q, limit, type, filterGenAi }) {
  const scraper = await getScraper();
  const key = `${q}|${limit}|${type}|${filterGenAi}`;
  return cached(key, () => scraper.search(q, { maxPins: limit, type, filterGenAi }));
}

// ---------- routes ----------
app.get("/health", (_req, res) =>
  res.json({ ok: true, uptime: process.uptime(), cached: cache.size })
);

app.get("/api/search", async (req, res) => {
  const { q, limit, type, filterGenAi } = parseOpts(req);
  if (!q) return res.status(400).json({ error: "Missing ?q= parameter" });

  try {
    const pins = await runSearch({ q, limit, type, filterGenAi });
    res.json({ query: q, type, filterGenAi, count: pins.length, results: pins });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/search", async (req, res) => {
  const queries = req.body?.queries;
  if (!Array.isArray(queries) || !queries.length) {
    return res.status(400).json({ error: "Body must be { queries: [...] }" });
  }
  const limit = Math.min(Math.max(parseInt(req.body.limit ?? "30", 10) || 30, 1), 200);
  const type = (req.body.type ?? "all").toLowerCase();
  const filterGenAi =
    req.body.filterGenAi !== undefined
      ? req.body.filterGenAi !== false
      : process.env.FILTER_GENAI !== "false";

  try {
    const out = {};
    for (const q of queries.slice(0, 10)) {
      const pins = await runSearch({ q, limit, type, filterGenAi });
      pins.forEach((p) => (p.query = q));
      out[q] = pins;
    }
    res.json({ count: Object.keys(out).length, queries: out });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/download", async (req, res) => {
  const { url, name, dl } = req.query;
  if (!url) return res.status(400).json({ error: "Missing ?url=" });

  try {
    assertSafeUrl(url);
    const resolved = await resolveAsset(url);

    const headers = {
      "User-Agent": BROWSER_UA,
      Referer: "https://www.pinterest.com/",
      Origin: "https://www.pinterest.com",
      Accept: "*/*",
    };
    if (req.headers.range) headers.Range = req.headers.range; // let players seek

    const upstream = await fetch(resolved, { headers });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).end();
    }

    // trust the URL extension first — content-type is unreliable for video
    const pathExt = (
      new URL(resolved).pathname.match(/\.(mp4|webm|mov|m4v|jpg|jpeg|png|gif|webp|avif)$/i) || []
    )[1];
    const ct = upstream.headers.get("content-type") || "";
    const ext =
      pathExt ||
      (ct.includes("video") ? "mp4" : ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg");

    const filename = name
      ? `${String(name).replace(/[^\w\-]/g, "_").slice(0, 80)}.${ext}`
      : (new URL(resolved).pathname.split("/").pop() || `file.${ext}`);

    res.status(upstream.status); // preserve 206 Partial Content
    res.setHeader("Content-Type", ct || (ext === "mp4" ? "video/mp4" : "image/jpeg"));
    res.setHeader("Cache-Control", "public, max-age=86400");
    if (dl !== "0") {
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    }

    // forward length/range only when the body wasn't transparently decompressed
    const cl = upstream.headers.get("content-length");
    if (cl && !upstream.headers.get("content-encoding")) {
      res.setHeader("Content-Length", cl);
    }
    const cr = upstream.headers.get("content-range");
    if (cr) res.setHeader("Content-Range", cr);
    if (upstream.headers.get("accept-ranges")) {
      res.setHeader("Accept-Ranges", "bytes");
    }

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/random", async (req, res) => {
  const { q, type, filterGenAi } = parseOpts(req);
  if (!q) return res.status(400).json({ error: "Missing ?q=" });

  try {
    const pins = await runSearch({ q, limit: 100, type, filterGenAi });
    const pool = pins.filter((p) => (type === "video" ? p.video_url : p.image_url));
    if (!pool.length) return res.status(404).json({ error: "No results" });

    const pick = pool[Math.floor(Math.random() * pool.length)];
    const asset = pick.video_url || pick.image_url;

    // bounce through our own proxy so Pinterest receives the Referer it wants
    res.redirect(
      `/api/download?url=${encodeURIComponent(asset)}&name=${encodeURIComponent(q + "_" + pick.id)}`
    );
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/zip", async (req, res) => {
  const { q, limit, type, filterGenAi } = parseOpts(req);
  if (!q) return res.status(400).json({ error: "Missing ?q=" });

  const cap = Math.min(limit, 60); // keep memory sane on Render free tier

  try {
    const pins = await runSearch({ q, limit: cap, type, filterGenAi });
    const items = pins
      .map((p) => {
        const url = p.video_url || p.image_url;
        if (!url) return null;
        const ext = p.video_url ? "mp4" : "jpg";
        return { url, name: `${q}_${p.id}`.replace(/[^\w\-]/g, "_").slice(0, 80) + "." + ext };
      })
      .filter(Boolean);

    if (!items.length) return res.status(404).json({ error: "No downloadable assets" });

    const safe = q.replace(/[^\w\-]/g, "_").slice(0, 50);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}.zip"`);

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", (e) => res.destroy(e));
    archive.pipe(res);

    const headers = { "User-Agent": BROWSER_UA, Referer: "https://www.pinterest.com/" };
    let i = 0;
    async function worker() {
      while (i < items.length) {
        const item = items[i++];
        try {
          const target = await resolveAsset(item.url);
          const r = await fetch(target, { headers });
          if (!r.ok) continue;
          archive.append(Buffer.from(await r.arrayBuffer()), { name: item.name });
        } catch { /* skip broken asset */ }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    await archive.finalize();
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message });
  }
});

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8">
<title>Pinterest API</title>
<style>body{font:15px/1.6 system-ui;max-width:640px;margin:60px auto;padding:0 20px}
code{background:#f2f2f2;padding:2px 6px;border-radius:4px}</style></head><body>
<h1>Pinterest Scraper API</h1>
<ul>
<li><code>/api/search?q=halftone%20poster&amp;limit=30&amp;type=image</code></li>
<li><code>/api/search?q=lofi&amp;type=video</code></li>
<li><code>/api/random?q=nature&amp;type=video</code></li>
<li><code>/api/download?url=&lt;pinimg url&gt;&amp;name=myfile</code></li>
<li><code>/api/zip?q=acid%20graphics&amp;limit=40</code></li>
<li><code>POST /api/search</code> with <code>{"queries":["a","b"]}</code></li>
</ul>
<p>Add <code>&amp;filterGenAi=false</code> to any search to disable the Less-AI filter.</p>
</body></html>`);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Listening on 0.0.0.0:${PORT}`);
  getScraper().catch((e) => console.error("Warm-up failed:", e.message));
});