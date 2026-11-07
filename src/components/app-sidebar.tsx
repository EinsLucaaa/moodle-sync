import { Check, ChevronsUpDown, FileStack, GraduationCap, LayoutGrid, Moon, Plus, Sparkles, Star, Sun, Trash2 } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { Account, Course } from "@/lib/types"

export type NavView = "courses" | "files" | "new"

function AccountAvatar({ account, className }: { account: Account; className?: string }) {
  return (
    <Avatar className={className}>
      {account.icon && <AvatarImage src={account.icon} alt="" />}
      <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
        {(account.siteName || account.username).slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}

export function AppSidebar({
  accounts,
  active,
  demo,
  view,
  courseCount,
  fileCount,
  newCount,
  favorites,
  onView,
  onSelectAccount,
  onAddAccount,
  onRemoveAccount,
  onOpenCourse,
}: {
  accounts: Account[]
  active: Account | null
  demo: boolean
  view: NavView | null
  courseCount: number
  fileCount: number
  newCount: number
  favorites: Course[]
  onView: (view: NavView) => void
  onSelectAccount: (id: string) => void
  onAddAccount: () => void
  onRemoveAccount: (account: Account) => void
  onOpenCourse: (id: number) => void
}) {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Sidebar>
      <SidebarHeader className="pt-10">
        <div className="flex items-center gap-2 px-2 pb-1">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <GraduationCap className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Moodle Sync</span>
          {demo && <Badge variant="secondary">Demo</Badge>}
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="border bg-background shadow-xs" />}>
                {active ? (
                  <AccountAvatar account={active} className="size-8 rounded-lg" />
                ) : (
                  <span className="size-8 rounded-lg bg-muted" />
                )}
                <span className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-medium">{active?.siteName || "Kein Konto"}</span>
                  <span className="truncate text-xs text-muted-foreground">{active?.fullname || active?.username || "Anmelden"}</span>
                </span>
                <ChevronsUpDown className="size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Konten</DropdownMenuLabel>
                  {accounts.map((a) => (
                    <DropdownMenuItem key={a.id} onClick={() => onSelectAccount(a.id)} className="gap-2.5">
                      <AccountAvatar account={a} className="size-6 rounded-md" />
                      <span className="min-w-0 flex-1 truncate">{a.siteName || a.siteUrl}</span>
                      {a.id === active?.id && <Check className="size-4" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onAddAccount}>
                  <Plus /> Konto hinzufügen
                </DropdownMenuItem>
                {active && (
                  <DropdownMenuItem variant="destructive" onClick={() => onRemoveAccount(active)}>
                    <Trash2 /> Konto entfernen
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Übersicht</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={view === "courses"} onClick={() => onView("courses")}>
                  <LayoutGrid /> Kurse
                </SidebarMenuButton>
                <SidebarMenuBadge>{courseCount}</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={view === "files"} onClick={() => onView("files")}>
                  <FileStack /> Alle Dateien
                </SidebarMenuButton>
                <SidebarMenuBadge>{fileCount}</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={view === "new"} onClick={() => onView("new")}>
                  <Sparkles /> Neu seit Download
                </SidebarMenuButton>
                {newCount > 0 && <SidebarMenuBadge className="bg-primary/15 text-primary">{newCount}</SidebarMenuBadge>}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {favorites.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Favoriten</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {favorites.map((c) => (
                  <SidebarMenuItem key={c.id}>
                    <SidebarMenuButton onClick={() => onOpenCourse(c.id)}>
                      <Star className="fill-amber-400 text-amber-400" />
                      <span className="truncate">{c.shortname || c.fullname}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">v0.1</span>
          <Button variant="ghost" size="icon-sm" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
            <Sun className="hidden dark:block" />
            <Moon className="dark:hidden" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
