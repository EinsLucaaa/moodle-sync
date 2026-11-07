import { FileStack, GraduationCap, Moon, Plus, RefreshCw, Sparkles } from "lucide-react"
import { useState } from "react"
import { FileIcon } from "@/components/file-icon"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatBytes } from "@/lib/format"
import type { Course, FlatFile } from "@/lib/types"

export interface PaletteActions {
  sync: () => void
  addAccount: () => void
  toggleTheme: () => void
  showNew: () => void
}

export function CommandPalette({
  open,
  onOpenChange,
  courses,
  files,
  actions,
  onOpenCourse,
  onOpenFile,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  courses: Course[]
  files: FlatFile[]
  actions: PaletteActions
  onOpenCourse: (id: number) => void
  onOpenFile: (file: FlatFile) => void
}) {
  const [query, setQuery] = useState("")
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const match = (text: string) => tokens.every((t) => text.toLowerCase().includes(t))

  const matchedCourses = courses.filter((c) => match(`${c.fullname} ${c.shortname}`)).slice(0, 6)
  const matchedFiles = tokens.length ? files.filter((f) => match(`${f.name} ${f.moduleName} ${f.courseName}`)).slice(0, 20) : []

  const run = (fn: () => void) => () => {
    onOpenChange(false)
    fn()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setQuery("")
      }}
    >
      <DialogContent showCloseButton={false} className="top-1/3 translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Suche</DialogTitle>
          <DialogDescription>Kurse, Dateien und Aktionen durchsuchen</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="rounded-none! bg-transparent">
          <CommandInput value={query} onValueChange={setQuery} placeholder="Kurse, Dateien oder Aktionen suchen…" />
          <CommandList className="max-h-96">
            <CommandEmpty>Nichts gefunden.</CommandEmpty>
            {matchedCourses.length > 0 && (
              <CommandGroup heading="Kurse">
                {matchedCourses.map((c) => (
                  <CommandItem key={c.id} value={`course-${c.id}`} onSelect={run(() => onOpenCourse(c.id))}>
                    <GraduationCap /> <span className="truncate">{c.fullname}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {matchedFiles.length > 0 && (
              <CommandGroup heading="Dateien">
                {matchedFiles.map((f) => (
                  <CommandItem key={f.id} value={`file-${f.id}`} onSelect={run(() => onOpenFile(f))}>
                    <FileIcon kind={f.kind} className="size-6 rounded-md" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{f.courseName}</span>
                    <CommandShortcut>{formatBytes(f.size)}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!tokens.length && (
              <CommandGroup heading="Aktionen">
                <CommandItem value="action-sync" onSelect={run(actions.sync)}>
                  <RefreshCw /> Neu indexieren
                </CommandItem>
                <CommandItem value="action-new" onSelect={run(actions.showNew)}>
                  <Sparkles /> Neue &amp; geänderte Dateien anzeigen
                </CommandItem>
                <CommandItem value="action-add" onSelect={run(actions.addAccount)}>
                  <Plus /> Konto hinzufügen
                </CommandItem>
                <CommandItem value="action-theme" onSelect={run(actions.toggleTheme)}>
                  <Moon /> Design wechseln
                </CommandItem>
              </CommandGroup>
            )}
            {!tokens.length && (
              <p className="flex items-center gap-2 px-3 pb-3 pt-1 text-xs text-muted-foreground">
                <FileStack className="size-3.5" /> Tippe, um in allen Kursen nach Dateien zu suchen.
              </p>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
