/**
 * LinkedIn profile DOM scraper.
 * Graceful degradation: returns null for any field that can't be found.
 */
class LinkedInScraper {
  // ── Main entry point ──────────────────────────────────────────

  static scrape() {
    return {
      fullName: this.getName(),
      firstName: null, // filled below
      lastName: null,
      headline: this.getHeadline(),
      jobTitle: null, // filled below
      company: null, // filled below
      location: this.getLocation(),
      photoUrl: this.getPhoto(),
      about: this.getAbout(),
      email: this.getEmail(),
      connections: this.getConnections(),
      experiences: this.getExperiences(),
      linkedinUrl: this.getUrl(),
    };
  }

  /**
   * Full scrape with derived fields (name split, title/company parse).
   */
  static scrapeAll() {
    const data = this.scrape();

    // Split name
    if (data.fullName) {
      const { first, last } = this.splitName(data.fullName);
      data.firstName = first;
      data.lastName = last;
    }

    // Parse headline → title + company
    if (data.headline) {
      const parsed = this.parseHeadline(data.headline);
      data.jobTitle = parsed.title;
      data.company = parsed.company;
    }

    // Fallback company from experience section
    if (!data.company && data.experiences?.length > 0) {
      data.company = data.experiences[0].company || null;
    }

    return data;
  }

  // ── Individual fields ─────────────────────────────────────────

  static getName() {
    // Try specific class first, then broader selectors
    const selectors = [
      "h1.text-heading-xlarge",
      "h1.top-card-layout__title",
      ".pv-top-card h1",
      ".ph5 h1",
      "main h1",
      "h1",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text && text.length < 100) return text;
      }
    }
    // Fallback: og:title usually looks like "John Doe - Title | LinkedIn"
    const meta = document.querySelector('meta[property="og:title"]');
    if (meta) {
      const content = meta.getAttribute("content") || "";
      return content.split(" - ")[0].trim() || null;
    }
    // Last resort: title tag
    const title = document.title || "";
    const titleMatch = title.split(" | ")[0]?.split(" - ")[0]?.trim();
    if (titleMatch && titleMatch !== "LinkedIn") return titleMatch;
    return null;
  }

  static getHeadline() {
    const selectors = [
      ".text-body-medium.break-words",
      ".top-card-layout__headline",
      ".pv-top-card .text-body-medium",
      "[data-generated-suggestion-target] .text-body-medium",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text) return text;
      }
    }
    return null;
  }

  static getLocation() {
    const containerSelectors = [
      ".pv-top-card--list .text-body-small",
      ".top-card-layout__first-subline .text-body-small",
      ".pv-top-card .text-body-small",
      ".ph5 .text-body-small",
      "main .text-body-small",
    ];
    for (const csel of containerSelectors) {
      const spans = document.querySelectorAll(csel);
      for (const span of spans) {
        const text = span.textContent.trim();
        if (
          text &&
          !text.toLowerCase().includes("connection") &&
          !text.toLowerCase().includes("follower") &&
          !text.toLowerCase().includes("mutual")
        ) {
          return text;
        }
      }
    }
    return null;
  }

  static getPhoto() {
    const img = document.querySelector(
      "img.pv-top-card-profile-picture__image--show"
    );
    if (img) return img.src;
    const fallback = document.querySelector(".pv-top-card img[alt]");
    return fallback ? fallback.src : null;
  }

  static getAbout() {
    const section = document.getElementById("about");
    if (!section) return null;
    // Navigate up to the section container, then look for the text
    const container =
      section.closest("section") || section.parentElement?.parentElement;
    if (!container) return null;
    const span =
      container.querySelector("span[aria-hidden='true']") ||
      container.querySelector("span.visually-hidden");
    return span ? span.textContent.trim() : null;
  }

  static getEmail() {
    const mailto = document.querySelector('a[href^="mailto:"]');
    return mailto ? mailto.href.replace("mailto:", "").trim() : null;
  }

  static getConnections() {
    const allSpans = document.querySelectorAll(".pv-top-card span");
    for (const span of allSpans) {
      const text = span.textContent.trim().toLowerCase();
      if (text.includes("connection") || text.includes("follower")) {
        return span.textContent.trim();
      }
    }
    return null;
  }

  static getExperiences() {
    const section = document.getElementById("experience");
    if (!section) return [];
    const container =
      section.closest("section") || section.parentElement?.parentElement;
    if (!container) return [];

    const items = container.querySelectorAll(":scope > div > ul > li");
    const experiences = [];

    for (const li of items) {
      // Title is typically in a bold span
      const titleEl =
        li.querySelector(".t-bold span[aria-hidden='true']") ||
        li.querySelector(".t-bold");
      // Company is in a .t-14 .t-normal span
      const companyEl =
        li.querySelector(".t-14.t-normal span[aria-hidden='true']") ||
        li.querySelector(".t-14.t-normal");
      // Date range
      const dateEl = li.querySelector(
        ".t-14.t-normal.t-black--light span[aria-hidden='true']"
      );

      if (titleEl || companyEl) {
        experiences.push({
          title: titleEl ? titleEl.textContent.trim() : null,
          company: companyEl ? companyEl.textContent.trim() : null,
          dateRange: dateEl ? dateEl.textContent.trim() : null,
        });
      }
    }
    return experiences;
  }

  static getUrl() {
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) return canonical.href;
    return window.location.href.split("?")[0];
  }

  // ── Utilities ─────────────────────────────────────────────────

  static splitName(fullName) {
    const parts = fullName.trim().split(/\s+/);
    return {
      first: parts[0] || "",
      last: parts.slice(1).join(" ") || "",
    };
  }

  /**
   * Parse a LinkedIn headline into job title and company.
   * Handles separators: " at ", " chez ", " @ ", " | ", " - "
   */
  static parseHeadline(headline) {
    const separators = [" at ", " chez ", " @ ", " | ", " - "];
    for (const sep of separators) {
      const idx = headline.toLowerCase().indexOf(sep.toLowerCase());
      if (idx !== -1) {
        return {
          title: headline.slice(0, idx).trim(),
          company: headline.slice(idx + sep.length).trim(),
        };
      }
    }
    // No separator found — whole headline is the title
    return { title: headline.trim(), company: null };
  }
}
