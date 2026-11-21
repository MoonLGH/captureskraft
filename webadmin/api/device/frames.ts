import { authenticateDevice, ensureSettings, ensureDeviceFrames, frameChangeSummary, getDeviceFrameManifestStatus, json, methodNotAllowed, queueTelegramLogSafely, readBody, saveDeviceFrames, type VercelRequest, type VercelResponse } from '../../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'PUT'].includes(req.method ?? '')) return methodNotAllowed(res, ['GET', 'PUT'])
  try {
    const auth = await authenticateDevice(req, res)
    if (!auth) return
    const settings = await ensureSettings(auth.db)
    if (auth.device.storeId !== settings.storeId) return json(res, 403, { error: 'Booth ini sudah tidak terhubung ke toko aktif.' })
    if (req.method === 'GET') {
      const requestedRevision = typeof req.query.revision === 'string' ? Number(req.query.revision) : Number.NaN
      if (Number.isSafeInteger(requestedRevision)) {
        const status = await getDeviceFrameManifestStatus(auth.db, String(auth.device._id), settings.storeId)
        if (status.revision === requestedRevision) return json(res, 200, { unchanged: true, revision: status.revision })
      }
      const saved = await ensureDeviceFrames(auth.db, String(auth.device._id), settings.storeId)
      return json(res, 200, { manifest: saved.manifest, revision: saved.revision })
    }
    const body = readBody(req)
    if (!Number.isSafeInteger(body.expectedRevision) || !body.manifest) return json(res, 400, { error: 'Manifest frame atau revisi tidak valid.' })
    const previous = await ensureDeviceFrames(auth.db, String(auth.device._id), settings.storeId)
    const saved = await saveDeviceFrames(auth.db, String(auth.device._id), settings.storeId, body.manifest, Number(body.expectedRevision))
    const changes = frameChangeSummary(previous.manifest, saved.manifest)
    if (changes.length) {
      await queueTelegramLogSafely(auth.db, settings.storeId, 'Frame booth diperbarui dari aplikasi', [
        `Booth: ${auth.device.name}`,
        ...changes,
      ], `frames:${auth.device._id}:${saved.revision}`)
    }
    return json(res, 200, { revision: saved.revision })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Daftar frame gagal disinkronkan.'
    return json(res, message.includes('sudah berubah') ? 409 : 400, { error: message })
  }
}
