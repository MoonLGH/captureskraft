import { database, json, methodNotAllowed, requireAdmin, type VercelRequest, type VercelResponse } from '../server'
import { verifyEmailSettings } from '../email'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  if (!requireAdmin(req, res)) return
  try {
    const result = await verifyEmailSettings(await database())
    return json(res, 200, result)
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Tes koneksi email gagal.' })
  }
}
