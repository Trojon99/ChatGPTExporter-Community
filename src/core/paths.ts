// Adapted from GrokExporter commit 85922d6.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function safePathSegment(value: string, fallback = "untitled", maxLength = 120): string {
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .replace(/^[ .-]+|[ .]+$/g, "")
    .slice(0, maxLength)
    .replace(/[ .]+$/g, "");
  const candidate = normalized || fallback;
  return WINDOWS_RESERVED.test(candidate) ? `_${candidate}` : candidate;
}

export function assertSafeRelativePath(path: string): void {
  if (!path || path.startsWith("/") || path.startsWith("\\") || /^[a-z]:/i.test(path)) throw new Error(`Unsafe absolute path: ${path}`);
  const segments = path.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error(`Unsafe relative path: ${path}`);
}
