/**
 * Options page logic — settings + API key validation.
 */
const $ = (sel) => document.querySelector(sel);

const apiKeyInput = $("#apiKey");
const testBtn = $("#testBtn");
const apiStatus = $("#apiStatus");
const listSelect = $("#listSelect");
const statusSelect = $("#statusSelect");
const saveBtn = $("#saveBtn");
const saveStatus = $("#saveStatus");

// Cache fetched data so we don't re-fetch on every interaction
let listsCache = [];
let attributesCache = [];

// ── Load saved settings on open ─────────────────────────────────

chrome.storage.sync.get(
  [
    "attioApiKey",
    "defaultListId",
    "defaultListName",
    "defaultStatusId",
    "defaultStatusSlug",
    "defaultStatusTitle",
  ],
  async (settings) => {
    if (settings.attioApiKey) {
      apiKeyInput.value = settings.attioApiKey;
      // Auto-load lists if key is already saved
      await loadLists(settings.attioApiKey);
      // Restore saved list selection
      if (settings.defaultListId) {
        listSelect.value = settings.defaultListId;
        await loadStatuses(settings.attioApiKey, settings.defaultListId);
        if (settings.defaultStatusId) {
          statusSelect.value = settings.defaultStatusId;
        }
      }
    }
  }
);

// ── Test connection ─────────────────────────────────────────────

testBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showStatus(apiStatus, "Enter an API key first.", "err");
    return;
  }
  showStatus(apiStatus, "Testing…", "");
  try {
    await loadLists(key);
    showStatus(apiStatus, `Connected — ${listsCache.length} list(s) found.`, "ok");
  } catch (err) {
    showStatus(apiStatus, `Connection failed: ${err.message}`, "err");
    listSelect.disabled = true;
    statusSelect.disabled = true;
  }
});

// ── List selection → load statuses ──────────────────────────────

listSelect.addEventListener("change", async () => {
  const key = apiKeyInput.value.trim();
  const listId = listSelect.value;
  if (!key || !listId) {
    statusSelect.innerHTML = '<option value="">— select a list first —</option>';
    statusSelect.disabled = true;
    return;
  }
  await loadStatuses(key, listId);
});

// ── Save ────────────────────────────────────────────────────────

saveBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showStatus(saveStatus, "API key is required.", "err");
    return;
  }

  const listOption = listSelect.selectedOptions[0];
  const statusOption = statusSelect.selectedOptions[0];

  const data = {
    attioApiKey: key,
    defaultListId: listSelect.value || "",
    defaultListName: listOption?.textContent || "",
    defaultStatusId: statusSelect.value || "",
    defaultStatusSlug: statusOption?.dataset.slug || "",
    defaultStatusTitle: statusOption?.textContent || "",
  };

  chrome.storage.sync.set(data, () => {
    showStatus(saveStatus, "Settings saved.", "ok");
  });
});

// ── Helpers ─────────────────────────────────────────────────────

async function loadLists(apiKey) {
  const res = await fetch("https://api.attio.com/v2/lists", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const json = await res.json();
  listsCache = json.data || [];

  listSelect.innerHTML = '<option value="">— choose a list —</option>';
  for (const list of listsCache) {
    const opt = document.createElement("option");
    opt.value = list.id?.list_id ?? list.id;
    opt.textContent = list.name || list.id;
    listSelect.appendChild(opt);
  }
  listSelect.disabled = false;
}

async function loadStatuses(apiKey, listId) {
  statusSelect.innerHTML = '<option value="">Loading…</option>';
  statusSelect.disabled = true;

  const res = await fetch(`https://api.attio.com/v2/lists/${listId}/attributes`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const json = await res.json();
  attributesCache = json.data || [];

  // Find status-type attributes
  const statusAttrs = attributesCache.filter((a) => a.type === "status");

  statusSelect.innerHTML = '<option value="">— none —</option>';
  for (const attr of statusAttrs) {
    const statuses = attr.config?.statuses || attr.statuses || [];
    for (const s of statuses) {
      const opt = document.createElement("option");
      opt.value = s.id?.status_id ?? s.id;
      opt.dataset.slug = attr.api_slug || attr.slug || "";
      opt.textContent = `${attr.title}: ${s.title}`;
      statusSelect.appendChild(opt);
    }
  }
  statusSelect.disabled = false;
}

function showStatus(el, text, cls) {
  el.textContent = text;
  el.className = "status " + (cls || "");
}
