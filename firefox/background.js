/**
 * Background script — routes messages from content script to Attio API.
 * Firefox MV3: scripts loaded via manifest background.scripts (no importScripts).
 */

// ── Settings helpers ────────────────────────────────────────────

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      [
        "attioApiKey",
        "workspaceSlug",
        "defaultListId",
        "defaultListName",
        "defaultStatusId",
        "defaultStatusSlug",
        "defaultStatusTitle",
      ],
      resolve
    );
  });
}

function getApi() {
  return getSettings().then((s) => {
    if (!s.attioApiKey) throw Object.assign(new Error("API key not configured — open extension settings."), { code: "NO_API_KEY" });
    return new AttioAPI(s.attioApiKey);
  });
}

// ── Message handler ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
      return getSettings();
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
  const api = await getApi();
  await api.addToList(listId, recordId, entryValues || {});
  return { success: true };
}

async function getLists() {
  const api = await getApi();
  const res = await api.listLists();
  return { lists: res?.data ?? [] };
}

async function getListAttributes({ listId }) {
  const api = await getApi();
  const res = await api.getListAttributes(listId);
  return { attributes: res?.data ?? [] };
}

// ── Error formatting ────────────────────────────────────────────

function friendlyError(err) {
  if (err.code === "NO_API_KEY") return err.message;
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
