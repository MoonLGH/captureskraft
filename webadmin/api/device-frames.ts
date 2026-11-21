import { database, ensureDeviceFrames, ensureSettings, frameChangeSummary, getDeviceFrameAsset, getDeviceFrameAssetBytes, getDeviceFrameManifestStatus, json, methodNotAllowed, queueTelegramLogSafely, readBody, requireAdmin, saveDeviceFrameAsset, saveDeviceFrames, stringIdCollection, type VercelRequest, type VercelResponse } from '../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'PUT'].includes(req.method ?? '')) return methodNotAllowed(res, ['GET', 'PUT'])
  if (!requireAdmin(req, res)) return
  try {
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId.trim() : ''
    const frameId = typeof req.query.frameId === 'string' ? req.query.frameId.trim() : ''
    if (!deviceId) return json(res, 400, { error: 'Pilih booth yang akan dikonfigurasi.' })
    const db = await database()
    const settings = await ensureSettings(db)
    const device = await stringIdCollection(db, 'devices').findOne({ _id: deviceId, storeId: settings.storeId })
    if (!device) return json(res, 404, { error: 'Booth tidak ditemukan di toko ini.' })
    if (!device.approvedAt && device.publicKey) return json(res, 409, { error: 'Setujui booth sebelum mengubah konfigurasinya.' })

    if (frameId) {
      if (req.method === 'GET') {
        if (req.query.format === 'png') {
          const asset = await getDeviceFrameAssetBytes(db, deviceId, settings.storeId, frameId)
          return res.status(200).setHeader('Content-Type', 'image/png').setHeader('X-Frame-SHA256', asset.sha256).setHeader('Cache-Control', 'private, no-store').end(asset.bytes)
        }
        return json(res, 200, await getDeviceFrameAsset(db, deviceId, settings.storeId, frameId))
      }
      const body = readBody(req)
      const saved = await saveDeviceFrameAsset(db, deviceId, settings.storeId, frameId, body.dataUrl)
      return json(res, 200, saved)
    }

    if (req.method === 'GET') {
      const requestedRevision = typeof req.query.revision === 'string' ? Number(req.query.revision) : Number.NaN
      if (Number.isSafeInteger(requestedRevision)) {
        const status = await getDeviceFrameManifestStatus(db, deviceId, settings.storeId)
        if (status.revision === requestedRevision) return json(res, 200, { unchanged: true, revision: status.revision, updatedAt: status.updatedAt })
      }
      const saved = await ensureDeviceFrames(db, deviceId, settings.storeId)
      return json(res, 200, { manifest: saved.manifest, revision: saved.revision, updatedAt: saved.updatedAt })
    }
    const body = readBody(req)
    if (!Number.isSafeInteger(body.expectedRevision) || !body.manifest) return json(res, 400, { error: 'Manifest frame atau revisi tidak valid.' })
    const previous = await ensureDeviceFrames(db, deviceId, settings.storeId)
    const saved = await saveDeviceFrames(db, deviceId, settings.storeId, body.manifest, Number(body.expectedRevision))
    const changes = frameChangeSummary(previous.manifest, saved.manifest)
    if (changes.length) {
      await queueTelegramLogSafely(db, settings.storeId, 'Frame booth diperbarui', [
        `Booth: ${device.name}`,
        ...changes,
      ], `frames:${deviceId}:${saved.revision}`)
    }
    return json(res, 200, { manifest: saved.manifest, revision: saved.revision, updatedAt: saved.updatedAt })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Frame booth gagal dimuat.'
    return json(res, message.includes('sudah berubah') ? 409 : 400, { error: message })
  }
}
