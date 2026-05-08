import { createReadStream, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
}

// Hosts the built renderer over 127.0.0.1 so the page has a real http(s)
// origin. file:// and custom schemes (app://, capacitor://) are rejected
// by some embedders — most notably the YouTube IFrame API, which surfaces
// "player error 153" against any non-http(s) parent origin.
//
// Binds to port 0: the OS hands out an unused port, so there is nothing
// to conflict with even if the user has other servers running.
export class RendererServer {
  private server: Server | null = null
  private url: string | null = null
  private expectedHost: string | null = null

  constructor(private readonly root: string) {}

  start(): Promise<string> {
    if (this.url) return Promise.resolve(this.url)

    const server = createServer((req, res) => this.handle(req, res))

    return new Promise<string>((resolve, reject) => {
      const onError = (err: Error) => {
        server.removeListener('listening', onListening)
        reject(err)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        const addr = server.address()
        if (!addr || typeof addr === 'string') {
          reject(new Error('renderer-server: failed to obtain bound address'))
          return
        }
        this.server = server
        this.url = `http://127.0.0.1:${addr.port}`
        this.expectedHost = `127.0.0.1:${addr.port}`
        server.on('error', (e) => console.error('[renderer-server]', e))
        resolve(this.url)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, '127.0.0.1')
    })
  }

  stop() {
    if (!this.server) return
    this.server.close()
    this.server = null
    this.url = null
    this.expectedHost = null
  }

  getUrl(): string | null {
    return this.url
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    // DNS-rebinding defense: reject any request whose Host header is not
    // the literal bound address. A page hosted on attacker.com that DNS-
    // rebinds to 127.0.0.1 still sends `Host: attacker.com:<port>`, which
    // does not match.
    if (req.headers.host !== this.expectedHost) {
      res.statusCode = 421
      res.end()
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.end()
      return
    }

    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
    const decoded = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '')
    let filePath = path.normalize(path.join(this.root, decoded))

    const insideRoot = filePath === this.root || filePath.startsWith(this.root + path.sep)
    if (!insideRoot) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    let isFile = false
    try {
      isFile = statSync(filePath).isFile()
    } catch {
      isFile = false
    }
    // SPA fallback — any non-asset path serves index.html so the client
    // router (history.pushState URLs) survives reload.
    if (!isFile) {
      filePath = path.join(this.root, 'index.html')
    }

    res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    // Defense in depth — block click-jacking (any cross-origin frame) and
    // MIME sniffing.
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-Content-Type-Options', 'nosniff')

    if (req.method === 'HEAD') {
      res.statusCode = 200
      res.end()
      return
    }

    const stream = createReadStream(filePath)
    stream.on('error', (err) => {
      console.error('[renderer-server] read error', err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end('Internal Server Error')
      } else {
        res.end()
      }
    })
    stream.pipe(res)
  }
}
