import { useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, Download, FolderOpen, Loader2, MinusCircle, RotateCw, TriangleAlert } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { api, onDownloadProgress } from "@/lib/api"
import { formatBytes, targetPath } from "@/lib/format"
import { notify, setDockProgress } from "@/lib/native"
import { downloadPrefs } from "@/lib/prefs"
import type { DownloadSummary, FileProgress, FlatFile } from "@/lib/types"

type Stage = "options" | "running" | "done"

const LARGE_BYTES = 2 * 1024 ** 3

export function DownloadDialog({
  files,
  accountId,
  onClose,
  onFinished,
}: {
  files: FlatFile[]
  accountId: string
  onClose: () => void
  onFinished: () => void
}) {
  const courseIds = useMemo(() => [...new Set(files.map((f) => f.courseId))], [files])
  const [initial] = useState(() => {
    const single = courseIds.length === 1 ? downloadPrefs.forCourse(accountId, courseIds[0]) : null
    return { prefs: single ?? downloadPrefs.global(), remembered: single !== null }
  })

  const [stage, setStage] = useState<Stage>("options")
  const [dest, setDest] = useState<string | null>(initial.prefs.dest)
  const [courseFolder, setCourseFolder] = useState(initial.prefs.courseFolder)
  const [sectionFolder, setSectionFolder] = useState(initial.prefs.sectionFolder)
  const [runFiles, setRunFiles] = useState<FlatFile[]>(files)
  const [progress, setProgress] = useState<Record<string, FileProgress>>({})
  const [summary, setSummary] = useState<DownloadSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const totalSize = useMemo(() => runFiles.reduce((s, f) => s + f.size, 0), [runFiles])
  const received = useMemo(() => runFiles.reduce((s, f) => s + (progress[f.id]?.received ?? 0), 0), [runFiles, progress])
  const finished = runFiles.filter((f) => ["done", "skipped", "error", "cancelled"].includes(progress[f.id]?.state ?? "")).length
  const percent = runFiles.length ? Math.round((finished / runFiles.length) * 100) : 0
  const failed = runFiles.filter((f) => progress[f.id]?.state === "error")

  useEffect(() => {
    if (stage === "running") void setDockProgress(percent)
  }, [stage, percent])

  useEffect(() => {
    if (stage !== "done") return
    void setDockProgress(null)
    if (summary) {
      void notify("Download abgeschlossen", `${summary.downloaded} geladen, ${summary.skipped} übersprungen, ${summary.failed} fehlgeschlagen`)
    }
  }, [stage, summary])

  async function pick() {
    const dir = await api.pickFolder()
    if (dir) setDest(dir)
  }

  async function start(list: FlatFile[]) {
    if (!dest) return
    downloadPrefs.save(accountId, courseIds, { dest, courseFolder, sectionFolder })
    setRunFiles(list)
    setProgress({})
    setSummary(null)
    setError(null)
    setStage("running")
    // Vor dem Start abonnieren, damit keine frühen Events verloren gehen.
    const off = onDownloadProgress((p) => setProgress((prev) => ({ ...prev, [p.id]: p })))
    try {
      const items = list.map((f) => ({
        id: f.id,
        url: f.url,
        size: f.size,
        modified: f.modified,
        stale: f.status === "updated",
        isLink: !!f.isLink,
        path: targetPath(f, { courseFolder, sectionFolder }),
      }))
      setSummary(await api.download(accountId, dest, items))
    } catch (e) {
      setError(String(e))
    }
    off()
    setStage("done")
  }

  return (
    <Dialog open onOpenChange={(o) => !o && stage !== "running" && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {stage === "options" ? "Dateien herunterladen" : stage === "running" ? "Lade herunter…" : "Download abgeschlossen"}
          </DialogTitle>
          <DialogDescription>
            {runFiles.length} {runFiles.length === 1 ? "Datei" : "Dateien"} · {formatBytes(totalSize)}
          </DialogDescription>
        </DialogHeader>

        {stage === "options" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Zielordner</Label>
              <button
                onClick={pick}
                className="flex items-center gap-3 rounded-xl border border-dashed px-3 py-3 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{dest ?? "Ordner auswählen…"}</span>
              </button>
              {courseIds.length === 1 && (
                <p className="text-xs text-muted-foreground">
                  {initial.remembered ? "Gemerkter Ordner für diesen Kurs. " : "Wird für diesen Kurs gemerkt. "}
                  Beim nächsten Mal ist er schon vorausgewählt.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2.5">
              <Label className="cursor-pointer gap-2.5">
                <Checkbox checked={courseFolder} onCheckedChange={setCourseFolder} /> Ordner pro Kurs anlegen
              </Label>
              <Label className="cursor-pointer gap-2.5">
                <Checkbox checked={sectionFolder} onCheckedChange={setSectionFolder} /> Unterordner pro Abschnitt
              </Label>
              <p className="text-xs text-muted-foreground">
                Vorhandene Dateien gleicher Größe werden übersprungen, geänderte Dateien ersetzt.
              </p>
            </div>
            {totalSize > LARGE_BYTES && (
              <Alert>
                <TriangleAlert />
                <AlertDescription>
                  Das sind {formatBytes(totalSize)}. Der Download kann dauern und braucht entsprechend Speicherplatz.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {stage !== "options" && (
          <div className="flex flex-col gap-3">
            <Progress value={percent} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {finished} / {runFiles.length} Dateien
              </span>
              <span>{formatBytes(received)}</span>
            </div>
            <ul className="max-h-60 divide-y overflow-y-auto rounded-xl border">
              {runFiles.map((f) => {
                const p = progress[f.id]
                return (
                  <li key={f.id} className="flex items-center gap-2.5 px-3 py-2 text-sm" title={p?.error ?? undefined}>
                    {p?.state === "done" ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                    ) : p?.state === "error" ? (
                      <AlertCircle className="size-4 shrink-0 text-destructive" />
                    ) : p?.state === "skipped" || p?.state === "cancelled" ? (
                      <MinusCircle className="size-4 shrink-0 text-muted-foreground" />
                    ) : p ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                    ) : (
                      <span className="size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="max-w-40 truncate text-xs text-muted-foreground">
                      {p?.state === "error"
                        ? (p.error ?? "Fehler")
                        : p?.state === "skipped"
                          ? "vorhanden"
                          : p?.state === "progress" && p.total
                            ? `${Math.round((p.received / p.total) * 100)} %`
                            : f.isLink
                              ? "Link"
                              : formatBytes(f.size)}
                    </span>
                  </li>
                )
              })}
            </ul>
            {stage === "done" && (
              <p className="text-sm">
                {error ? (
                  <span className="text-destructive">{error}</span>
                ) : (
                  summary &&
                  `${summary.downloaded} geladen · ${summary.skipped} übersprungen · ${summary.failed} fehlgeschlagen${summary.cancelled ? " · abgebrochen" : ""}`
                )}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {stage === "options" && (
            <>
              <Button variant="ghost" onClick={onClose}>
                Abbrechen
              </Button>
              <Button onClick={() => start(files)} disabled={!dest}>
                <Download /> Herunterladen
              </Button>
            </>
          )}
          {stage === "running" && (
            <Button variant="outline" onClick={() => api.cancelDownload()}>
              Abbrechen
            </Button>
          )}
          {stage === "done" && (
            <>
              {failed.length > 0 && (
                <Button variant="outline" onClick={() => start(failed)}>
                  <RotateCw /> {failed.length} erneut versuchen
                </Button>
              )}
              {dest && (
                <Button variant="outline" onClick={() => api.openFolder(dest)}>
                  <FolderOpen /> Ordner öffnen
                </Button>
              )}
              <Button
                onClick={() => {
                  onFinished()
                  onClose()
                }}
              >
                Fertig
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
