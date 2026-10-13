// A long file list as folders that open one level at a time: one name per line, never a wrapped path.
import { useMemo, useState, type CSSProperties } from 'react'
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react'

export interface TreeFile {
  /** Relative path, with either slash. */
  path: string
  /** A short word after the name, such as "removed". */
  note?: string
  /** The tooltip; the path by default. */
  title?: string
}

interface FolderNode {
  name: string
  folders: FolderNode[]
  files: { name: string; file: TreeFile }[]
  count: number
}

const byName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare

function buildTree(files: TreeFile[]): FolderNode {
  type Draft = { name: string; folders: Map<string, Draft>; files: { name: string; file: TreeFile }[] }
  const root: Draft = { name: '', folders: new Map(), files: [] }
  for (const file of files) {
    const parts = file.path.split(/[\\/]/).filter(Boolean)
    let folder = root
    for (const part of parts.slice(0, -1)) {
      const key = part.toLowerCase()
      if (!folder.folders.has(key)) folder.folders.set(key, { name: part, folders: new Map(), files: [] })
      folder = folder.folders.get(key)!
    }
    folder.files.push({ name: parts.at(-1) ?? file.path, file })
  }
  const finish = (draft: Draft): FolderNode => {
    const folders = [...draft.folders.values()].map(finish).sort((a, b) => byName(a.name, b.name))
    const node = { name: draft.name, folders, files: draft.files.sort((a, b) => byName(a.name, b.name)), count: draft.files.length + folders.reduce((n, f) => n + f.count, 0) }
    // A folder holding only one folder opens straight to it, as "reshade-shaders\Shaders".
    if (draft !== root && !node.files.length && folders.length === 1) return { ...folders[0], name: `${node.name}\\${folders[0].name}` }
    return node
  }
  return finish(root)
}

export function FileTree({ files, label }: { files: TreeFile[]; label: string }) {
  const root = useMemo(() => buildTree(files), [files])
  return <ul className="file-tree" aria-label={label}><Items folder={root} depth={0} /></ul>
}

const indent = (depth: number) => ({ '--depth': depth }) as CSSProperties

function Items({ folder, depth }: { folder: FolderNode; depth: number }) {
  return <>
    {folder.folders.map((child) => <FolderItem key={child.name} folder={child} depth={depth} />)}
    {folder.files.map(({ name, file }) => <li key={name} className="tree-row" style={indent(depth)} title={file.title ?? file.path}>
      <File size={14} strokeWidth={1.75} className="tree-icon" />
      <span className="tree-name">{name}</span>
      {file.note && <span className="tree-note">{file.note}</span>}
    </li>)}
  </>
}

function FolderItem({ folder, depth }: { folder: FolderNode; depth: number }) {
  const [open, setOpen] = useState(false)
  return <li>
    <button type="button" className="tree-row tree-folder" style={indent(depth)} aria-expanded={open} title={folder.name} onClick={() => setOpen(!open)}>
      <ChevronRight size={12} strokeWidth={2} className="tree-chevron" />
      {open ? <FolderOpen size={14} strokeWidth={1.75} className="tree-icon" /> : <Folder size={14} strokeWidth={1.75} className="tree-icon" />}
      <span className="tree-name">{folder.name}</span>
      <span className="tree-count">{folder.count.toLocaleString('en')}</span>
    </button>
    {open && <ul><Items folder={folder} depth={depth + 1} /></ul>}
  </li>
}
