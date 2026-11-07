import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { open } from "@tauri-apps/plugin-dialog"
import { mockAccount, mockCancel, mockDownload, mockHistory, mockIndex, mockOn, mockSync } from "./mock"
import type { Account, DownloadItem, DownloadSummary, FileProgress, History, Index } from "./types"

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

export const api = {
  listAccounts: (): Promise<Account[]> =>
    isTauri() ? invoke("list_accounts") : Promise.resolve([mockAccount]),

  login: (siteUrl: string, username: string, password: string): Promise<Account> =>
    isTauri() ? invoke("login", { siteUrl, username, password }) : Promise.resolve(mockAccount),

  removeAccount: (accountId: string): Promise<void> =>
    isTauri() ? invoke("remove_account", { accountId }) : Promise.resolve(),

  loadIndex: (accountId: string): Promise<Index | null> =>
    isTauri() ? invoke("load_index", { accountId }) : Promise.resolve(mockIndex),

  syncIndex: (accountId: string): Promise<Index> =>
    isTauri() ? invoke("sync_index", { accountId }) : mockSync(),

  loadHistory: (accountId: string): Promise<History> =>
    isTauri() ? invoke("load_history", { accountId }) : Promise.resolve(mockHistory),

  refreshIcon: (accountId: string): Promise<string | null> =>
    isTauri() ? invoke("refresh_icon", { accountId }) : Promise.resolve(null),

  preview: (accountId: string, url: string, name: string, isLink: boolean): Promise<void> =>
    isTauri() ? invoke("preview_file", { accountId, url, name, isLink }) : Promise.resolve(),

  download: (accountId: string, dest: string, items: DownloadItem[]): Promise<DownloadSummary> =>
    isTauri() ? invoke("download_files", { accountId, dest, items }) : mockDownload(items),

  cancelDownload: (): Promise<void> => (isTauri() ? invoke("cancel_download") : Promise.resolve(mockCancel())),

  openFolder: (path: string): Promise<void> => (isTauri() ? invoke("open_folder", { path }) : Promise.resolve()),

  pickFolder: async (): Promise<string | null> => {
    if (!isTauri()) return "/Users/demo/Downloads/Moodle"
    const res = await open({ directory: true, multiple: false, title: "Zielordner wählen" })
    return typeof res === "string" ? res : null
  },
}

function on<T>(name: string, cb: (p: T) => void): () => void {
  if (!isTauri()) return mockOn(name, cb as (p: unknown) => void)
  let off: (() => void) | undefined
  let disposed = false
  listen<T>(name, (e) => cb(e.payload)).then((fn) => (disposed ? fn() : (off = fn)))
  return () => {
    disposed = true
    off?.()
  }
}

export const onSyncProgress = (cb: (p: { done: number; total: number; course: string }) => void) =>
  on("sync-progress", cb)

export const onDownloadProgress = (cb: (p: FileProgress & { id: string }) => void) =>
  on("download-progress", cb)
