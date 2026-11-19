/** Accept an actual Calendly booking link without credentials or another host. */
export function normalizeMeetingUrl(value: string | null | undefined): string | null {
  const input = value?.trim() ?? "";
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a complete HTTPS Calendly booking link.");
  }
  if (
    input.length > 2048 ||
    /[\s\u0000-\u001f\u007f]/.test(input) ||
    url.protocol !== "https:" ||
    (url.hostname !== "calendly.com" && !url.hostname.endsWith(".calendly.com")) ||
    url.username || url.password || url.port || url.pathname.length < 2
  ) {
    throw new Error("Use an HTTPS booking link on calendly.com.");
  }
  return url.toString();
}

export function safeMeetingUrl(value: string | null | undefined): string | null {
  try { return normalizeMeetingUrl(value); } catch { return null; }
}
