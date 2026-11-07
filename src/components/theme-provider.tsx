import { createContext, useContext, useEffect, useMemo, useState } from "react"

type Theme = "light" | "dark" | "system"

interface ThemeContext {
  theme: Theme
  resolvedTheme: "light" | "dark"
  setTheme: (theme: Theme) => void
}

const Context = createContext<ThemeContext | null>(null)
const KEY = "moodle-sync.theme"

const systemTheme = () => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")

function readStored(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === "light" || v === "dark" || v === "system") return v
  } catch {
    // localStorage nicht verfügbar
  }
  return "system"
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored)
  const [system, setSystem] = useState<"light" | "dark">(systemTheme)

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setSystem(mq.matches ? "dark" : "light")
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  const resolvedTheme = theme === "system" ? system : theme

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark")
  }, [resolvedTheme])

  const value = useMemo<ThemeContext>(
    () => ({
      theme,
      resolvedTheme,
      setTheme: (t) => {
        setThemeState(t)
        try {
          localStorage.setItem(KEY, t)
        } catch {
          // egal
        }
      },
    }),
    [theme, resolvedTheme],
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useTheme() {
  const ctx = useContext(Context)
  if (!ctx) throw new Error("useTheme braucht ThemeProvider")
  return ctx
}
