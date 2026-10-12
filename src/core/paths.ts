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
