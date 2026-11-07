import { isTauri } from "./api"

/** Fortschrittsbalken im Dock / in der Taskleiste (null = ausblenden). */
export async function setDockProgress(percent: number | null) {
  if (!isTauri()) return
  try {
    const { getCurrentWindow, ProgressBarStatus } = await import("@tauri-apps/api/window")
    await getCurrentWindow().setProgressBar(
      percent === null
        ? { status: ProgressBarStatus.None }
        : { status: ProgressBarStatus.Normal, progress: Math.round(percent) },
    )
  } catch {
    // nicht kritisch
  }
}

/** Systembenachrichtigung – nur wenn die App nicht im Vordergrund ist. */
export async function notify(title: string, body: string) {
  if (!isTauri() || document.hasFocus()) return
  try {
    const n = await import("@tauri-apps/plugin-notification")
    if (!(await n.isPermissionGranted())) {
      if ((await n.requestPermission()) !== "granted") return
    }
    n.sendNotification({ title, body })
  } catch {
    // nicht kritisch
  }
}
