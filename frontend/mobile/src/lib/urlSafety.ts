// Guards against Linking.openURL ever being handed a javascript:/data: URL
// from third-party data (news article links) — low-probability (would
// require the news provider itself to return a malicious URL) but cheap to
// close before it reaches the OS URL handler. Regex-based rather than the
// global URL class, which Hermes doesn't provide without a polyfill this
// project doesn't already install.
export function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url.trim());
}
