// Shared post-login redirect guard (used by the server login page and the
// client login form): only same-path targets are honored. Absolute URLs,
// protocol-relative "//evil", and backslash tricks fall back to "/".
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return "/";
  }
  return raw;
}
