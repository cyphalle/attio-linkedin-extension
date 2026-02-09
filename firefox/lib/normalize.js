/**
 * Normalize a LinkedIn profile URL to its slug.
 * Port of dedup.py:normalize_linkedin_url
 *
 * "https://www.linkedin.com/in/john-doe?foo=bar" → "john-doe"
 */
function normalizeLinkedInUrl(url) {
  if (!url) return null;
  url = url.split("?")[0].replace(/\/+$/, "");
  const match = url.toLowerCase().match(/linkedin\.com\/in\/([^/]+)/);
  return match ? match[1] : url.toLowerCase();
}
