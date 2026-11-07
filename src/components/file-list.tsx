import { useVirtualizer } from "@tanstack/react-virtual"
import { Check, Eye } from "lucide-react"
import { useMemo, useRef } from "react"
import { FileIcon } from "@/components/file-icon"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatBytes, formatDate } from "@/lib/format"
import type { FlatFile } from "@/lib/types"
import { cn } from "cn"

export interface FileGroup {
  key: string
  title: string
  files: FlatFile[]
}

type Row = { type: "header"; group: FileGroup } | { type: "file"; file: FlatFile; index: number }

const HEADER_H = 44
const FILE_H = 56

export function FileList({
  groups,
  selected,
  showCourse,
  onToggle,
  onPreview,
}: {
  groups: FileGroup[]
  selected: Set<string>
  showCourse: boolean
  onToggle: (ids: string[], on: boolean) => void
  onPreview: (file: FlatFile) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastClicked = useRef<number | null>(null)

  const { rows, ordered } = useMemo(() => {
    const rows: Row[] = []
    const ordered: FlatFile[] = []
    for (const g of groups) {
      rows.push({ type: "header", group: g })
      for (const f of g.files) {
        rows.push({ type: "file", file: f, index: ordered.length })
        ordered.push(f)
      }
    }
    return { rows, ordered }
  }, [groups])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].type === "header" ? HEADER_H : FILE_H),
    overscan: 12,
  })

  function click(e: React.MouseEvent, f: FlatFile, index: number) {
    const on = !selected.has(f.id)
    if (e.shiftKey && lastClicked.current !== null) {
      const [a, b] = [lastClicked.current, index].sort((x, y) => x - y)
      onToggle(ordered.slice(a, b + 1).map((x) => x.id), on)
    } else {
      onToggle([f.id], on)
    }
    lastClicked.current = index
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-6 pb-28 pt-4">
      <div className="relative overflow-hidden rounded-2xl border bg-card shadow-xs" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index]
          const style = { position: "absolute" as const, top: 0, left: 0, width: "100%", height: v.size, transform: `translateY(${v.start}px)` }
          if (row.type === "header") {
            const ids = row.group.files.map((f) => f.id)
            const sel = ids.filter((id) => selected.has(id)).length
            return (
              <div key={`h-${row.group.key}`} style={style} className="flex items-center gap-3 border-b bg-muted/50 px-4">
                <Checkbox
                  checked={sel === ids.length}
                  indeterminate={sel > 0 && sel < ids.length}
                  onCheckedChange={(on) => onToggle(ids, on)}
                  aria-label="Gruppe auswählen"
                />
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{row.group.title}</h3>
                <span className="text-xs text-muted-foreground">
                  {sel > 0 ? `${sel}/${ids.length}` : ids.length} · {formatBytes(row.group.files.reduce((s, f) => s + f.size, 0))}
                </span>
              </div>
            )
          }
          const f = row.file
          const on = selected.has(f.id)
          return (
            <div
              key={f.id}
              style={style}
              role="checkbox"
              aria-checked={on}
              tabIndex={0}
              onClick={(e) => click(e as unknown as React.MouseEvent, f, row.index)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault()
                  onToggle([f.id], !on)
                }
              }}
              className={cn(
                "group flex cursor-pointer items-center gap-3 border-b px-4 outline-none transition-colors last:border-b-0 hover:bg-muted/50 focus-visible:bg-muted/60",
                on && "bg-primary/5 hover:bg-primary/10",
              )}
            >
              <Checkbox checked={on} tabIndex={-1} className="pointer-events-none" aria-hidden />
              <FileIcon kind={f.kind} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{f.name}</span>
                  {f.status === "new" && <StatusPill className="bg-primary/10 text-primary">Neu</StatusPill>}
                  {f.status === "updated" && <StatusPill className="bg-amber-500/15 text-amber-600 dark:text-amber-400">Geändert</StatusPill>}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[showCourse && f.courseName, f.moduleName !== f.name && f.moduleName, f.folder].filter(Boolean).join(" · ")}
                </div>
              </div>
              {f.status === "synced" && (
                <Tooltip>
                  <TooltipTrigger render={<span className="text-emerald-500" />}>
                    <Check className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent>Bereits geladen</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        onPreview(f)
                      }}
                    />
                  }
                >
                  <Eye />
                </TooltipTrigger>
                <TooltipContent>{f.isLink ? "Link öffnen" : "Vorschau"}</TooltipContent>
              </Tooltip>
              <span className="hidden w-24 text-right text-xs text-muted-foreground lg:block">{formatDate(f.modified)}</span>
              <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">{f.isLink ? "Link" : formatBytes(f.size)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatusPill({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium", className)}>{children}</span>
}
