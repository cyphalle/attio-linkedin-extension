/**
 * Attio API v2 wrapper — mirrors domains/sales/clients/attio.py
 */
class AttioAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = "https://api.attio.com/v2";
  }

  // ── HTTP helpers ──────────────────────────────────────────────

  async _request(method, path, body = null) {
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${this.baseUrl}${path}`, opts);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`Attio ${method} ${path} → ${res.status}`);
      err.status = res.status;
      err.body = text;
      throw err;
    }
    return res.json();
  }

  _get(path) {
    return this._request("GET", path);
  }
  _post(path, body) {
    return this._request("POST", path, body);
  }

  // ── People ────────────────────────────────────────────────────

  /**
   * Query people records with a filter.
   * POST /objects/people/records/query
   */
  async queryPeople(filter) {
    return this._post("/objects/people/records/query", { filter });
  }

  /**
   * Create a person record.
   * Values follow Attio's nested format:
   *   { first_name: [{ value: "John" }], email_addresses: [{ email_address: "…" }] }
   */
  async createPerson(values) {
    return this._post("/objects/people/records", {
      data: { values },
    });
  }

  // ── Lists ─────────────────────────────────────────────────────

  async listLists() {
    return this._get("/lists");
  }

  async getListAttributes(listId) {
    return this._get(`/lists/${listId}/attributes`);
  }

  async addToList(listId, recordId, entryValues = {}) {
    return this._post(`/lists/${listId}/entries`, {
      data: {
        parent_record_id: recordId,
        parent_object: "people",
        entry_values: entryValues,
      },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────

  /**
   * Extract a single value from Attio's nested values structure.
   * Port of dedup.py:_extract_attio_value
   */
  static extractValue(record, fieldName) {
    const values = record?.values?.[fieldName];
    if (!values || values.length === 0) return null;
    const val = values[0];
    if (typeof val === "object" && val !== null) {
      return (
        val.value ??
        val.email_address ??
        val.original_url ??
        val.first_name ??
        val.last_name ??
        null
      );
    }
    return String(val);
  }
}
