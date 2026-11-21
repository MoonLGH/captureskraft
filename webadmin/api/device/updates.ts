import { authenticateDevice, ensureSettings, json, methodNotAllowed, stringIdCollection, type VercelRequest, type VercelResponse } from '../../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  try {
    const auth = await authenticateDevice(req, res)
    if (!auth) return
    const settings = await ensureSettings(auth.db)
    if (auth.device.storeId !== settings.storeId) return json(res, 403, { error: 'Booth ini sudah tidak terhubung ke toko aktif.' })

    const deviceId = String(auth.device._id)
    const [config, frames, maintenance] = await Promise.all([
      stringIdCollection(auth.db, 'device_configs').findOne({ _id: deviceId, storeId: settings.storeId }, { projection: { revision: 1 } }),
      stringIdCollection(auth.db, 'device_frame_manifests').findOne({ _id: deviceId, storeId: settings.storeId }, { projection: { revision: 1 } }),
      stringIdCollection(auth.db, 'device_maintenance').findOne({ _id: deviceId, storeId: settings.storeId }, { projection: { status: 1, operationId: 1, targetConfigRevision: 1, targetFrameRevision: 1, updatedAt: 1 } }),
    ])
    const configRevision = typeof config?.revision === 'number' && Number.isSafeInteger(config.revision) ? config.revision : 0
    const frameRevision = typeof frames?.revision === 'number' && Number.isSafeInteger(frames.revision) ? frames.revision : 0
    return json(res, 200, {
      configRevision,
      frameRevision,
      maintenance: maintenance ? {
        status: maintenance.status,
        operationId: maintenance.operationId,
        updatedAt: maintenance.updatedAt ?? null,
        targetConfigRevision: Number.isSafeInteger(maintenance.targetConfigRevision) ? maintenance.targetConfigRevision : null,
        targetFrameRevision: Number.isSafeInteger(maintenance.targetFrameRevision) ? maintenance.targetFrameRevision : null,
      } : null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Status sinkronisasi gagal diperiksa.'
    return json(res, 400, { error: message })
  }
}
