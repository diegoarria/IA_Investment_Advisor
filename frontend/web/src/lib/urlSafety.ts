// Guards against rendering a javascript:/data: URL from third-party data
// (news article links) into an href — low-probability (would require the
// news provider itself to return a malicious URL) but cheap to close.
export function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
