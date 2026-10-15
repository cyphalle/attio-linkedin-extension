/**
 * Service worker — routes messages from content script to Attio API.
 */
importScripts("lib/normalize.js", "lib/attio-api.js");

// ── Settings helpers ────────────────────────────────────────────

const SETTINGS_KEYS = [
  "attioApiKey",
  "workspaceSlug",
  "defaultListId",
  "defaultListName",
  "defaultStatusId",
  "defaultStatusSlug",
  "defaultStatusTitle",
];

// Settings the content script may read. The API key is never sent to a web page.
const PUBLIC_SETTINGS_KEYS = SETTINGS_KEYS.filter((k) => k !== "attioApiKey");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[A-Za-z0-9_-]{1,128}$/;

// Settings used to live in storage.sync, which replicates the API key to every
// signed-in browser. Move them to storage.local once, then delete the sync copy.
let migration = null;
function migrateSettings() {
  if (!migration) {
    migration = new Promise((resolve) => {
      chrome.storage.sync.get(SETTINGS_KEYS, (synced) => {
        if (!synced || Object.keys(synced).length === 0) return resolve();
        chrome.storage.local.get(SETTINGS_KEYS, (local) => {
          const toCopy = local.attioApiKey ? {} : synced;
          chrome.storage.local.set(toCopy, () => {
            chrome.storage.sync.remove(SETTINGS_KEYS, () => resolve());
          });
        });
      });
    });
  }
  return migration;
}
chrome.runtime.onInstalled.addListener(() => migrateSettings());
chrome.runtime.onStartup.addListener(() => migrateSettings());

async function getSettings() {
  await migrateSettings();
  return new Promise((resolve) => {
    chrome.storage.local.get(SETTINGS_KEYS, resolve);
  });
}

async function getPublicSettings() {
  const s = await getSettings();
  const out = {};
  for (const k of PUBLIC_SETTINGS_KEYS) out[k] = s[k];
  return out;
}

function getApi() {
  return getSettings().then((s) => {
    if (!s.attioApiKey) throw Object.assign(new Error("API key not configured — open extension settings."), { code: "NO_API_KEY" });
    return new AttioAPI(s.attioApiKey);
  });
}

function assertUuid(value, name) {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw Object.assign(new Error(`Invalid ${name}.`), { code: "BAD_INPUT" });
  }
}

function sanitizeEntryValues(entryValues) {
  const out = {};
  if (!entryValues || typeof entryValues !== "object") return out;
  for (const [slug, statusId] of Object.entries(entryValues)) {
    if (!SLUG_RE.test(slug)) throw Object.assign(new Error("Invalid attribute slug."), { code: "BAD_INPUT" });
    assertUuid(statusId, "status id");
    out[slug] = statusId;
  }
  return out;
}

// Accept messages only from this extension's own pages or from its content
// script running on a LinkedIn page.
function isTrustedSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  const url = sender.url || sender.tab?.url || "";
  if (url.startsWith(chrome.runtime.getURL(""))) return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "www.linkedin.com";
  } catch {
    return false;
  }
}

// ── Message handler ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isTrustedSender(sender)) {
    sendResponse({ error: "Untrusted sender." });
    return false;
  }
  handleMessage(msg).then(sendResponse).catch((err) => {
    console.error("[attio-ext] background error:", err);
    sendResponse({
      error: friendlyError(err),
      status: err.status,
      code: err.code,
    });
  });
  return true; // keep channel open for async response
});

async function handleMessage(msg) {
  switch (msg.action) {
    case "CHECK_PERSON":
      return checkPerson(msg);
    case "CREATE_PERSON":
      return createPerson(msg);
    case "ADD_TO_LIST":
      return addToList(msg);
    case "GET_LISTS":
      return getLists();
    case "GET_LIST_ATTRIBUTES":
      return getListAttributes(msg);
    case "GET_SETTINGS":
      return getPublicSettings();
    default:
      throw new Error(`Unknown action: ${msg.action}`);
  }
}

// ── Actions ─────────────────────────────────────────────────────

async function checkPerson({ linkedinUrl, firstName, lastName }) {
  const api = await getApi();
  const slug = normalizeLinkedInUrl(linkedinUrl);

  // 1) Search by LinkedIn URL (partial match on slug)
  if (slug) {
    const res = await api.queryPeople({
      linkedin: { "$contains": slug },
    });
    const records = res?.data ?? [];
    if (records.length > 0) {
      return formatFound(records[0]);
    }
  }

  // 2) Fallback: search by name
  if (firstName && lastName) {
    const res = await api.queryPeople({
      "$and": [
        { name: { first_name: { "$eq": firstName } } },
        { name: { last_name: { "$eq": lastName } } },
      ],
    });
    const records = res?.data ?? [];
    if (records.length > 0) {
      return formatFound(records[0]);
    }
  }

  return { found: false };
}

function formatFound(record) {
  const e = (f) => AttioAPI.extractValue(record, f);
  return {
    found: true,
    recordId: record.id?.record_id ?? record.id,
    person: {
      firstName: e("first_name"),
      lastName: e("last_name"),
      email: e("email_addresses"),
      jobTitle: e("job_title"),
      linkedin: e("linkedin"),
      description: e("description"),
    },
  };
}

async function createPerson({
  firstName,
  lastName,
  linkedinUrl,
  jobTitle,
  email,
  description,
}) {
  const api = await getApi();
  const values = {
    name: [{ first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}` }],
  };
  if (linkedinUrl) values.linkedin = [{ value: linkedinUrl }];
  if (jobTitle) values.job_title = [{ value: jobTitle }];
  if (email) values.email_addresses = [{ email_address: email }];
  if (description) values.description = [{ value: description }];

  const res = await api.createPerson(values);
  const record = res?.data;
  return {
    success: true,
    recordId: record?.id?.record_id ?? record?.id,
  };
}

async function addToList({ recordId, listId, entryValues }) {
  assertUuid(recordId, "record id");
  assertUuid(listId, "list id");
  const values = sanitizeEntryValues(entryValues);
  const api = await getApi();
  await api.addToList(listId, recordId, values);
  return { success: true };
}

async function getLists() {
  const api = await getApi();
  const res = await api.listLists();
  return { lists: res?.data ?? [] };
}

async function getListAttributes({ listId }) {
  assertUuid(listId, "list id");
  const api = await getApi();
  const res = await api.getListAttributes(listId);
  return { attributes: res?.data ?? [] };
}

// ── Error formatting ────────────────────────────────────────────

function friendlyError(err) {
  if (err.code === "NO_API_KEY" || err.code === "BAD_INPUT") return err.message;
  switch (err.status) {
    case 400:
      return `Bad request: ${err.body || err.message}`;
    case 401:
      return "Invalid API key — check extension settings.";
    case 403:
      return "API key lacks required permissions.";
    case 409:
      return "Duplicate record — this person may already exist in Attio.";
    case 429:
      return "Rate limited — wait a moment and retry.";
    default:
      return err.message || "Unexpected error contacting Attio.";
  }
}
