# Moodle Sync

Desktop-App (Tauri 2 + Next.js + shadcn/ui): bei beliebigen Moodle-Instanzen anmelden, alle Kurse indexieren,
Dateien suchen/filtern und gezielt (oder kursweise) in einen Ordner herunterladen.

## Voraussetzungen
- Node + pnpm
- Rust (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`) und Xcode Command Line Tools

## Entwickeln
```bash
pnpm install
pnpm tauri:dev     # Desktop-App
pnpm dev           # nur Frontend im Browser (Demo-Daten)
pnpm tauri:build   # fertige .app / .dmg
```

## Funktionen
- Mehrere Moodle-Konten (Favicon der Hochschule wird automatisch geholt), Konto-Wechsler in der Sidebar
- Index aller Kurse, Dateien und Links; Auto-Aktualisierung beim Start (älter als 6 h)
- **Neu / Geändert**: merkt, was schon geladen wurde; „N Neues laden“ pro Kurs
- Fester Zielordner pro Kurs, Ordnerstruktur wählbar, vorhandene Dateien werden übersprungen
- Suche & Filter (⌘K Palette, `/` Filter, ⌘A alles, Shift-Klick Bereich, Esc zurück), Sortierung, Favoriten, Kurse ausblenden
- Vorschau per Quick Look (macOS), Links als `.webloc`/`.url`
- Wiederholung bei Netzfehlern, Dock-Fortschritt, Benachrichtigung am Ende
- Abgelaufene Sitzung → Login öffnet sich vorbefüllt

## Befehle
```bash
pnpm lint && pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```
`.github/workflows/release.yml` baut bei einem `v*`-Tag Bundles für macOS, Windows und Linux (ungetestet, unsigniert).

## Funktionsweise
- Login über Moodles Mobile-Webservice (`/login/token.php`); das Passwort wird nicht gespeichert, nur der Token
  (`accounts.json` im App-Datenordner, Rechte 600).
- Index: `core_enrol_get_users_courses` + `core_course_get_contents`, lokal gecacht.
- Download: bis zu 4 parallel, Zielpfade werden bereinigt, Token geht nur an den eigenen Moodle-Host.
- Grenze: Instanzen mit reinem SSO/Shibboleth-Login oder deaktiviertem Mobile-Service funktionieren nicht.
