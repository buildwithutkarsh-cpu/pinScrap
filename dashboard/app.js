(() => {
  const state = {
    query: "",
    filter: "all",
    filterGenAi: true,
    pins: [],
    selected: new Set(),
    requestId: 0,
    loading: false,
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

  function setView(view) {
    const ids = { search: "search-screen", results: "results-screen", docs: "docs-screen" };
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
          <a class="pin-action" href="${escapeHtml(assetDownloadUrl(pin))}" aria-label="Download ${escapeHtml(title)}" title="Download ${isVideo ? "video" : "image"}"><svg viewBox="0 0 24 24"><path d="M12 3.5v11m0 0 4-4m-4 4-4-4M5 16.5v3h14v-3"/></svg></a>
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
      const response = await fetch(`/api/search?${params}`, { headers: { Accept: "application/json" } });
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error(`Search returned an invalid response (HTTP ${response.status}).`);
      }
      if (requestId !== state.requestId) return;
      if (!response.ok) throw new Error(body.error || `Search failed with HTTP ${response.status}.`);
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
    selected.forEach((pin, index) => {
      setTimeout(() => {
        const link = document.createElement("a");
        link.href = assetDownloadUrl(pin);
        document.body.append(link);
        link.click();
        link.remove();
      }, index * 300);
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

  elements.grid.addEventListener("click", (event) => {
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
    elements.exportLabel.textContent = "ZIP download started";
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
