// A minimal reader for Valve's KeyValues text format (libraryfolders.vdf, appmanifest_*.acf).
// Keys are lower-cased, since Steam doesn't treat them as case-sensitive.

export type Vdf = { [key: string]: string | Vdf }

export function parseVdf(text: string): Vdf {
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}]/g) ?? []
  let i = 0
  const unquote = (t: string) => t.slice(1, -1).replace(/\\(.)/g, '$1')
  const block = (): Vdf => {
    const out: Vdf = {}
    while (i < tokens.length && tokens[i] !== '}') {
      const key = unquote(tokens[i++]).toLowerCase()
      const next = tokens[i++]
      if (next === '{') {
        out[key] = block()
        i++ // the closing brace
      } else if (next !== undefined) {
        out[key] = unquote(next)
      }
    }
    return out
  }
  return block()
}
