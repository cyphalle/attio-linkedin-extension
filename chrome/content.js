/**
 * Content script — overlay + orchestration.
 * Injected on linkedin.com/in/* pages.
 */
(() => {
  const EXT_ID = "attio-ext";
  let currentUrl = "";
  let overlay = null;

  // ── SPA navigation detection ──────────────────────────────────

  function init() {
    checkPage();
    // LinkedIn is a SPA — watch for URL changes via MutationObserver
    const observer = new MutationObserver(() => {
      if (window.location.href !== currentUrl) {
        checkPage();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function checkPage() {
    currentUrl = window.location.href;
    if (/linkedin\.com\/in\//.test(currentUrl)) {
      waitForElement("main h1", 10000).then(() => {
        runCheck();
      });
    } else {
      removeOverlay();
    }
  }

  // ── Main flow ─────────────────────────────────────────────────

  async function runCheck() {
    showOverlay("loading");

    const data = LinkedInScraper.scrapeAll();
    if (!data.fullName) {
      showOverlay("error", { message: "Could not read profile data." });
      return;
    }

    try {
      const res = await sendMessage({
        action: "CHECK_PERSON",
        linkedinUrl: data.linkedinUrl,
        firstName: data.firstName,
        lastName: data.lastName,
      });

      if (res.error) {
        showOverlay("error", {
          message: res.error,
          isApiKeyError: res.code === "NO_API_KEY" || res.status === 401,
        });
        return;
      }

      if (res.found) {
        const settings = await sendMessage({ action: "GET_SETTINGS" });
        showOverlay("found", { person: res.person, recordId: res.recordId, workspaceSlug: settings.workspaceSlug });
      } else {
        showOverlay("not-found", { scraped: data });
      }
    } catch (err) {
      showOverlay("error", { message: err.message });
    }
  }

  // ── Overlay rendering ─────────────────────────────────────────

  function showOverlay(state, data = {}) {
    removeOverlay();
    overlay = document.createElement("div");
    overlay.id = `${EXT_ID}-overlay`;
    overlay.className = `${EXT_ID}-panel`;
    overlay.innerHTML = renderState(state, data);
    document.body.appendChild(overlay);
    bindOverlayEvents(state, data);
  }

  function renderState(state, data) {
    const header = `<div class="${EXT_ID}-header">
      <span class="${EXT_ID}-logo">A</span>
      <span class="${EXT_ID}-title">Attio</span>
      <button class="${EXT_ID}-minimize" title="Minimize">&minus;</button>
    </div>`;

    switch (state) {
      case "loading":
        return `${header}
          <div class="${EXT_ID}-body">
            <div class="${EXT_ID}-spinner"></div>
            <p>Checking Attio…</p>
          </div>`;

      case "found": {
        const base = data.workspaceSlug
          ? `https://app.attio.com/${data.workspaceSlug}`
          : "https://app.attio.com";
        return `${header}
          <div class="${EXT_ID}-body">
            <div class="${EXT_ID}-badge ${EXT_ID}-badge-green">In CRM</div>
            ${fieldRow("Name", `${data.person.firstName || ""} ${data.person.lastName || ""}`.trim())}
            ${fieldRow("Title", data.person.jobTitle)}
            ${fieldRow("Email", data.person.email)}
            <a class="${EXT_ID}-btn ${EXT_ID}-btn-primary"
               href="${base}/person/${data.recordId}"
               target="_blank">Open in Attio</a>
          </div>`;
      }

      case "not-found":
        return `${header}
          <div class="${EXT_ID}-body">
            <div class="${EXT_ID}-badge ${EXT_ID}-badge-orange">Not in CRM</div>
            ${renderForm(data.scraped)}
          </div>`;

      case "error":
        return `${header}
          <div class="${EXT_ID}-body">
            <div class="${EXT_ID}-badge ${EXT_ID}-badge-red">Error</div>
            <p class="${EXT_ID}-error-msg">${escapeHtml(data.message || "Unknown error")}</p>
            ${data.isApiKeyError
              ? `<button class="${EXT_ID}-btn ${EXT_ID}-btn-secondary ${EXT_ID}-open-settings">Open Settings</button>`
              : `<button class="${EXT_ID}-btn ${EXT_ID}-btn-secondary ${EXT_ID}-retry">Retry</button>`
            }
          </div>`;

      case "minimized":
        return `<button class="${EXT_ID}-fab" title="Open Attio panel">A</button>`;

      default:
        return "";
    }
  }

  function renderForm(scraped) {
    const url = scraped.linkedinUrl || "";
    return `<form class="${EXT_ID}-form">
      <div class="${EXT_ID}-form-row">
        <input name="firstName" placeholder="First name" value="${escapeAttr(scraped.firstName || "")}">
        <input name="lastName" placeholder="Last name" value="${escapeAttr(scraped.lastName || "")}">
      </div>
      <input name="jobTitle" placeholder="Job title" value="${escapeAttr(scraped.jobTitle || "")}">
      <input name="company" placeholder="Company" value="${escapeAttr(scraped.company || "")}">
      <input name="email" placeholder="Email" value="${escapeAttr(scraped.email || "")}">
      <input name="linkedinUrl" value="${escapeAttr(url)}" readonly title="LinkedIn URL (auto-detected)">
      <div class="${EXT_ID}-form-row">
        <select name="listId" class="${EXT_ID}-list-select">
          <option value="">Loading lists…</option>
        </select>
        <select name="statusId" class="${EXT_ID}-status-select">
          <option value="">— status —</option>
        </select>
      </div>
      <button type="submit" class="${EXT_ID}-btn ${EXT_ID}-btn-primary">Add to Attio</button>
      <div class="${EXT_ID}-form-status"></div>
    </form>`;
  }

  // ── Event binding ─────────────────────────────────────────────

  function bindOverlayEvents(state, data) {
    if (!overlay) return;

    // Minimize
    const minBtn = overlay.querySelector(`.${EXT_ID}-minimize`);
    if (minBtn) {
      minBtn.addEventListener("click", () => showOverlay("minimized"));
    }

    // Restore from minimized
    const fab = overlay.querySelector(`.${EXT_ID}-fab`);
    if (fab) {
      fab.addEventListener("click", () => runCheck());
    }

    // Open settings
    const settingsBtn = overlay.querySelector(`.${EXT_ID}-open-settings`);
    if (settingsBtn) {
      settingsBtn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "GET_SETTINGS" }); // noop, just to verify
        window.open(chrome.runtime.getURL("options.html"), "_blank");
      });
    }

    // Retry
    const retryBtn = overlay.querySelector(`.${EXT_ID}-retry`);
    if (retryBtn) {
      retryBtn.addEventListener("click", () => runCheck());
    }

    // Form
    if (state === "not-found") {
      loadFormDropdowns(data.scraped);
      const form = overlay.querySelector(`.${EXT_ID}-form`);
      if (form) form.addEventListener("submit", (e) => handleSubmit(e, data.scraped));
    }
  }

  async function loadFormDropdowns(scraped) {
    try {
      // Load settings for defaults
      const settings = await sendMessage({ action: "GET_SETTINGS" });
      // Load lists
      const { lists } = await sendMessage({ action: "GET_LISTS" });
      const listSel = overlay?.querySelector(`.${EXT_ID}-list-select`);
      if (listSel && lists) {
        listSel.innerHTML = '<option value="">— select list —</option>';
        for (const list of lists) {
          const id = list.id?.list_id ?? list.id;
          const opt = document.createElement("option");
          opt.value = id;
          opt.textContent = list.name || id;
          if (id === settings.defaultListId) opt.selected = true;
          listSel.appendChild(opt);
        }
        // Load statuses for default/selected list
        const selectedListId = listSel.value;
        if (selectedListId) {
          await loadStatusOptions(selectedListId, settings.defaultStatusId);
        }
        listSel.addEventListener("change", () => {
          if (listSel.value) loadStatusOptions(listSel.value, settings.defaultStatusId);
        });
      }
    } catch (err) {
      console.error("[attio-ext] Failed to load dropdowns:", err);
    }
  }

  async function loadStatusOptions(listId, defaultStatusId) {
    const statusSel = overlay?.querySelector(`.${EXT_ID}-status-select`);
    if (!statusSel) return;
    statusSel.innerHTML = '<option value="">Loading…</option>';

    try {
      const { attributes } = await sendMessage({
        action: "GET_LIST_ATTRIBUTES",
        listId,
      });
      statusSel.innerHTML = '<option value="">— no status —</option>';
      const statusAttrs = (attributes || []).filter((a) => a.type === "status");
      for (const attr of statusAttrs) {
        const statuses = attr.config?.statuses || attr.statuses || [];
        for (const s of statuses) {
          const opt = document.createElement("option");
          opt.value = s.id?.status_id ?? s.id;
          opt.dataset.slug = attr.api_slug || attr.slug || "";
          opt.textContent = `${attr.title}: ${s.title}`;
          if (opt.value === defaultStatusId) opt.selected = true;
          statusSel.appendChild(opt);
        }
      }
    } catch {
      statusSel.innerHTML = '<option value="">— error —</option>';
    }
  }

  // ── Form submission ───────────────────────────────────────────

  async function handleSubmit(e, scraped) {
    e.preventDefault();
    const form = e.target;
    const statusEl = form.querySelector(`.${EXT_ID}-form-status`);
    const submitBtn = form.querySelector('button[type="submit"]');

    const fd = new FormData(form);
    const firstName = fd.get("firstName")?.trim();
    const lastName = fd.get("lastName")?.trim();
    const jobTitle = fd.get("jobTitle")?.trim();
    const company = fd.get("company")?.trim();
    const email = fd.get("email")?.trim();
    const linkedinUrl = fd.get("linkedinUrl")?.trim();
    const listId = fd.get("listId");
    const statusId = fd.get("statusId");

    if (!firstName || !lastName) {
      statusEl.textContent = "First and last name are required.";
      statusEl.className = `${EXT_ID}-form-status ${EXT_ID}-form-err`;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating…";
    statusEl.textContent = "";

    // Build description from extra scraped data (mirrors import_attio.py)
    const descParts = [];
    if (scraped.about) descParts.push(`About: ${scraped.about}`);
    if (company) descParts.push(`Company: ${company}`);
    if (scraped.location) descParts.push(`Location: ${scraped.location}`);
    if (scraped.experiences?.length) {
      descParts.push("Experience:");
      for (const exp of scraped.experiences.slice(0, 5)) {
        const line = [exp.title, exp.company, exp.dateRange]
          .filter(Boolean)
          .join(" — ");
        if (line) descParts.push(`  • ${line}`);
      }
    }
    const description = descParts.join("\n") || null;

    try {
      // 1) Create person
      const createRes = await sendMessage({
        action: "CREATE_PERSON",
        firstName,
        lastName,
        linkedinUrl,
        jobTitle,
        email,
        description,
      });

      if (createRes.error) {
        statusEl.textContent = createRes.error;
        statusEl.className = `${EXT_ID}-form-status ${EXT_ID}-form-err`;
        submitBtn.disabled = false;
        submitBtn.textContent = "Add to Attio";
        return;
      }

      const recordId = createRes.recordId;

      // 2) Add to list if selected
      if (listId && recordId) {
        const entryValues = {};
        if (statusId) {
          const statusOption = form.querySelector(`.${EXT_ID}-status-select`)?.selectedOptions[0];
          const slug = statusOption?.dataset.slug;
          if (slug) {
            entryValues[slug] = statusId;
          }
        }
        const listRes = await sendMessage({
          action: "ADD_TO_LIST",
          recordId,
          listId,
          entryValues,
        });
        if (listRes.error) {
          console.warn("[attio-ext] Add to list warning:", listRes.error);
        }
      }

      // 3) Show found state
      const settings = await sendMessage({ action: "GET_SETTINGS" });
      showOverlay("found", {
        person: {
          firstName,
          lastName,
          email,
          jobTitle,
          linkedin: linkedinUrl,
        },
        recordId,
        workspaceSlug: settings.workspaceSlug,
      });
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = `${EXT_ID}-form-status ${EXT_ID}-form-err`;
      submitBtn.disabled = false;
      submitBtn.textContent = "Add to Attio";
    }
  }

  // ── Utilities ─────────────────────────────────────────────────

  function removeOverlay() {
    const el = document.getElementById(`${EXT_ID}-overlay`);
    if (el) el.remove();
    overlay = null;
  }

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(res || {});
        }
      });
    });
  }

  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        // Resolve anyway — scraper handles missing elements gracefully
        resolve(null);
      }, timeout);
    });
  }

  function fieldRow(label, value) {
    if (!value) return "";
    return `<div class="${EXT_ID}-field">
      <span class="${EXT_ID}-field-label">${escapeHtml(label)}</span>
      <span class="${EXT_ID}-field-value">${escapeHtml(value)}</span>
    </div>`;
  }

  function escapeHtml(str) {
    const el = document.createElement("span");
    el.textContent = str;
    return el.innerHTML;
  }

  function escapeAttr(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ── Go ────────────────────────────────────────────────────────
  init();
})();
