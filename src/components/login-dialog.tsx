"use client"

import { useState } from "react"
import { Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import type { Account } from "@/lib/types"

export function LoginDialog({
  open,
  onOpenChange,
  onLoggedIn,
  dismissible,
  initial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLoggedIn: (account: Account) => void
  dismissible: boolean
  /** Vorbelegung, z. B. wenn der Token abgelaufen ist. */
  initial?: { site: string; user: string }
}) {
  const [site, setSite] = useState(initial?.site ?? "")
  const [user, setUser] = useState(initial?.user ?? "")
  const [pass, setPass] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const account = await api.login(site, user, pass)
      setPass("")
      setSite("")
      setUser("")
      onLoggedIn(account)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (dismissible || o) && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Moodle verbinden</DialogTitle>
          <DialogDescription>
            {initial ? "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an. " : ""}Melde dich mit deinen normalen Moodle-Zugangsdaten an. Dein Passwort wird nicht gespeichert, nur ein
            Zugriffstoken auf diesem Gerät.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="site">Moodle-Adresse</Label>
            <Input id="site" placeholder="moodle.meine-hochschule.de" value={site} onChange={(e) => setSite(e.target.value)} autoFocus={!initial} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user">Benutzername</Label>
            <Input id="user" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pass">Passwort</Label>
            <Input id="pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" autoFocus={!!initial} required />
          </div>
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            {busy ? "Verbinde…" : "Anmelden"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
