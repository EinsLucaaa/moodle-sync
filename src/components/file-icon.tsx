import { File, FileArchive, Link2, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation } from "lucide-react"
import type { FileKind } from "@/lib/types"
import { cn } from "cn"

const ICONS: Record<FileKind, { icon: typeof File; color: string }> = {
  link: { icon: Link2, color: "text-sky-500 bg-sky-500/10" },
  pdf: { icon: FileText, color: "text-red-500 bg-red-500/10" },
  doc: { icon: FileText, color: "text-blue-500 bg-blue-500/10" },
  slides: { icon: Presentation, color: "text-orange-500 bg-orange-500/10" },
  sheet: { icon: FileSpreadsheet, color: "text-emerald-500 bg-emerald-500/10" },
  image: { icon: FileImage, color: "text-pink-500 bg-pink-500/10" },
  archive: { icon: FileArchive, color: "text-amber-500 bg-amber-500/10" },
  media: { icon: FileVideo, color: "text-violet-500 bg-violet-500/10" },
  code: { icon: FileCode, color: "text-cyan-500 bg-cyan-500/10" },
  other: { icon: File, color: "text-muted-foreground bg-muted" },
}

export function FileIcon({ kind, className }: { kind: FileKind; className?: string }) {
  const { icon: Icon, color } = ICONS[kind]
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", color, className)}>
      <Icon className="size-4" />
    </span>
  )
}
