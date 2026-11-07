import { useCallback, useState } from "react"

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`moodle-sync.${key}`)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(`moodle-sync.${key}`, JSON.stringify(value))
  } catch {
    // localStorage nicht verfügbar – Einstellung wird nur nicht gemerkt
  }
}

export interface DownloadPrefs {
  dest: string | null
  courseFolder: boolean
  sectionFolder: boolean
}

export const downloadPrefs = {
  global: (): DownloadPrefs => read("download", { dest: null, courseFolder: true, sectionFolder: true }),
  forCourse: (accountId: string, courseId: number): DownloadPrefs | null =>
    read<DownloadPrefs | null>(`download:${accountId}:${courseId}`, null),
  save: (accountId: string, courseIds: number[], prefs: DownloadPrefs) => {
    write("download", prefs)
    // Ein einzelner Kurs bekommt seinen festen Zielordner.
    if (courseIds.length === 1) write(`download:${accountId}:${courseIds[0]}`, prefs)
  },
}

interface CoursePrefs {
  favs: number[]
  hidden: number[]
}

/** Favoriten und ausgeblendete Kurse, pro Konto im localStorage. */
export function useCoursePrefs(accountId: string | null) {
  const key = `courses:${accountId}`
  const [state, setState] = useState<{ key: string; prefs: CoursePrefs }>(() => ({
    key,
    prefs: read(key, { favs: [], hidden: [] }),
  }))
  // Beim Kontowechsel neu laden (abgeleiteter Zustand statt Effect).
  const prefs = state.key === key ? state.prefs : read<CoursePrefs>(key, { favs: [], hidden: [] })
  if (state.key !== key) setState({ key, prefs })

  const toggle = useCallback(
    (field: keyof CoursePrefs, id: number) => {
      setState((s) => {
        const cur = s.key === key ? s.prefs : read<CoursePrefs>(key, { favs: [], hidden: [] })
        const list = cur[field].includes(id) ? cur[field].filter((x) => x !== id) : [...cur[field], id]
        const next = { ...cur, [field]: list }
        write(key, next)
        return { key, prefs: next }
      })
    },
    [key],
  )

  return {
    favs: new Set(prefs.favs),
    hidden: new Set(prefs.hidden),
    toggleFav: (id: number) => toggle("favs", id),
    toggleHidden: (id: number) => toggle("hidden", id),
  }
}
