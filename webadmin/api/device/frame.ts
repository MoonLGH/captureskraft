import { authenticateDevice, ensureSettings, getDeviceFrameAsset, getDeviceFrameAssetBytes, json, methodNotAllowed, readBody, saveDeviceFrameAsset, type VercelRequest, type VercelResponse } from '../../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'PUT'].includes(req.method ?? '')) return methodNotAllowed(res, ['GET', 'PUT'])
  try {
    const auth = await authenticateDevice(req, res)
    if (!auth) return
    const settings = await ensureSettings(auth.db)
    if (auth.device.storeId !== settings.storeId) return json(res, 403, { error: 'Booth ini sudah tidak terhubung ke toko aktif.' })
    const frameId = typeof req.query.frameId === 'string' ? req.query.frameId.trim() : ''
    if (!frameId) return json(res, 400, { error: 'ID frame wajib diisi.' })
    if (req.method === 'GET') {
      if (req.query.format === 'png') {
        const asset = await getDeviceFrameAssetBytes(auth.db, String(auth.device._id), settings.storeId, frameId)
        return res.status(200).setHeader('Content-Type', 'image/png').setHeader('X-Frame-SHA256', asset.sha256).setHeader('Cache-Control', 'private, no-store').end(asset.bytes)
      }
      return json(res, 200, await getDeviceFrameAsset(auth.db, String(auth.device._id), settings.storeId, frameId))
    }
    const body = readBody(req)
    return json(res, 200, await saveDeviceFrameAsset(auth.db, String(auth.device._id), settings.storeId, frameId, body.dataUrl))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PNG frame gagal disinkronkan.'
    return json(res, 400, { error: message })
  }
}
