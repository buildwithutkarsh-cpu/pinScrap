(() => {
  const state = {
    query: "",
    filter: "all",
    filterGenAi: true,
    pins: [],
    selected: new Set(),
    requestId: 0,
    loading: false,
    adminKey: "",
    createdKey: "",
  };
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    api: $("#api-indicator"),
    apiLabel: $("#api-label"),
    engine: $("#engine-status"),
    homeForm: $("#search-form"),
    homeInput: $("#search-input"),
    resultsForm: $("#results-form"),
    queryInput: $("#query-input"),
    status: $("#scrape-status"),
    statusMessage: $("#scrape-message"),
    progress: $("#scrape-progress"),
    count: $("#result-count"),
    exportLabel: $("#export-label"),
    selectAll: $("#select-all"),
    selectAllLabel: $("#select-all-label"),
    zip: $("#download-all"),
    zipCount: $("#zip-count"),
    tabs: [...document.querySelectorAll(".filter-tab")],
    aiHome: $("#ai-filter-home"),
    aiResults: $("#ai-filter-results"),
    sort: $("#sort-results"),
    grid: $("#masonry-grid"),
    empty: $("#empty-state"),
    emptyTitle: $("#empty-title"),
    emptyCopy: $("#empty-copy"),
    error: $("#error-message"),
    jobStatus: $("#job-status"),
    endpoint: $("#job-endpoint"),
    typeSummary: $("#result-type-summary"),
    bulk: $("#bulk-bar"),
    bulkCount: $("#bulk-count"),
    toast: $("#toast"),
    apiKeyInput: $("#api-key-input"),
    apiKeyMessage: $("#api-key-message"),
    adminMessage: $("#admin-message"),
    keyList: $("#key-list"),
  };
  let toastTimer;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2400);
  }

  async function adminRequest(url, init = {}) {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        "X-PinScrap-Admin-Key": state.adminKey,
      },
    });
    if (!response.ok) throw new Error(await responseError(response));
    return response;
  }

  function renderKeyList(keys) {
    if (!keys.length) {
      elements.keyList.innerHTML = '<p class="key-list-empty">No API keys yet. Create one above to connect an MCP client.</p>';
      return;
    }

    elements.keyList.innerHTML = keys.map((key) => {
      const revoked = Boolean(key.revoked_at);
      const date = new Date(key.created_at).toLocaleDateString();
      const lastUsed = key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "Never";
      return `<article class="managed-key${revoked ? " is-revoked" : ""}">
        <div class="managed-key-main"><span class="key-status-dot${revoked ? " is-revoked" : ""}"></span>
          <div><h3>${escapeHtml(key.name)}</h3><p><code>${escapeHtml(key.key_prefix)}••••••••</code><span>Created ${escapeHtml(date)}</span><span>Last used ${escapeHtml(lastUsed)}</span></p></div>
        </div>
        ${revoked ? '<span class="revoked-label">Revoked</span>' : `<button class="revoke-key" type="button" data-revoke="${escapeHtml(key.id)}" data-name="${escapeHtml(key.name)}">Revoke</button>`}
      </article>`;
    }).join("");
  }

  async function refreshKeys() {
    const response = await adminRequest("/api/keys");
    const data = await response.json();
    renderKeyList(Array.isArray(data.keys) ? data.keys : []);
  }

  async function unlockAdmin(event) {
    event.preventDefault();
    state.adminKey = $("#admin-secret").value;
    elements.adminMessage.textContent = "Checking admin access…";
    try {
      await refreshKeys();
      elements.adminMessage.textContent = "Key management unlocked.";
      $("#admin-secret").value = "";
      $("#admin-secret").disabled = true;
      $("#admin-unlock-form button[type=submit]").hidden = true;
      $("#admin-lock").hidden = false;
      $("#create-key-panel").hidden = false;
      $("#key-list-panel").hidden = false;
    } catch (error) {
      state.adminKey = "";
      elements.adminMessage.textContent = error.message;
    }
  }

  function dashboardApiKey() {
    return sessionStorage.getItem("pinscrap-api-key") || "";
  }

  function apiHeaders(headers = {}) {
    const result = new Headers(headers);
    const key = dashboardApiKey();
    if (key) result.set("X-API-Key", key);
    return result;
  }

  async function apiRequest(url, init = {}) {
    return fetch(url, { ...init, headers: apiHeaders(init.headers) });
  }

  async function responseError(response) {
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return body?.error || `Request failed with HTTP ${response.status}.`;
  }

  async function saveDownload(url, fallbackName) {
    const response = await apiRequest(url);
    if (!response.ok) throw new Error(await responseError(response));
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const headerName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = headerName || fallbackName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function setView(view) {
    const ids = {
      search: "search-screen",
      results: "results-screen",
      keys: "keys-screen",
      docs: "docs-screen",
    };
    if (!ids[view]) return;
    Object.entries(ids).forEach(([key, id]) => {
      $(`#${id}`).hidden = key !== view;
    });
    document.querySelectorAll(".nav-link").forEach((link) => {
      const active = link.dataset.view === view;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (view === "results") elements.queryInput.value = state.query;
    if (view === "keys") elements.apiKeyInput.value = dashboardApiKey();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setApiStatus(online, health) {
    elements.api.classList.toggle("is-offline", !online);
    elements.apiLabel.textContent = online ? "API v1.2 Online" : "API Offline";
    elements.engine.textContent = online ? "Connected" : "Unavailable";
    $(".engine-pill").classList.toggle("is-offline", !online);
    if (online && health) {
      $("#health-cache").textContent = `${health.cached} cached searches`;
      $("#health-uptime").textContent = `API uptime ${Math.floor(health.uptime)}s`;
    } else {
      $("#health-cache").textContent = "API not reachable";
      $("#health-uptime").textContent = "Check server connection";
    }
  }

  async function checkHealth() {
    try {
      const response = await fetch("/health", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Health check returned ${response.status}`);
      const health = await response.json();
      setApiStatus(health.ok === true, health);
    } catch {
      setApiStatus(false);
    }
  }

  function currentPins() {
    const visible = state.filter === "all"
      ? state.pins
      : state.pins.filter((pin) => state.filter === "video"
        ? pin.type === "video" || Boolean(pin.video_url)
        : pin.type === "image" || (!pin.video_url && Boolean(pin.image_url)));
    if (elements.sort.value === "title") {
      return [...visible].sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
    }
    return visible;
  }

  function cardIdentity(pin, index) {
    return String(pin.id || pin.pin_url || pin.link || `pin-${index}`);
  }

  function updateCounts() {
    const images = state.pins.filter((pin) => pin.type === "image" || (!pin.video_url && pin.image_url)).length;
    const videos = state.pins.filter((pin) => pin.type === "video" || Boolean(pin.video_url)).length;
    const visibleCount = currentPins().length;
    const counts = { all: state.pins.length, image: images, video: videos };
    elements.tabs.forEach((tab) => {
      tab.querySelector("[data-count]").textContent = `(${counts[tab.dataset.filter]})`;
    });
    const shownImages = state.filter === "video" ? 0 : images;
    const shownVideos = state.filter === "image" ? 0 : videos;
    elements.count.textContent = `${visibleCount} results found (${shownImages} images, ${shownVideos} videos)`;
    elements.typeSummary.textContent = `${images} images · ${videos} videos`;
    elements.zipCount.textContent = `(${Math.min(visibleCount, 60)} assets)`;
  }

  function mediaUrl(pin) {
    return pin.video_url || pin.image_url || "";
  }

  function assetDownloadUrl(pin) {
    const url = mediaUrl(pin);
    return `/api/download?${new URLSearchParams({ url, name: `${state.query || "pin"}_${pin.id || "asset"}` })}`;
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function createPinCard(pin, index) {
    const id = cardIdentity(pin, index);
    const isVideo = pin.type === "video" || Boolean(pin.video_url);
    const title = pin.title || pin.description || "Untitled pin";
    const creator = pin.pinner_username ? `@${pin.pinner_username}` : (pin.pinner_name || "Pinterest");
    const pinLink = safeHttpUrl(pin.pin_url || pin.link);
    const preview = safeHttpUrl(pin.thumbnail_url || pin.image_url);
    const selected = state.selected.has(id);
    const media = preview
      ? `<img src="${escapeHtml(preview)}" alt="${escapeHtml(title)}" loading="lazy" referrerpolicy="no-referrer">`
      : '<div class="pin-fallback">Preview unavailable</div>';
    const source = pinLink
      ? `<a class="pin-action" href="${escapeHtml(pinLink)}" target="_blank" rel="noopener noreferrer" aria-label="Open pin on Pinterest" title="Open on Pinterest"><svg viewBox="0 0 24 24"><path d="M13.5 5.5h5v5m-.5-4.5-7.2 7.2"/><path d="M18 13.5v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h4"/></svg></a>`
      : "";
    return `<article class="pin-card${selected ? " is-selected" : ""}" data-pin-id="${escapeHtml(id)}">
      <div class="pin-media">${media}
        <span class="pin-badge${isVideo ? " video" : ""}"><span aria-hidden="true">${isVideo ? "▶" : "▧"}</span> ${isVideo ? "VIDEO" : "IMAGE"}</span>
        <button class="pin-check" type="button" data-action="select" aria-label="${selected ? "Deselect" : "Select"} ${escapeHtml(title)}" aria-pressed="${selected}"></button>
      </div>
      <div class="pin-info">
        <div class="pin-byline"><span class="creator" title="${escapeHtml(creator)}">${escapeHtml(creator)}</span>${pin.board ? `<span class="board" title="${escapeHtml(pin.board)}">${escapeHtml(pin.board)}</span>` : ""}</div>
        <h2 class="pin-title">${escapeHtml(title)}</h2>
        <div class="pin-actions">
          <span class="asset-kind"><span aria-hidden="true">${isVideo ? "▣" : "⇩"}</span>${isVideo ? "MP4" : "JPG"}</span>
          <span class="pin-spacer"></span>
          <button class="pin-action" type="button" data-download-url="${escapeHtml(assetDownloadUrl(pin))}" data-download-name="${escapeHtml(title.replace(/[^\w-]+/g, "_"))}" aria-label="Download ${escapeHtml(title)}" title="Download ${isVideo ? "video" : "image"}"><svg viewBox="0 0 24 24"><path d="M12 3.5v11m0 0 4-4m-4 4-4-4M5 16.5v3h14v-3"/></svg></button>
          ${source}
        </div>
      </div>
    </article>`;
  }

  function renderResults() {
    const pins = currentPins();
    elements.grid.innerHTML = pins.map(createPinCard).join("");
    elements.grid.hidden = !pins.length || state.loading || Boolean(elements.error.textContent);
    elements.empty.hidden = pins.length > 0 || state.loading || Boolean(elements.error.textContent);
    elements.selectAll.disabled = !pins.length;
    const allSelected = pins.length > 0 && pins.every((pin, index) => state.selected.has(cardIdentity(pin, index)));
    elements.selectAllLabel.textContent = allSelected ? "Deselect All" : `Select All (${pins.length})`;
    elements.selectAll.setAttribute("aria-pressed", String(allSelected));
    const selectedVisible = pins.filter((pin, index) => state.selected.has(cardIdentity(pin, index))).length;
    elements.bulkCount.textContent = `${selectedVisible} ${selectedVisible === 1 ? "item" : "items"} selected`;
    elements.bulk.hidden = selectedVisible === 0;
    elements.zip.classList.toggle("is-disabled", pins.length === 0 || state.loading);
    elements.zip.setAttribute("aria-disabled", String(pins.length === 0 || state.loading));
    if (pins.length && state.query) {
      const params = new URLSearchParams({
        q: state.query,
        limit: String(Math.min(pins.length, 60)),
        type: state.filter,
        filterGenAi: String(state.filterGenAi),
      });
      elements.zip.href = `/api/zip?${params}`;
    } else {
      elements.zip.href = "#";
    }
  }

  function setLoading(loading) {
    state.loading = loading;
    $("#search-button").disabled = loading;
    const resultsSubmit = elements.resultsForm.querySelector('button[type="submit"]');
    if (resultsSubmit) resultsSubmit.disabled = loading;
    elements.grid.setAttribute("aria-busy", String(loading));
    elements.status.hidden = !loading;
    if (loading) {
      elements.statusMessage.textContent = `Resolving Pinterest results for “${state.query}”…`;
      elements.progress.style.width = "35%";
      elements.grid.innerHTML = '<div class="loading-tile"></div>'.repeat(8);
      elements.grid.hidden = false;
      elements.empty.hidden = true;
      elements.jobStatus.textContent = "Searching Pinterest…";
      elements.exportLabel.textContent = "Preparing results";
    } else {
      elements.progress.style.width = "100%";
      elements.status.hidden = true;
    }
  }

  async function search(query) {
    const term = query.trim();
    if (!term) {
      $("#search-input").focus();
      return;
    }
    state.query = term;
    state.selected.clear();
    elements.error.textContent = "";
    elements.error.hidden = true;
    elements.homeInput.value = term;
    elements.queryInput.value = term;
    setView("results");
    const requestId = ++state.requestId;
    setLoading(true);
    elements.endpoint.textContent = `/api/search?q=${encodeURIComponent(term)}`;

    const params = new URLSearchParams({
      q: term,
      limit: "60",
      type: "all",
      filterGenAi: String(state.filterGenAi),
    });
    const started = performance.now();
    try {
      const response = await apiRequest(`/api/search?${params}`, { headers: { Accept: "application/json" } });
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error(`Search returned an invalid response (HTTP ${response.status}).`);
      }
      if (requestId !== state.requestId) return;
      if (!response.ok) {
        const detail = body.error || `Search failed with HTTP ${response.status}.`;
        if (response.status === 401) {
          throw new Error(`${detail} Open API Keys to connect a PinScrap key.`);
        }
        throw new Error(detail);
      }
      if (!Array.isArray(body.results)) throw new Error("The API response did not include a results list.");
      state.pins = body.results;
      state.selected.clear();
      const elapsed = Math.round(performance.now() - started);
      elements.jobStatus.textContent = `Scrape job finished in ${elapsed}ms · ${state.pins.length} results`;
      elements.exportLabel.textContent = state.pins.length ? "Ready for export" : "No assets to export";
      elements.emptyTitle.textContent = "No pins found";
      elements.emptyCopy.textContent = `No Pinterest results were found for “${term}”. Try another query.`;
      updateCounts();
      setApiStatus(true);
    } catch (error) {
      if (requestId !== state.requestId) return;
      state.pins = [];
      elements.error.textContent = error.message || "The search could not be completed.";
      elements.error.hidden = false;
      elements.count.textContent = "Search failed";
      elements.jobStatus.textContent = "Pinterest search failed";
      elements.exportLabel.textContent = "Search unavailable";
      elements.empty.hidden = true;
      setApiStatus(false);
    } finally {
      if (requestId === state.requestId) {
        setLoading(false);
        renderResults();
      }
    }
  }

  function setAiFilter(enabled) {
    state.filterGenAi = enabled;
    elements.aiHome.setAttribute("aria-pressed", String(enabled));
    elements.aiHome.classList.toggle("is-dark", enabled);
    $("#ai-label-home").textContent = enabled ? "On" : "Off";
    elements.aiResults.checked = enabled;
    if (state.query) search(state.query);
  }

  function downloadSelected() {
    const selected = currentPins().filter((pin, index) => state.selected.has(cardIdentity(pin, index)));
    if (!selected.length) return;
    selected.reduce((chain, pin) => chain.then(async () => {
      await saveDownload(assetDownloadUrl(pin), `${state.query || "pin"}_${pin.id || "asset"}`);
    }), Promise.resolve()).catch((error) => {
      showToast(error.message);
    });
    showToast(`Starting ${selected.length} individual download${selected.length === 1 ? "" : "s"}.`);
    state.selected.clear();
    renderResults();
  }

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (button.tagName === "A") event.preventDefault();
      setView(button.dataset.view);
    });
  });

  elements.homeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    search(elements.homeInput.value);
  });
  elements.resultsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    search(elements.queryInput.value);
  });
  document.querySelectorAll("[data-query]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.homeInput.value = button.dataset.query;
      search(button.dataset.query);
    });
  });
  $("#ai-filter-home").addEventListener("click", () => setAiFilter(!state.filterGenAi));
  elements.aiResults.addEventListener("change", () => setAiFilter(elements.aiResults.checked));

  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.filter = tab.dataset.filter;
      elements.tabs.forEach((item) => item.classList.toggle("is-active", item === tab));
      if (state.query) {
        updateCounts();
        renderResults();
      }
    });
  });
  elements.sort.addEventListener("change", renderResults);
  $("#clear-search").addEventListener("click", () => {
    elements.queryInput.value = "";
    elements.queryInput.focus();
  });
  elements.selectAll.addEventListener("click", () => {
    const pins = currentPins();
    const allSelected = pins.length && pins.every((pin, index) => state.selected.has(cardIdentity(pin, index)));
    pins.forEach((pin, index) => {
      const id = cardIdentity(pin, index);
      if (allSelected) state.selected.delete(id);
      else state.selected.add(id);
    });
    renderResults();
  });
  $("#clear-selection").addEventListener("click", () => {
    state.selected.clear();
    renderResults();
  });
  $("#download-selected").addEventListener("click", downloadSelected);
  $("#admin-unlock-form").addEventListener("submit", unlockAdmin);
  $("#admin-lock").addEventListener("click", () => {
    state.adminKey = "";
    state.createdKey = "";
    $("#admin-secret").disabled = false;
    $("#admin-unlock-form button[type=submit]").hidden = false;
    $("#admin-lock").hidden = true;
    $("#create-key-panel").hidden = true;
    $("#key-list-panel").hidden = true;
    $("#new-key-reveal").hidden = true;
    elements.adminMessage.textContent = "Key management locked.";
  });
  $("#create-key-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    elements.adminMessage.textContent = "Creating API key…";
    try {
      const response = await adminRequest("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: $("#new-key-name").value.trim() }),
      });
      const data = await response.json();
      if (!data.key || !data.record) throw new Error("Server did not return the newly created key.");
      state.createdKey = data.key;
      $("#new-key-value").textContent = data.key;
      $("#new-key-reveal").hidden = false;
      $("#key-copy-message").textContent = "Copy and store this key securely. It cannot be revealed again.";
      $("#new-key-name").value = "";
      elements.adminMessage.textContent = "API key created.";
      await refreshKeys();
    } catch (error) {
      elements.adminMessage.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  $("#refresh-keys").addEventListener("click", () => {
    refreshKeys().then(() => {
      elements.adminMessage.textContent = "Key list updated.";
    }).catch((error) => {
      elements.adminMessage.textContent = error.message;
    });
  });
  elements.keyList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-revoke]");
    if (!button || !window.confirm(`Revoke the API key “${button.dataset.name}”? This cannot be undone.`)) return;
    button.disabled = true;
    try {
      await adminRequest(`/api/keys/${encodeURIComponent(button.dataset.revoke)}`, { method: "DELETE" });
      elements.adminMessage.textContent = `Revoked “${button.dataset.name}”.`;
      await refreshKeys();
    } catch (error) {
      button.disabled = false;
      elements.adminMessage.textContent = error.message;
    }
  });
  $("#copy-new-key").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.createdKey);
      $("#key-copy-message").textContent = "API key copied to clipboard.";
    } catch {
      $("#key-copy-message").textContent = "Clipboard access unavailable. Select and copy the key text.";
    }
  });
  $("#use-new-key").addEventListener("click", async () => {
    try {
      const response = await fetch("/api/keys/verify", {
        headers: { "X-API-Key": state.createdKey },
      });
      if (!response.ok) throw new Error(await responseError(response));
      sessionStorage.setItem("pinscrap-api-key", state.createdKey);
      elements.apiKeyInput.value = state.createdKey;
      elements.apiKeyMessage.textContent = "API key connected in this browser tab.";
      $("#key-copy-message").textContent = "Connected for dashboard use. Copy it separately for your MCP client.";
    } catch (error) {
      $("#key-copy-message").textContent = error.message;
    }
  });
  $("#api-key-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = elements.apiKeyInput.value.trim();
    elements.apiKeyMessage.textContent = "Verifying API key…";
    try {
      const response = await fetch("/api/keys/verify", { headers: { "X-API-Key": key } });
      if (!response.ok) throw new Error(await responseError(response));
      sessionStorage.setItem("pinscrap-api-key", key);
      elements.apiKeyMessage.textContent = "API key verified. Protected dashboard requests are enabled for this tab.";
      showToast("PinScrap API key connected.");
    } catch (error) {
      elements.apiKeyMessage.textContent = error.message;
    }
  });
  $("#clear-api-key").addEventListener("click", () => {
    sessionStorage.removeItem("pinscrap-api-key");
    elements.apiKeyInput.value = "";
    elements.apiKeyMessage.textContent = "Dashboard API key disconnected.";
  });

  elements.grid.addEventListener("click", (event) => {
    const downloadButton = event.target.closest("[data-download-url]");
    if (downloadButton) {
      saveDownload(downloadButton.dataset.downloadUrl, downloadButton.dataset.downloadName || "pinscrap_asset")
        .catch((error) => showToast(error.message));
      return;
    }
    const button = event.target.closest('[data-action="select"]');
    if (!button) return;
    const id = button.closest("[data-pin-id]")?.dataset.pinId;
    if (!id) return;
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    renderResults();
  });
  elements.grid.addEventListener("error", (event) => {
    if (!(event.target instanceof HTMLImageElement)) return;
    event.target.classList.add("is-broken");
    const fallback = document.createElement("div");
    fallback.className = "pin-fallback";
    fallback.textContent = "Preview unavailable";
    event.target.parentElement.prepend(fallback);
  }, true);
  elements.zip.addEventListener("click", (event) => {
    if (elements.zip.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    elements.exportLabel.textContent = "Preparing ZIP download…";
    saveDownload(elements.zip.href, `${state.query || "pinscrap"}.zip`)
      .then(() => {
        elements.exportLabel.textContent = "ZIP download complete";
      })
      .catch((error) => {
        elements.exportLabel.textContent = "ZIP download failed";
        showToast(error.message);
      });
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setView("search");
      elements.homeInput.focus();
      elements.homeInput.select();
    }
  });

  checkHealth();
})();
