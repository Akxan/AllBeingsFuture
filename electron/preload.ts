/**
 * Electron Preload Script
 *
 * Exposes a safe IPC bridge to the renderer process via contextBridge.
 *
 * The renderer calls window.electronAPI.invoke(channel, ...args)
 * which maps to ipcMain.handle(channel, ...) in the main process.
 *
 * Also provides event listening for push events from main → renderer.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ---- IPC Bridge ----

const electronAPI = {
  /**
   * Generic invoke: calls ipcMain.handle(channel, ...args)
   * All service bindings use this.
   */
  invoke: (channel: string, ...args: any[]) => {
    return ipcRenderer.invoke(channel, ...args)
  },

  /**
   * Listen to events pushed from main process.
   * Returns an unsubscribe function.
   */
  on: (channel: string, callback: (...args: any[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: any[]) => {
      callback(...args)
    }
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },

  /**
   * Listen to an event once.
   */
  once: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.once(channel, (_event, ...args) => {
      callback(...args)
    })
  },

  /**
   * Send a one-way message to main (no response).
   */
  send: (channel: string, ...args: any[]) => {
    ipcRenderer.send(channel, ...args)
  },

  /**
   * Get the file system path for a File object (Electron 29+).
   * Returns empty string if the File has no backing path.
   */
  getPathForFile: (file: File): string => {
    try {
      const p = webUtils.getPathForFile(file)
      if (p) return p
    } catch { /* ignore */ }
    return (file as any).path || ''
  },
}

// Expose to renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// ---- Utility: get file path from a File object ----
// Electron 29+ recommends webUtils.getPathForFile() over the deprecated File.path.
// webUtils.getPathForFile() works reliably with contextIsolation.
function getFilePath(file: File): string {
  try {
    const p = webUtils.getPathForFile(file)
    if (p) return p
  } catch { /* ignore */ }
  // Fallback for older Electron or edge cases
  return (file as any).path || ''
}

// ---- Native File/Folder Drop Handler ----
// In contextIsolation mode, webUtils.getPathForFile() and File.path may both fail
// to return the filesystem path. As a robust fallback (sandbox: false gives us
// Node.js access), we read the file content via the web File API and save it to
// a temp directory using Node.js fs, then relay the temp path via IPC.

const DROP_TEMP_DIR = path.join(os.tmpdir(), 'abf-drops')

function saveFileToTemp(file: File): Promise<string> {
  return file.arrayBuffer().then((buf) => {
    fs.mkdirSync(DROP_TEMP_DIR, { recursive: true })
    const safeName = file.name.replace(/[<>:"|?*]/g, '_')
    const tempPath = path.join(DROP_TEMP_DIR, `${Date.now()}-${safeName}`)
    fs.writeFileSync(tempPath, Buffer.from(buf))
    return tempPath
  })
}

// Global dragover prevention — required for the browser to allow drop events.
// Without this, the default behavior is to deny drops (and navigate to the file).
document.addEventListener('dragover', (event) => {
  event.preventDefault()
})

// Use capture phase so this fires BEFORE React's synthetic event handler,
// ensuring we extract file paths before any other handler might clear dataTransfer.
document.addEventListener('drop', (event) => {
  event.preventDefault()

  const paths: string[] = []
  const pendingFiles: File[] = []
  const seen = new Set<string>()

  const addPath = (p: string | undefined | null) => {
    if (p && !seen.has(p)) {
      seen.add(p)
      paths.push(p)
    }
  }

  // Collect all File objects first
  const allFiles: File[] = []
  const fileList = event.dataTransfer?.files
  if (fileList) {
    for (let i = 0; i < fileList.length; i++) {
      allFiles.push(fileList[i])
    }
  }
  // Fallback: items API — handles edge cases (e.g., folders on some Windows/Electron versions)
  if (allFiles.length === 0 && event.dataTransfer?.items) {
    for (let i = 0; i < event.dataTransfer.items.length; i++) {
      const item = event.dataTransfer.items[i]
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file) allFiles.push(file)
    }
  }

  // Try to resolve paths; collect failures for async fallback
  for (const file of allFiles) {
    const p = getFilePath(file)
    if (p) {
      addPath(p)
    } else {
      pendingFiles.push(file)
    }
  }

  // Send immediately resolved paths
  if (paths.length > 0) {
    ipcRenderer.send('native-files-dropped', paths)
  }

  // For files where path extraction failed: read content and save to temp dir
  if (pendingFiles.length > 0) {
    Promise.all(pendingFiles.map((f) => saveFileToTemp(f).catch(() => null)))
      .then((tempPaths) => {
        const valid = tempPaths.filter((p): p is string => !!p)
        if (valid.length > 0) {
          ipcRenderer.send('native-files-dropped', valid)
        }
      })
  }
}, true)

// Type declaration for renderer
export type ElectronAPI = typeof electronAPI
