export interface Account {
  id: string
  siteUrl: string
  siteName: string
  userId: number
  fullname: string
  username: string
  icon?: string | null
}

export interface RemoteFile {
  id: string
  name: string
  folder: string
  size: number
  url: string
  mime?: string | null
  modified: number
  isLink?: boolean
}

export interface Module {
  id: number
  name: string
  modname: string
  files: RemoteFile[]
}

export interface Section {
  name: string
  modules: Module[]
}

export interface Course {
  id: number
  fullname: string
  shortname: string
  progress?: number | null
  lastAccess?: number | null
  hidden: boolean
  error?: string | null
  sections: Section[]
}

export interface Index {
  accountId: string
  syncedAt: number
  courses: Course[]
}

/** Eine Datei samt Kontext – flach für Suche & Auswahl. */
export interface FlatFile extends RemoteFile {
  courseId: number
  courseName: string
  sectionName: string
  sectionIdx: number
  moduleName: string
  modname: string
  kind: FileKind
  status: FileStatus
}

export type FileKind = "link" | "pdf" | "doc" | "slides" | "sheet" | "image" | "archive" | "media" | "code" | "other"

export interface DownloadItem {
  id: string
  url: string
  path: string[]
  size: number
  modified: number
  stale: boolean
  isLink: boolean
}

export interface HistoryEntry {
  modified: number
  size: number
  at: number
}

export type History = Record<string, HistoryEntry>

/** new = nie geladen, updated = seit dem Download auf dem Server geändert */
export type FileStatus = "new" | "updated" | "synced"

export type SortKey = "moodle" | "name" | "date" | "size"


export interface DownloadSummary {
  downloaded: number
  skipped: number
  failed: number
  cancelled: boolean
  bytes: number
}

export interface FileProgress {
  state: "start" | "progress" | "done" | "skipped" | "error" | "cancelled"
  received: number
  total: number
  error?: string | null
}
