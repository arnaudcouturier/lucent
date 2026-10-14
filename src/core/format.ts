// How Lucent writes sizes and counts, in the window and in its log.

export function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

/** `1 file`, `1,024 files`. */
export const fileCount = (count: number) => count === 1 ? '1 file' : `${count.toLocaleString('en')} files`
