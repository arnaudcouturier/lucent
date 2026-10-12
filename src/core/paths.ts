// Windows path helpers. Paths are strings with backslashes; Windows also accepts forward slashes.

/** Joins path parts with single backslashes, accepting either slash in the parts. */
export function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('\\')
    .replace(/\//g, '\\')
    .replace(/(?<!^)\\{2,}/g, '\\')
}

export const normalizePath = (path: string) => joinPath(path).replace(/\\$/, '')

/** Keeps the trailing separator so a drive-root parent stays absolute (C:\\, not C:). */
export const parentPath = (path: string) => {
  const normalized = normalizePath(path)
  return normalized.slice(0, normalized.lastIndexOf('\\') + 1)
}
