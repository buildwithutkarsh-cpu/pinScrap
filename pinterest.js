const fs = require("fs");
const path = require("path");

class PinterestScraper {
  static SEARCH_URL = "https://www.pinterest.com/resource/BaseSearchResource/get/";
  static HOME = "https://www.pinterest.com/";

  constructor({
    delay = 1200,
    useFallback = true,
    aiHeuristic = true,
    filterGenAi = true,
  } = {}) {
    this.delay = delay;
    this.useFallback = useFallback;
    this.aiHeuristic = aiHeuristic;
    this.filterGenAi = filterGenAi;
    this.cookies = {};
    this.baseHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/122.0.0.0 Safari/537.36",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
      "X-APP-VERSION": "c8b0a3d",
      Referer: "https://www.pinterest.com/",
      Origin: "https://www.pinterest.com",
      "X-Pinterest-AppState": "active",
      "X-Pinterest-PWS-Handler": "www/[search].js",
    };
  }

  static sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  get cookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  }

  // filterGenAi is passed in so concurrent requests never stomp each other.
  buildSearchUrl(query, filterGenAi = this.filterGenAi) {
    let url = `/search/pins/?q=${encodeURIComponent(query)}&rs=typed`;
    if (filterGenAi) url += "&filter_genai=true";
    return url;
  }

  // Optional. Anonymous warm-up in init() is enough on its own.
  loadSessionCookies() {
    if (process.env.PINTEREST_COOKIE) {
      for (const pair of process.env.PINTEREST_COOKIE.split(";")) {
        const idx = pair.indexOf("=");
        if (idx === -1) continue;
        this.cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
      }
      console.log("Loaded session from PINTEREST_COOKIE env var.");
      return;
    }
    const file = "cookies.txt";
    if (fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
        if (!line || line.startsWith("#")) continue;
        const p = line.split("\t");
        if (p.length >= 7) this.cookies[p[5].trim()] = p[6].trim();
      }
      console.log(`Loaded ${Object.keys(this.cookies).length} cookies from ${file}.`);
    } else {
      console.warn("No cookies found. Running anonymously (filter_genai may be ignored).");
    }
  }

  _absorbCookies(res) {
    const raw =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : (res.headers.get("set-cookie") || "").split(/,(?=[^;]+=)/);
    for (const line of raw) {
      if (!line) continue;
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      if (idx === -1) continue;
      this.cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }

  async init() {
    this.loadSessionCookies();
    const headers = {
      "User-Agent": this.baseHeaders["User-Agent"],
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: this.cookieHeader,
    };
    let res = await fetch(PinterestScraper.HOME, { headers, redirect: "follow" });
    this._absorbCookies(res);
    await res.text();
    if (!this.cookies.csrftoken) {
      res = await fetch(PinterestScraper.HOME, {
        headers: { ...headers, Cookie: this.cookieHeader },
      });
      this._absorbCookies(res);
      await res.text();
    }
    console.log(
      `Warm-up done. csrftoken: ${this.cookies.csrftoken ? "OK" : "MISSING"} | ` +
        `logged in: ${this.cookies._pinterest_sess ? "YES" : "NO"} | ` +
        `filter_genai default: ${this.filterGenAi}`
    );
    return this;
  }

  async _request(query, bookmark = null, pageSize = 25, filterGenAi = this.filterGenAi) {
    const options = { query, scope: "pins", page_size: pageSize };
    if (bookmark) options.bookmarks = [bookmark];
    if (filterGenAi) options.filter_genai = true;

    const sourceUrl = this.buildSearchUrl(query, filterGenAi);

    const params = new URLSearchParams({
      source_url: sourceUrl,
      data: JSON.stringify({ options, context: {} }),
      _: Date.now().toString(),
    });
    if (filterGenAi) params.set("filter_genai", "true");

    const headers = { ...this.baseHeaders, Cookie: this.cookieHeader };
    if (this.cookies.csrftoken) headers["X-CSRFToken"] = this.cookies.csrftoken;

    const res = await fetch(`${PinterestScraper.SEARCH_URL}?${params}`, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} for "${query}". ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    this._absorbCookies(res);
    return json;
  }

  async searchHtml(query, { maxPins = 25, filterGenAi = this.filterGenAi } = {}) {
    const url = `https://www.pinterest.com${this.buildSearchUrl(query, filterGenAi)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": this.baseHeaders["User-Agent"],
        Accept: "text/html,application/xhtml+xml",
        Cookie: this.cookieHeader,
      },
    });
    if (!res.ok) throw new Error(`HTML HTTP ${res.status} for "${query}"`);
    const html = await res.text();
    const match = html.match(/<script id="__PWS_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) throw new Error("No __PWS_DATA__ found");
    const pws = JSON.parse(match[1]);
    const state = pws?.props?.initialReduxState?.pins || {};
    const pins = [];
    for (const id of state.results || []) {
      const raw = state.entities?.[id];
      if (raw) pins.push(PinterestScraper.parsePin(raw));
      if (pins.length >= maxPins) break;
    }
    return pins;
  }

  // Extracts video URLs alongside images.
  static parsePin(raw) {
    const images = raw.images || {};
    const pinner = raw.pinner || {};
    const videos = raw.videos?.video_list || {};

    const video_url =
      videos.V_720P?.url ||
      videos.V_540P?.url ||
      videos.V_HLSV4?.url ||
      null;

    const image_url =
      images?.orig?.url || images?.["736x"]?.url || images?.["564x"]?.url || null;

    return {
      id: raw.id,
      type: video_url ? "video" : "image",
      title: raw.grid_title || raw.title || "",
      description: raw.description || "",
      link: raw.link || "",
      image_url,
      video_url,
      thumbnail_url: images?.["236x"]?.url || image_url,
      pin_url: raw.id ? `https://www.pinterest.com/pin/${raw.id}/` : null,
      width: images?.orig?.width ?? null,
      height: images?.orig?.height ?? null,
      pinner_username: pinner.username || "",
      pinner_name: pinner.full_name || "",
      board: raw.board?.name || "",
    };
  }

  static looksLikeAi(pin) {
    const text = `${pin.title} ${pin.description}`.toLowerCase();
    return [
      "ai generated", "ai-generated", "generated by ai", "midjourney",
      "stable diffusion", "dall-e", "dalle", "ai art", "ai render",
      "prompt:", "ai design", "text to image", "genai",
    ].some((s) => text.includes(s));
  }

  async search(query, { maxPins = 100, pageSize = 25, type = "all", filterGenAi } = {}) {
    const fg = filterGenAi === undefined ? this.filterGenAi : filterGenAi;

    let pins;
    try {
      pins = await this._searchJson(query, { maxPins, pageSize, type, filterGenAi: fg });
    } catch (err) {
      if (!this.useFallback) throw err;
      console.warn(`[${query}] JSON failed (${err.message}). HTML fallback...`);
      pins = await this.searchHtml(query, { maxPins, filterGenAi: fg });
    }

    if (this.aiHeuristic) {
      const before = pins.length;
      pins = pins.filter((p) => !PinterestScraper.looksLikeAi(p));
      console.log(`[${query}] heuristic dropped ${before - pins.length} AI-looking pins.`);
    }

    if (type === "image" || type === "video") {
      pins = pins.filter((p) => p.type === type);
    }
    return pins;
  }

  async _searchJson(query, { maxPins = 100, pageSize = 25, type = "all", filterGenAi = this.filterGenAi } = {}) {
    const collected = [];
    let bookmark = null;
    while (collected.length < maxPins) {
      const payload = await this._request(query, bookmark, pageSize, filterGenAi);
      const data = payload?.resource_response?.data || {};
      const results = data.results || [];
      bookmark = data.bookmark;
      if (results.length === 0) break;

      for (const item of results) {
        if (item.type !== "pin" && item.type !== "story") continue;
        const parsed = PinterestScraper.parsePin(item);
        if (type === "video" && !parsed.video_url) continue;
        if (type === "image" && parsed.type === "video") continue;
        collected.push(parsed);
        if (collected.length >= maxPins) break;
      }
      console.log(`[${query}] collected ${collected.length} pins...`);
      if (!bookmark) break;
      await PinterestScraper.sleep(this.delay);
    }
    return collected;
  }

  async searchMany(queries, opts = {}) {
    const all = [];
    for (const q of queries) {
      const pins = await this.search(q, opts);
      for (const pin of pins) {
        pin.query = q;
        all.push(pin);
      }
      await PinterestScraper.sleep(this.delay);
    }
    return all;
  }
}

