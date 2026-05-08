import 'websocket-polyfill'

import { app, BrowserWindow, nativeTheme, session, shell } from 'electron'
import { useWebSocketImplementation as setWebSocketImpl } from 'nostr-tools/relay'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import WebSocket from 'ws'
import { registerIpcHandlers, unregisterIpcHandlers } from './ipc.js'
import { RelayManager } from './relay-manager.js'
import { RendererServer } from './renderer-server.js'
import { SecretsStore } from './secrets-store.js'
import { Updater } from './updater.js'
import { attachWindowStatePersistence, loadWindowState } from './window-state.js'

// Inject Node's ws so nostr-tools uses it instead of global WebSocket
setWebSocketImpl(WebSocket)

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// vite-plugin-electron injects these at build time
// MAIN_DIST = dist-electron, RENDERER_DIST = dist
process.env.APP_ROOT = path.join(__dirname, '..', '..')
const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null = null
const manager = new RelayManager()
const secrets = new SecretsStore()
// Auto-update is only meaningful for packaged builds — in dev the binary
// is not what would actually be replaced.
const updater = new Updater(app.isPackaged)
const rendererServer = new RendererServer(RENDERER_DIST)
let rendererOrigin: string | null = null

function createWindow() {
  const savedState = loadWindowState()
  win = new BrowserWindow({
    x: savedState.x,
    y: savedState.y,
    width: savedState.width,
    height: savedState.height,
    minWidth: 480,
    minHeight: 480,
    title: 'Jumble',
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171717' : '#ffffff',
    webPreferences: {
      preload: path.join(MAIN_DIST, 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => {
    if (savedState.isMaximized) {
      win?.maximize()
    }
    win?.show()
  })

  attachWindowStatePersistence(win)
  manager.attachWindow(win)
  updater.attachWindow(win)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else if (rendererOrigin) {
    win.loadURL(rendererOrigin + '/')
  }

  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(async () => {
  if (VITE_DEV_SERVER_URL) {
    rendererOrigin = new URL(VITE_DEV_SERVER_URL).origin
  } else {
    try {
      const url = await rendererServer.start()
      rendererOrigin = new URL(url).origin
    } catch (err) {
      console.error('Failed to start renderer server:', err)
      app.quit()
      return
    }
  }

  // Bypass renderer-side CORS by injecting a permissive ACAO header on every
  // cross-origin response. Affects fetch/XHR as well as <video>/<img>/<audio>
  // since they share Chromium's network stack. Scope this to requests
  // initiated by the renderer itself — third-party iframes (e.g. YouTube
  // embeds) make credentialed XHRs where `ACAO: *` is rejected by spec.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    let frameOrigin: string | null = null
    const frameUrl = details.frame?.url
    if (frameUrl) {
      try {
        frameOrigin = new URL(frameUrl).origin
      } catch {
        // ignore unparseable URLs
      }
    }
    if (frameOrigin !== rendererOrigin) {
      callback({})
      return
    }
    const headers = { ...(details.responseHeaders ?? {}) }
    delete headers['access-control-allow-origin']
    delete headers['Access-Control-Allow-Origin']
    headers['Access-Control-Allow-Origin'] = ['*']
    callback({ responseHeaders: headers })
  })

  registerIpcHandlers(manager, secrets, updater)
  createWindow()
  updater.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    manager.shutdown()
    updater.stop()
    rendererServer.stop()
    unregisterIpcHandlers()
    app.quit()
  }
})

app.on('before-quit', () => {
  manager.shutdown()
  updater.stop()
  rendererServer.stop()
})
