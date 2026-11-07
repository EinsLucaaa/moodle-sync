import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { ArrowDownToLine, Command as CommandIcon, Download, FileStack, GraduationCap, HardDrive, Loader2, RefreshCw, Search, Sparkles, X } from "lucide-react"
import { toast } from "sonner"
import { AppSidebar, type NavView } from "@/components/app-sidebar"
import { CommandPalette } from "@/components/command-palette"
import { CourseGrid, type CourseInfo } from "@/components/course-grid"
import { DownloadDialog } from "@/components/download-dialog"
import { FileList, type FileGroup } from "@/components/file-list"
import { LoginDialog } from "@/components/login-dialog"
import { useTheme } from "@/components/theme-provider"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, isTauri, onSyncProgress } from "@/lib/api"
import { flatten, formatBytes, formatRelative, KIND_LABELS, SORT_LABELS, sortFiles } from "@/lib/format"
import { useCoursePrefs } from "@/lib/prefs"
import type { Account, FileKind, FlatFile, History, Index, SortKey } from "@/lib/types"
import { cn } from "cn"

const AUTO_SYNC_AFTER_MS = 6 * 60 * 60 * 1000

type Tab = "courses" | "files"

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)

export function AppShell() {
  const [ready, setReady] = useState(false)
  const demo = useSyncExternalStore(
    () => () => {},
    () => !isTauri(),
    () => false,
  )
  const { resolvedTheme, setTheme } = useTheme()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [index, setIndex] = useState<Index | null>(null)
  const [history, setHistory] = useState<History>({})
  const [sync, setSync] = useState<{ done: number; total: number; course: string } | null>(null)
  const [courseId, setCourseId] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>("courses")
  const [onlyNew, setOnlyNew] = useState(false)
  const [query, setQuery] = useState("")
  const [kinds, setKinds] = useState<FileKind[]>([])
  const [sort, setSort] = useState<SortKey>("moodle")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loginOpen, setLoginOpen] = useState(false)
  const [loginPrefill, setLoginPrefill] = useState<{ site: string; user: string } | undefined>()
  const [downloadFiles, setDownloadFiles] = useState<FlatFile[] | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const filterRef = useRef<HTMLInputElement>(null)
  const accountsRef = useRef<Account[]>([])
  const iconTried = useRef(new Set<string>())
  const prefs = useCoursePrefs(activeId)

  useEffect(() => {
    accountsRef.current = accounts
  }, [accounts])

  const active = accounts.find((a) => a.id === activeId) ?? null

  const handleError = useCallback((title: string, e: unknown, accountId: string) => {
    const msg = String(e)
    if (msg.includes("abgelaufen")) {
      const acc = accountsRef.current.find((a) => a.id === accountId)
      toast.error("Sitzung abgelaufen", { description: "Bitte melde dich erneut an." })
      if (acc) setLoginPrefill({ site: acc.siteUrl, user: acc.username })
      setLoginOpen(true)
    } else {
      toast.error(title, { description: msg })
    }
  }, [])

  const runSync = useCallback(
    async (id: string) => {
      setSync({ done: 0, total: 0, course: "" })
      try {
        setIndex(await api.syncIndex(id))
      } catch (e) {
        handleError("Synchronisierung fehlgeschlagen", e, id)
      } finally {
        setSync(null)
      }
    },
    [handleError],
  )

  const selectAccount = useCallback(
    async (id: string) => {
      setActiveId(id)
      setCourseId(null)
      setTab("courses")
      setOnlyNew(false)
      setQuery("")
      setKinds([])
      setSelected(new Set())
      setIndex(null)
      setHistory({})
      const [cached, hist] = await Promise.all([api.loadIndex(id).catch(() => null), api.loadHistory(id).catch(() => ({}))])
      setHistory(hist)
      if (cached) {
        setIndex(cached)
        // Beim Start im Hintergrund auffrischen, wenn der Stand alt ist.
        if (Date.now() - cached.syncedAt > AUTO_SYNC_AFTER_MS) void runSync(id)
      } else {
        await runSync(id)
      }
    },
    [runSync],
  )

  useEffect(() => {
    api
      .listAccounts()
      .then((list) => {
        setAccounts(list)
        if (list.length) void selectAccount(list[0].id)
        else setLoginOpen(true)
      })
      .catch((e) => toast.error("Konten konnten nicht geladen werden", { description: String(e) }))
      .finally(() => setReady(true))
  }, [selectAccount])

  // Favicons für Konten nachladen, die noch keins haben.
  useEffect(() => {
    for (const a of accounts) {
      if (a.icon || iconTried.current.has(a.id)) continue
      iconTried.current.add(a.id)
      api
        .refreshIcon(a.id)
        .then((icon) => icon && setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, icon } : x))))
        .catch(() => {})
    }
  }, [accounts])

  useEffect(() => onSyncProgress(setSync), [])

  const allFiles = useMemo(() => flatten(index, history), [index, history])
  const fileMap = useMemo(() => new Map(allFiles.map((f) => [f.id, f])), [allFiles])
  const course = index?.courses.find((c) => c.id === courseId) ?? null

  const info = useMemo(() => {
    const map = new Map<number, CourseInfo>()
    for (const c of index?.courses ?? []) map.set(c.id, { files: 0, size: 0, newCount: 0, ids: [] })
    for (const f of allFiles) {
      const i = map.get(f.courseId)!
      i.files++
      i.size += f.size
      i.ids.push(f.id)
      if (f.status !== "synced") i.newCount++
    }
    return map
  }, [index, allFiles])

  const { shownCourses, hiddenCourses } = useMemo(() => {
    const list = index?.courses ?? []
    const rank = (c: { id: number }) => (prefs.favs.has(c.id) ? 0 : 1)
    const visible = list.filter((c) => !prefs.hidden.has(c.id)).sort((a, b) => rank(a) - rank(b))
    return { shownCourses: visible, hiddenCourses: list.filter((c) => prefs.hidden.has(c.id)) }
  }, [index, prefs.favs, prefs.hidden])

  const totals = useMemo(() => {
    let files = 0
    let size = 0
    let fresh = 0
    for (const c of shownCourses) {
      const i = info.get(c.id)
      if (!i) continue
      files += i.files
      size += i.size
      fresh += i.newCount
    }
    return { files, size, fresh }
  }, [shownCourses, info])

  const inCourse = courseId !== null
  const searching = query.trim() !== "" || kinds.length > 0 || onlyNew
  const flatMode = !inCourse && (tab === "files" || searching)

  const visible = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    return allFiles.filter((f) => {
      if (courseId !== null ? f.courseId !== courseId : prefs.hidden.has(f.courseId)) return false
      if (kinds.length && !kinds.includes(f.kind)) return false
      if (onlyNew && f.status === "synced") return false
      const hay = `${f.name} ${f.moduleName} ${f.sectionName} ${f.courseName}`.toLowerCase()
      return tokens.every((t) => hay.includes(t))
    })
  }, [allFiles, courseId, kinds, onlyNew, query, prefs.hidden])

  const groups = useMemo<FileGroup[]>(() => {
    const map = new Map<string, FileGroup>()
    for (const f of visible) {
      const key = courseId !== null ? `s${f.sectionIdx}` : `c${f.courseId}`
      const title = courseId !== null ? f.sectionName : f.courseName
      if (!map.has(key)) map.set(key, { key, title, files: [] })
      map.get(key)!.files.push(f)
    }
    return [...map.values()].map((g) => ({ ...g, files: sortFiles(g.files, sort) }))
  }, [visible, courseId, sort])

  const toggle = useCallback((ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [])

  const selectedFiles = useMemo(
    () => [...selected].map((id) => fileMap.get(id)).filter((f): f is FlatFile => !!f),
    [selected, fileMap],
  )
  const selectedSize = selectedFiles.reduce((s, f) => s + f.size, 0)
  const visibleIds = useMemo(() => visible.map((f) => f.id), [visible])
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const courseNewIds = course ? (info.get(course.id)?.ids ?? []).filter((id) => fileMap.get(id)?.status !== "synced") : []

  function openCourse(id: number | null) {
    setCourseId(id)
    setQuery("")
    setKinds([])
    setOnlyNew(false)
  }

  function showView(view: NavView) {
    setCourseId(null)
    setQuery("")
    setKinds([])
    setTab(view === "courses" ? "courses" : "files")
    setOnlyNew(view === "new")
  }

  const navView: NavView | null = inCourse ? null : onlyNew ? "new" : tab === "files" ? "files" : "courses"

  async function removeAccount(a: Account) {
    await api.removeAccount(a.id)
    const rest = accounts.filter((x) => x.id !== a.id)
    setAccounts(rest)
    if (a.id === activeId) {
      setIndex(null)
      setActiveId(null)
      if (rest.length) void selectAccount(rest[0].id)
      else setLoginOpen(true)
    }
  }

  async function preview(f: FlatFile) {
    if (!activeId) return
    const t = f.isLink ? undefined : toast.loading(`Lade Vorschau für ${f.name}…`)
    try {
      await api.preview(activeId, f.url, f.name, !!f.isLink)
    } catch (e) {
      toast.error("Vorschau nicht möglich", { description: String(e) })
    } finally {
      if (t !== undefined) toast.dismiss(t)
    }
  }

  const refreshHistory = useCallback(() => {
    if (activeId) void api.loadHistory(activeId).then(setHistory)
  }, [activeId])

  // Tastaturkürzel
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      if (paletteOpen || downloadFiles || loginOpen) return
      if (mod && e.key.toLowerCase() === "a" && !isTyping(e.target) && (inCourse || flatMode)) {
        e.preventDefault()
        toggle(visibleIds, !allVisibleSelected)
      } else if (e.key === "/" && !isTyping(e.target)) {
        e.preventDefault()
        filterRef.current?.focus()
      } else if (e.key === "Escape") {
        if (isTyping(e.target)) (e.target as HTMLElement).blur()
        if (selected.size) setSelected(new Set())
        else if (query) setQuery("")
        else if (inCourse) openCourse(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const syncing = sync !== null
  const inFileView = inCourse || flatMode
  const loading = !ready || (!!activeId && !index)

  const stats = (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard icon={GraduationCap} label="Kurse" value={String(shownCourses.length)} />
      <StatCard icon={FileStack} label="Dateien" value={String(totals.files)} />
      <StatCard
        icon={Sparkles}
        label="Neu & geändert"
        value={String(totals.fresh)}
        accent={totals.fresh > 0}
        onClick={totals.fresh > 0 ? () => showView("new") : undefined}
      />
      <StatCard icon={HardDrive} label="Gesamtgröße" value={formatBytes(totals.size)} />
    </div>
  )

  return (
    <SidebarProvider className="h-svh">
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-50 h-9" />
      <AppSidebar
        accounts={accounts}
        active={active}
        demo={demo}
        view={navView}
        courseCount={shownCourses.length}
        fileCount={totals.files}
        newCount={totals.fresh}
        favorites={shownCourses.filter((c) => prefs.favs.has(c.id))}
        onView={showView}
        onSelectAccount={(id) => id !== activeId && void selectAccount(id)}
        onAddAccount={() => {
          setLoginPrefill(undefined)
          setLoginOpen(true)
        }}
        onRemoveAccount={removeAccount}
        onOpenCourse={openCourse}
      />

      <SidebarInset className="min-w-0 overflow-hidden bg-gradient-to-b from-primary/[0.04] to-transparent">
        <header className="flex shrink-0 flex-col gap-3 border-b bg-background/70 px-6 pb-3 pt-12 backdrop-blur">
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <Breadcrumb className="min-w-0 flex-1">
              <BreadcrumbList>
                <BreadcrumbItem>
                  {course ? (
                    <BreadcrumbLink render={<button onClick={() => openCourse(null)} />}>Kurse</BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{onlyNew ? "Neu seit Download" : tab === "files" ? "Alle Dateien" : "Kurse"}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {course && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem className="min-w-0">
                      <BreadcrumbPage className="truncate">{course.fullname}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
            <Button variant="outline" className="w-56 justify-start text-muted-foreground" onClick={() => setPaletteOpen(true)}>
              <Search /> Suchen…
              <Kbd className="ml-auto gap-0.5">
                <CommandIcon className="size-3" />K
              </Kbd>
            </Button>
            <Button variant="outline" disabled={!activeId || syncing} onClick={() => activeId && void runSync(activeId)}>
              {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {syncing ? "Indexiere…" : "Aktualisieren"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!inCourse && (
              <Tabs
                value={tab}
                onValueChange={(v) => {
                  setTab(v as Tab)
                  setOnlyNew(false)
                }}
              >
                <TabsList>
                  <TabsTrigger value="courses">Kurse</TabsTrigger>
                  <TabsTrigger value="files">Alle Dateien</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={filterRef}
                className="select-text pl-8 pr-8"
                placeholder={inCourse ? "In diesem Kurs filtern…" : "Dateien filtern…"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query ? (
                <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setQuery("")}>
                  <X className="size-4" />
                </button>
              ) : (
                <Kbd className="absolute right-2 top-1/2 -translate-y-1/2">/</Kbd>
              )}
            </div>
            <ToggleGroup
              multiple
              value={kinds}
              onValueChange={(v) => setKinds(v as FileKind[])}
              variant="outline"
              size="sm"
              className="flex-wrap"
            >
              {(Object.keys(KIND_LABELS) as FileKind[]).map((k) => (
                <ToggleGroupItem key={k} value={k}>
                  {KIND_LABELS[k]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {inFileView && (
              <>
                <button
                  onClick={() => setOnlyNew((v) => !v)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors",
                    onlyNew ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                  )}
                >
                  <Sparkles className="size-3.5" /> Nur Neues
                </button>
                <Select value={sort} onValueChange={(v) => setSort(v as SortKey)} items={SORT_LABELS}>
                  <SelectTrigger size="sm" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {SORT_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
            <span className="ml-auto flex items-center gap-3">
              {index && <span>Stand: {formatRelative(index.syncedAt)}</span>}
              {course && courseNewIds.length > 0 && (
                <Button
                  size="sm"
                  onClick={() => setDownloadFiles(courseNewIds.map((id) => fileMap.get(id)!).filter(Boolean))}
                >
                  <ArrowDownToLine /> {courseNewIds.length} Neues laden
                </Button>
              )}
              {inFileView && visibleIds.length > 0 && (
                <button className="text-primary hover:underline" onClick={() => toggle(visibleIds, !allVisibleSelected)}>
                  {allVisibleSelected ? "Auswahl aufheben" : `Alle ${visibleIds.length} auswählen`}
                </button>
              )}
            </span>
          </div>

          {syncing && (
            <div className="flex items-center gap-3">
              <Progress value={sync.total ? (sync.done / sync.total) * 100 : null} className="flex-1" />
              <span className="truncate text-xs text-muted-foreground">
                {sync.total ? `${sync.done}/${sync.total}` : "Kurse laden"} {sync.course && `· ${sync.course}`}
              </span>
            </div>
          )}
        </header>

        <div className="relative min-h-0 flex-1">
          {loading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4 p-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-2xl" />
              ))}
            </div>
          ) : !index ? (
            <EmptyState title="Noch kein Konto verbunden" text="Verbinde dein Moodle, um Kurse zu indexieren." />
          ) : inFileView ? (
            groups.length ? (
              <FileList groups={groups} selected={selected} showCourse={!course} onToggle={toggle} onPreview={preview} />
            ) : (
              <EmptyState
                title={onlyNew ? "Alles auf dem neuesten Stand" : "Keine Dateien gefunden"}
                text={course?.error ?? (onlyNew ? "Es gibt nichts Neues oder Geändertes." : "Passe Suche oder Filter an – oder aktualisiere den Index.")}
              />
            )
          ) : shownCourses.length + hiddenCourses.length ? (
            <CourseGrid
              courses={shownCourses}
              hiddenCourses={hiddenCourses}
              info={info}
              selected={selected}
              favs={prefs.favs}
              header={stats}
              onOpen={openCourse}
              onToggle={toggle}
              onToggleFav={prefs.toggleFav}
              onToggleHidden={prefs.toggleHidden}
            />
          ) : (
            <EmptyState title="Keine Kurse" text="Auf diesem Konto sind keine Kurse eingeschrieben." />
          )}

          {selected.size > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
              <div className="pointer-events-auto flex items-center gap-4 rounded-2xl border bg-popover/90 py-2 pl-5 pr-2 shadow-xl backdrop-blur">
                <span className="text-sm">
                  <b>{selected.size}</b> {selected.size === 1 ? "Datei" : "Dateien"} · {formatBytes(selectedSize)}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Leeren <Kbd>esc</Kbd>
                </Button>
                <Button size="lg" onClick={() => setDownloadFiles(selectedFiles)}>
                  <Download /> Herunterladen
                </Button>
              </div>
            </div>
          )}
        </div>
      </SidebarInset>

      <LoginDialog
        key={loginPrefill?.site ?? "new"}
        open={loginOpen}
        onOpenChange={setLoginOpen}
        dismissible={accounts.length > 0}
        initial={loginPrefill}
        onLoggedIn={(account) => {
          setAccounts((prev) => [...prev.filter((a) => a.id !== account.id), account])
          setLoginOpen(false)
          setLoginPrefill(undefined)
          toast.success(`Mit ${account.siteName || account.siteUrl} verbunden`)
          void selectAccount(account.id)
        }}
      />

      {activeId && downloadFiles && (
        <DownloadDialog
          files={downloadFiles}
          accountId={activeId}
          onClose={() => {
            setDownloadFiles(null)
            refreshHistory()
          }}
          onFinished={() => setSelected(new Set())}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        courses={index?.courses ?? []}
        files={allFiles}
        onOpenCourse={openCourse}
        onOpenFile={(f) => {
          openCourse(f.courseId)
          setQuery(f.name)
        }}
        actions={{
          sync: () => activeId && void runSync(activeId),
          addAccount: () => {
            setLoginPrefill(undefined)
            setLoginOpen(true)
          },
          toggleTheme: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
          showNew: () => showView("new"),
        }}
      />
    </SidebarProvider>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  onClick,
}: {
  icon: typeof FileStack
  label: string
  value: string
  accent?: boolean
  onClick?: () => void
}) {
  const Tag = onClick ? "button" : "div"
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-xs",
        onClick && "transition-all hover:-translate-y-0.5 hover:shadow-md",
        accent && "border-primary/30 bg-primary/5",
      )}
    >
      <span className={cn("flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground", accent && "bg-primary/15 text-primary")}>
        <Icon className="size-4.5" />
      </span>
      <span>
        <span className="block text-xl font-semibold tabular-nums leading-tight">{value}</span>
        <span className="block text-xs text-muted-foreground">{label}</span>
      </span>
    </Tag>
  )
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