// ---------- helpers (CLI use) ----------
function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function saveCsv(pins, fp) {
  if (!pins.length) return console.log("No pins.");
  const fields = ["query", "id", "title", "description", "link",
    "image_url", "pinner_username", "pinner_name", "board"];
  const lines = [fields.join(",")];
  for (const p of pins) lines.push(fields.map((f) => csvEscape(p[f])).join(","));
  fs.writeFileSync(fp, lines.join("\n"), "utf-8");
  console.log(`Saved ${pins.length} -> ${fp}`);
}
function saveJson(pins, fp) {
  fs.writeFileSync(fp, JSON.stringify(pins, null, 2), "utf-8");
  console.log(`Saved ${pins.length} -> ${fp}`);
}
async function downloadImages(pins, folder = "images", concurrency = 5) {
  fs.mkdirSync(folder, { recursive: true });
  const queue = pins.filter((p) => p.image_url);
  let i = 0;
  async function worker() {
    while (i < queue.length) {
      const pin = queue[i++];
      const name =
        `${pin.query}_${pin.id}`.replace(/[^\w\-]/g, "_").slice(0, 80) + ".jpg";
      try {
        const res = await fetch(pin.image_url);
        fs.writeFileSync(path.join(folder, name), Buffer.from(await res.arrayBuffer()));
      } catch (e) {
        console.warn(`Failed ${pin.image_url}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  console.log(`Images -> ${folder}/`);
}

module.exports = PinterestScraper;
module.exports.PinterestScraper = PinterestScraper;
module.exports.saveCsv = saveCsv;
module.exports.saveJson = saveJson;
module.exports.downloadImages = downloadImages;

// ---------- CLI ----------
async function cli() {
  const scraper = new PinterestScraper({ delay: 1200, filterGenAi: true, aiHeuristic: true });
  await scraper.init();
  const queries = ["thermal noise poster", "halftone poster", "acid graphics poster"];
  const pins = await scraper.searchMany(queries, { maxPins: 80 });
  if (!pins.length) return console.log("No pins collected.");
  saveCsv(pins, "pins.csv");
  saveJson(pins, "pins.json");
  await downloadImages(pins, "images", 5);
}

if (require.main === module) {
  cli().catch((e) => { console.error("Scrape failed:", e); process.exit(1); });
}