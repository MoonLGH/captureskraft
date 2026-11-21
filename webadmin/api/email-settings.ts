import { cleanEmailSettings, database, ensureEmailSettings, json, methodNotAllowed, readBody, requireAdmin, saveEmailSettings, type VercelRequest, type VercelResponse } from '../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'PUT'].includes(req.method ?? '')) return methodNotAllowed(res, ['GET', 'PUT'])
  if (!requireAdmin(req, res)) return
  try {
    const db = await database()
    if (req.method === 'GET') return json(res, 200, { settings: cleanEmailSettings(await ensureEmailSettings(db)) })
    const body = readBody(req)
    const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
    const settings = await saveEmailSettings(db, body, expectedRevision)
    return json(res, 200, { settings: cleanEmailSettings(settings) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Pengaturan email gagal dimuat.'
    return json(res, message.includes('sudah berubah') ? 409 : 400, { error: message })
  }
}
