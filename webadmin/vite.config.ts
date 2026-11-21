import type { IncomingMessage } from 'node:http'
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { MAX_API_BODY_BYTES } from './configLimits'

type LocalApiRequest = {
  url?: string
  method?: string
  headers: {
    cookie?: string
    authorization?: string
    'x-booth-id'?: string
    'x-booth-time'?: string
    'x-booth-nonce'?: string
    'x-booth-signature'?: string
  }
  body?: unknown
  query: Record<string, string | string[] | undefined>
}

type LocalApiResponse = {
  status(code: number): LocalApiResponse
  setHeader(name: string, value: string | number | readonly string[]): LocalApiResponse
  json(body: unknown): void
  end(body?: string | Buffer): void
}

type ApiHandler = (request: LocalApiRequest, response: LocalApiResponse) => unknown

const apiModules: Record<string, string> = {
  '/api/dashboard': '/api/dashboard.ts',
  '/api/email-settings': '/api/email-settings.ts',
  '/api/email-settings-test': '/api/email-settings-test.ts',
  '/api/email-retry': '/api/email-retry.ts',
  '/api/device-config': '/api/device-config.ts',
  '/api/device-frames': '/api/device-frames.ts',
  '/api/device-maintenance': '/api/device-maintenance.ts',
  '/api/devices': '/api/devices.ts',
  '/api/login': '/api/login.ts',
  '/api/logout': '/api/logout.ts',
  '/api/me': '/api/me.ts',
  '/api/payments': '/api/payments.ts',
  '/api/settings': '/api/settings.ts',
  '/api/telegram': '/api/telegram.ts',
  '/api/device/payments': '/api/device/payments.ts',
  '/api/device/register': '/api/device/register.ts',
  '/api/device/identity': '/api/device/identity.ts',
  '/api/device/runs': '/api/device/runs.ts',
  '/api/device/sessions': '/api/device/sessions.ts',
  '/api/device/telegram': '/api/device/telegram.ts',
  '/api/device/telegram-events': '/api/device/telegram-events.ts',
  '/api/device/sync': '/api/device/sync.ts',
  '/api/device/updates': '/api/device/updates.ts',
  '/api/device/frames': '/api/device/frames.ts',
  '/api/device/frame': '/api/device/frame.ts',
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_API_BODY_BYTES) throw Object.assign(new Error('Isi request melewati batas 4,49 MB.'), { statusCode: 413 })
    chunks.push(buffer)
  }
  if (!size) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw Object.assign(new Error('Isi request tidak valid.'), { statusCode: 400 })
  }
}

function queryParams(searchParams: URLSearchParams) {
  const query: Record<string, string | string[] | undefined> = {}
  searchParams.forEach((value, key) => {
    const existing = query[key]
    query[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value]
  })
  return query
}

function localApiPlugin(): Plugin {
  return {
    name: 'capturs-local-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()
        const modulePath = apiModules[url.pathname]
        if (!modulePath) {
          response.statusCode = 404
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ error: 'Endpoint API tidak ditemukan.' }))
          return
        }

        try {
          const body = ['POST', 'PUT', 'PATCH'].includes(request.method ?? '') ? await readJsonBody(request) : undefined
          const module = await server.ssrLoadModule(modulePath) as { default: ApiHandler }
          const apiResponse: LocalApiResponse = {
            status(code) {
              response.statusCode = code
              return apiResponse
            },
            setHeader(name, value) {
              response.setHeader(name, value)
              return apiResponse
            },
            json(payload) {
              response.setHeader('Content-Type', 'application/json; charset=utf-8')
              response.end(JSON.stringify(payload))
            },
            end(body) {
              response.end(body)
            },
          }
          const cookie = request.headers.cookie
          const authorization = request.headers.authorization
          await module.default({
            method: request.method,
            headers: {
              ...(typeof cookie === 'string' ? { cookie } : {}),
              ...(typeof authorization === 'string' ? { authorization } : {}),
              ...(typeof request.headers['x-booth-id'] === 'string' ? { 'x-booth-id': request.headers['x-booth-id'] } : {}),
              ...(typeof request.headers['x-booth-time'] === 'string' ? { 'x-booth-time': request.headers['x-booth-time'] } : {}),
              ...(typeof request.headers['x-booth-nonce'] === 'string' ? { 'x-booth-nonce': request.headers['x-booth-nonce'] } : {}),
              ...(typeof request.headers['x-booth-signature'] === 'string' ? { 'x-booth-signature': request.headers['x-booth-signature'] } : {}),
            },
            url: request.url,
            body,
            query: queryParams(url.searchParams),
          }, apiResponse)
          if (!response.writableEnded) response.end()
        } catch (error) {
          const failure = error as Error & { statusCode?: number }
          if (!response.headersSent) {
            response.statusCode = failure.statusCode ?? 500
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({ error: failure.statusCode ? failure.message : 'Terjadi kesalahan server lokal.' }))
          } else if (!response.writableEnded) {
            response.end()
          }
          if (!failure.statusCode) console.error('[webadmin local API]', error)
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react(), localApiPlugin()],
    server: { host: '127.0.0.1', port: 4114, strictPort: true },
    preview: { host: '127.0.0.1', port: 4114, strictPort: true },
  }
})
