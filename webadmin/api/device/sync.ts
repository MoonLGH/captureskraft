import { authenticateDevice, changedFieldNames, ensureSettings, ensureDeviceConfig, json, methodNotAllowed, queueTelegramLogSafely, readBody, saveDeviceConfig, type VercelRequest, type VercelResponse } from '../../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'PUT'].includes(req.method ?? '')) return methodNotAllowed(res, ['GET', 'PUT'])
  try {
    const auth = await authenticateDevice(req, res)
    if (!auth) return
    const settings = await ensureSettings(auth.db)
    if (auth.device.storeId !== settings.storeId) return json(res, 403, { error: 'Booth ini sudah tidak terhubung ke toko aktif.' })
    if (req.method === 'PUT') {
      const body = readBody(req)
      if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) return json(res, 400, { error: 'Konfigurasi booth tidak valid.' })
      const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
      const previous = await ensureDeviceConfig(auth.db, String(auth.device._id), settings.storeId)
      const updated = await saveDeviceConfig(auth.db, String(auth.device._id), settings.storeId, body.config as Record<string, unknown>, expectedRevision)
      const changes = changedFieldNames(previous.config, updated.config)
      if (changes.length) {
        await queueTelegramLogSafely(auth.db, settings.storeId, 'Konfigurasi booth diperbarui dari aplikasi', [
          `Booth: ${auth.device.name}`,
          `Bagian berubah: ${changes.join(', ')}`,
        ], `device-config:${auth.device._id}:${updated.revision}`)
      }
      return json(res, 200, { revision: updated.revision, storeId: settings.storeId })
    }
    const deviceConfig = await ensureDeviceConfig(auth.db, String(auth.device._id), settings.storeId)
    return json(res, 200, {
      device: { id: auth.device._id, name: auth.device.name },
      storeId: settings.storeId,
      revision: deviceConfig.revision,
      config: deviceConfig.config,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Konfigurasi cloud gagal disinkronkan.'
    return json(res, message.includes('sudah berubah') ? 409 : 400, { error: message })
  }
}
