import { AlertCircle, ChevronRight, Eye, EyeOff, FileStack, MoreHorizontal, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { formatBytes } from "@/lib/format"
import type { Course } from "@/lib/types"
import { cn } from "cn"

export interface CourseInfo {
  files: number
  size: number
  newCount: number
  ids: string[]
}

function hue(id: number) {
  return (id * 47) % 360
}

function CourseCard({
  course,
  info,
  selectedCount,
  favorite,
  hidden,
  onOpen,
  onToggleSelect,
  onToggleFav,
  onToggleHidden,
}: {
  course: Course
  info: CourseInfo
  selectedCount: number
  favorite: boolean
  hidden: boolean
  onOpen: () => void
  onToggleSelect: (on: boolean) => void
  onToggleFav: () => void
  onToggleHidden: () => void
}) {
  const h = hue(course.id)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-xs outline-none transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50",
        selectedCount > 0 && "border-primary/50 ring-1 ring-primary/30",
        hidden && "opacity-60",
      )}
    >
      <div
        className="h-1.5"
        style={{ background: `linear-gradient(90deg, oklch(0.72 0.15 ${h}), oklch(0.62 0.18 ${(h + 40) % 360}))` }}
      />
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight">{course.fullname}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{course.shortname}</p>
          </div>
          <div className="-mr-1 flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onToggleFav}
              className={cn(!favorite && "opacity-0 group-hover:opacity-100")}
              aria-label="Favorit"
            >
              <Star className={cn(favorite && "fill-amber-400 text-amber-400")} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100" aria-label="Mehr" />}
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onToggleHidden}>
                  {hidden ? <Eye /> : <EyeOff />} {hidden ? "Einblenden" : "Ausblenden"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {course.progress != null && (
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, course.progress)}%` }} />
          </div>
        )}

        <div className="mt-auto flex items-center gap-2 text-xs text-muted-foreground">
          {course.error ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <AlertCircle className="size-3.5" /> {course.error}
            </span>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <FileStack className="size-3.5" /> {info.files}
              </span>
              <span>· {formatBytes(info.size)}</span>
              {info.newCount > 0 && (
                <span className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                  {info.newCount} neu
                </span>
              )}
              {info.ids.length > 0 && (
                <span className="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {selectedCount > 0 && <span>{selectedCount} gewählt</span>}
                  <Checkbox
                    checked={selectedCount === info.ids.length}
                    indeterminate={selectedCount > 0 && selectedCount < info.ids.length}
                    onCheckedChange={onToggleSelect}
                    aria-label="Ganzen Kurs auswählen"
                  />
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function CourseGrid({
  courses,
  hiddenCourses,
  info,
  selected,
  favs,
  header,
  onOpen,
  onToggle,
  onToggleFav,
  onToggleHidden,
}: {
  courses: Course[]
  hiddenCourses: Course[]
  info: Map<number, CourseInfo>
  selected: Set<string>
  favs: Set<number>
  header: React.ReactNode
  onOpen: (id: number) => void
  onToggle: (ids: string[], on: boolean) => void
  onToggleFav: (id: number) => void
  onToggleHidden: (id: number) => void
}) {
  const card = (c: Course, hidden: boolean) => {
    const i = info.get(c.id) ?? { files: 0, size: 0, newCount: 0, ids: [] }
    return (
      <CourseCard
        key={c.id}
        course={c}
        info={i}
        selectedCount={i.ids.filter((id) => selected.has(id)).length}
        favorite={favs.has(c.id)}
        hidden={hidden}
        onOpen={() => onOpen(c.id)}
        onToggleSelect={(on) => onToggle(i.ids, on)}
        onToggleFav={() => onToggleFav(c.id)}
        onToggleHidden={() => onToggleHidden(c.id)}
      />
    )
  }
  const grid = "grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4"
  return (
    <div className="h-full overflow-y-auto px-6 pb-28 pt-4">
      {header}
      <div className={grid}>{courses.map((c) => card(c, false))}</div>
      {hiddenCourses.length > 0 && (
        <Collapsible className="mt-8">
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-4 transition-transform group-data-[panel-open]:rotate-90" />
            Ausgeblendet ({hiddenCourses.length})
          </CollapsibleTrigger>
          <CollapsibleContent className={cn(grid, "pt-4")}>{hiddenCourses.map((c) => card(c, true))}</CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
