import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { AppShell } from "@/components/app-shell"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <AppShell />
      </TooltipProvider>
      <Toaster position="bottom-right" />
    </ThemeProvider>
  </StrictMode>,
)
