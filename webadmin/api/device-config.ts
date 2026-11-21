import { changedFieldNames, database, ensureSettings, ensureDeviceConfig, getDeviceFrameManifestStatus, json, methodNotAllowed, queueTelegramLogSafely, readBody, requireAdmin, saveDeviceConfig, stringIdCollection, type VercelRequest, type VercelResponse } from '../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'PUT'].includes(req.method ?? '')) return methodNotAllowed(res, ['GET', 'PUT'])
  if (!requireAdmin(req, res)) return
  try {
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId.trim() : ''
    if (!deviceId) return json(res, 400, { error: 'Pilih booth yang akan dikonfigurasi.' })
    const db = await database()
    const settings = await ensureSettings(db)
    const device = await stringIdCollection(db, 'devices').findOne({ _id: deviceId, storeId: settings.storeId })
    if (!device) return json(res, 404, { error: 'Booth tidak ditemukan di toko ini.' })
    if (!device.approvedAt && device.publicKey) return json(res, 409, { error: 'Setujui booth sebelum mengubah konfigurasinya.' })
    if (req.method === 'GET') {
      const [configStatus, frameStatus] = await Promise.all([
        stringIdCollection(db, 'device_configs').findOne({ _id: deviceId, storeId: settings.storeId }, { projection: { revision: 1 } }),
        getDeviceFrameManifestStatus(db, deviceId, settings.storeId),
      ])
      const revision = typeof configStatus?.revision === 'number' && Number.isSafeInteger(configStatus.revision) ? configStatus.revision : 0
      const requestedRevision = typeof req.query.revision === 'string' ? Number(req.query.revision) : Number.NaN
      const requestedFrameRevision = typeof req.query.frameRevision === 'string' ? Number(req.query.frameRevision) : Number.NaN
      if (Number.isSafeInteger(requestedRevision) && Number.isSafeInteger(requestedFrameRevision)
        && requestedRevision === revision && requestedFrameRevision === frameStatus.revision) {
        return json(res, 200, { unchanged: true, revision, frameRevision: frameStatus.revision })
      }
      const saved = await ensureDeviceConfig(db, deviceId, settings.storeId)
      return json(res, 200, {
        config: { ...saved.config, revision: saved.revision, updatedAt: saved.updatedAt },
        frameRevision: frameStatus.revision,
        device: { id: deviceId, name: device.name },
      })
    }
    const body = readBody(req)
    if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) return json(res, 400, { error: 'Konfigurasi booth tidak valid.' })
    const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
    const previous = await ensureDeviceConfig(db, deviceId, settings.storeId)
    const config = await saveDeviceConfig(db, deviceId, settings.storeId, body.config as Record<string, unknown>, expectedRevision)
    const changes = changedFieldNames(previous.config, config.config)
    if (changes.length) {
      await queueTelegramLogSafely(db, settings.storeId, 'Konfigurasi booth diperbarui di WebAdmin', [
        `Booth: ${device.name}`,
        `Bagian berubah: ${changes.join(', ')}`,
      ], `device-config:${deviceId}:${config.revision}`)
    }
    return json(res, 200, { config: { ...config.config, revision: config.revision, updatedAt: config.updatedAt }, device: { id: deviceId, name: device.name } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Konfigurasi booth gagal dimuat.'
    return json(res, message.includes('sudah berubah') ? 409 : 400, { error: message })
  }
}
