import type { Course, FileKind, FileStatus, FlatFile, History, Index, SortKey } from "./types"

export function formatBytes(n: number): string {
  if (!n || n < 0) return "–"
  const units = ["B", "KB", "MB", "GB"]
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  const rtf = new Intl.RelativeTimeFormat("de", { numeric: "auto" })
  const min = Math.round(diff / 60000)
  if (min < 1) return "gerade eben"
  if (min < 60) return rtf.format(-min, "minute")
  const h = Math.round(min / 60)
  if (h < 24) return rtf.format(-h, "hour")
  return rtf.format(-Math.round(h / 24), "day")
}

const KINDS: Record<FileKind, string[]> = {
  link: ["url", "webloc"],
  pdf: ["pdf"],
  doc: ["doc", "docx", "odt", "rtf", "txt", "md", "pages", "tex"],
  slides: ["ppt", "pptx", "odp", "key"],
  sheet: ["xls", "xlsx", "csv", "ods", "numbers"],
  image: ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "heic"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz"],
  media: ["mp4", "mov", "mkv", "avi", "webm", "mp3", "wav", "m4a", "flac"],
  code: ["java", "py", "js", "ts", "c", "cpp", "h", "cs", "html", "css", "json", "xml", "sql", "ipynb", "sh"],
  other: [],
}

export const KIND_LABELS: Record<FileKind, string> = {
  link: "Links",
  pdf: "PDF",
  doc: "Dokumente",
  slides: "Folien",
  sheet: "Tabellen",
  image: "Bilder",
  archive: "Archive",
  media: "Audio/Video",
  code: "Code",
  other: "Sonstige",
}

export function kindOf(name: string): FileKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  for (const [kind, exts] of Object.entries(KINDS)) {
    if (exts.includes(ext)) return kind as FileKind
  }
  return "other"
}

export function statusOf(f: { id: string; modified: number }, history: History): FileStatus {
  const h = history[f.id]
  if (!h) return "new"
  return f.modified > h.modified ? "updated" : "synced"
}

export function flatten(index: Index | null, history: History = {}): FlatFile[] {
  if (!index) return []
  const out: FlatFile[] = []
  for (const c of index.courses) {
    c.sections.forEach((s, sectionIdx) => {
      for (const m of s.modules) {
        for (const f of m.files) {
          out.push({
            ...f,
            courseId: c.id,
            courseName: c.fullname,
            sectionName: s.name,
            sectionIdx,
            moduleName: m.name,
            modname: m.modname,
            kind: kindOf(f.name),
            status: statusOf(f, history),
          })
        }
      }
    })
  }
  return out
}

export function courseStats(course: Course) {
  let files = 0
  let size = 0
  for (const s of course.sections)
    for (const m of s.modules)
      for (const f of m.files) {
        files++
        size += f.size
      }
  return { files, size }
}

export interface PathOptions {
  courseFolder: boolean
  sectionFolder: boolean
}

/** Zielpfad einer Datei relativ zum Zielordner. Bereinigung der Zeichen übernimmt das Backend. */
export function targetPath(f: FlatFile, opts: PathOptions): string[] {
  const parts: string[] = []
  if (opts.courseFolder) parts.push(f.courseName)
  if (opts.sectionFolder) parts.push(`${String(f.sectionIdx + 1).padStart(2, "0")} ${f.sectionName}`)
  if (f.modname === "folder") parts.push(f.moduleName)
  if (f.folder) parts.push(...f.folder.split("/"))
  parts.push(f.name)
  return parts
}

export function formatDate(seconds: number): string {
  if (!seconds) return ""
  return new Date(seconds * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" })
}

export const SORT_LABELS: Record<SortKey, string> = {
  moodle: "Reihenfolge im Kurs",
  name: "Name",
  date: "Neueste zuerst",
  size: "Größte zuerst",
}

export function sortFiles(files: FlatFile[], sort: SortKey): FlatFile[] {
  if (sort === "moodle") return files
  const copy = [...files]
  if (sort === "name") copy.sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true }))
  if (sort === "date") copy.sort((a, b) => b.modified - a.modified)
  if (sort === "size") copy.sort((a, b) => b.size - a.size)
  return copy
}
