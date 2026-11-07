import type { Account, Course, DownloadItem, DownloadSummary, History, Index, Section } from "./types"

/** Demo-Daten für `pnpm dev` im normalen Browser (ohne Tauri). */
export const mockAccount: Account = {
  id: "demo-1",
  siteUrl: "https://moodle.demo-hochschule.de",
  siteName: "Demo Hochschule",
  userId: 1,
  fullname: "Alex Beispiel",
  username: "abeispiel",
}

function file(courseId: number, mod: number, i: number, name: string, size: number, folder = "") {
  return {
    id: `${courseId}:${mod}:${i}`,
    name,
    folder,
    size,
    url: `https://moodle.demo-hochschule.de/webservice/pluginfile.php/${courseId}/${mod}/${name}`,
    mime: null,
    modified: Math.floor(Date.now() / 1000) - mod * 86400,
  }
}

function weeks(courseId: number, topics: string[]) {
  return topics.map((t, i) => ({
    name: `Woche ${i + 1}: ${t}`,
    modules: [
      {
        id: courseId * 100 + i * 3,
        name: `Vorlesung ${t}`,
        modname: "resource",
        files: [file(courseId, courseId * 100 + i * 3, 0, `Vorlesung_${i + 1}.pdf`, 1_200_000 + i * 310_000)],
      },
      {
        id: courseId * 100 + i * 3 + 1,
        name: `Übungsblatt ${i + 1}`,
        modname: "resource",
        files: [file(courseId, courseId * 100 + i * 3 + 1, 0, `Uebung_${i + 1}.pdf`, 240_000 + i * 20_000)],
      },
      ...(i % 2 === 0
        ? [
            {
              id: courseId * 100 + i * 3 + 2,
              name: "Zusatzmaterial",
              modname: "folder",
              files: [
                file(courseId, courseId * 100 + i * 3 + 2, 0, "Folien.pptx", 4_800_000, "Slides"),
                file(courseId, courseId * 100 + i * 3 + 2, 1, "Beispiele.zip", 9_100_000, "Code"),
              ],
            },
          ]
        : []),
    ],
  }))
}

function withLink(sections: Section[]) {
  sections[0].modules.push({
    id: 1299,
    name: "SQL-Spielwiese",
    modname: "url",
    files: [{ id: "12:1299:link:0", name: "SQL-Spielwiese.url", folder: "", size: 0, url: "https://sqlfiddle.com", mime: null, modified: 0, isLink: true }],
  })
  return sections
}

const courses: Course[] = [
  { id: 11, fullname: "Algorithmen und Datenstrukturen", shortname: "ADS", progress: 62, lastAccess: Date.now() / 1000 - 3600, hidden: false, sections: weeks(11, ["Sortieren", "Bäume", "Graphen", "Hashing", "Dynamische Programmierung"]) },
  { id: 12, fullname: "Datenbanksysteme", shortname: "DBS", progress: 30, lastAccess: Date.now() / 1000 - 86400 * 3, hidden: false, sections: withLink(weeks(12, ["ER-Modell", "SQL", "Normalisierung", "Transaktionen"])) },
  { id: 13, fullname: "Lineare Algebra", shortname: "LA", progress: 80, lastAccess: null, hidden: false, sections: weeks(13, ["Vektorräume", "Matrizen", "Eigenwerte"]) },
  { id: 14, fullname: "Softwaretechnik", shortname: "SWT", progress: null, lastAccess: null, hidden: false, sections: weeks(14, ["Anforderungen", "Entwurf", "Testen", "Agile Methoden", "DevOps", "Projektarbeit"]) },
  { id: 15, fullname: "Englisch für Informatiker", shortname: "ENG", progress: null, lastAccess: null, hidden: false, error: "Kein Zugriff auf diesen Kurs.", sections: [] },
]

export const mockHistory: History = Object.fromEntries(
  courses
    .filter((c) => c.id === 11)
    .flatMap((c) => c.sections.slice(0, 3))
    .flatMap((s) => s.modules.flatMap((m) => m.files.map((f) => [f.id, { modified: f.modified, size: f.size, at: Date.now() }]))),
)

export const mockIndex: Index = { accountId: mockAccount.id, syncedAt: Date.now() - 1000 * 60 * 42, courses }

type Handler = (payload: unknown) => void
const handlers = new Map<string, Set<Handler>>()
export function mockOn(name: string, cb: Handler) {
  if (!handlers.has(name)) handlers.set(name, new Set())
  handlers.get(name)!.add(cb)
  return () => handlers.get(name)?.delete(cb)
}
const emit = (name: string, payload: unknown) => handlers.get(name)?.forEach((h) => h(payload))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let cancelled = false
export const mockCancel = () => {
  cancelled = true
}

export async function mockSync(): Promise<Index> {
  for (let i = 0; i <= courses.length; i++) {
    emit("sync-progress", { done: i, total: courses.length, course: courses[i - 1]?.fullname ?? "" })
    await sleep(250)
  }
  return { ...mockIndex, syncedAt: Date.now() }
}

export async function mockDownload(items: DownloadItem[]): Promise<DownloadSummary> {
  cancelled = false
  const summary: DownloadSummary = { downloaded: 0, skipped: 0, failed: 0, cancelled: false, bytes: 0 }
  for (const it of items) {
    if (cancelled) {
      summary.cancelled = true
      emit("download-progress", { id: it.id, state: "cancelled", received: 0, total: it.size })
      continue
    }
    for (let p = 0; p <= 4; p++) {
      emit("download-progress", { id: it.id, state: p === 0 ? "start" : "progress", received: (it.size * p) / 4, total: it.size })
      await sleep(60)
    }
    emit("download-progress", { id: it.id, state: "done", received: it.size, total: it.size })
    summary.downloaded++
    summary.bytes += it.size
  }
  return summary
}
