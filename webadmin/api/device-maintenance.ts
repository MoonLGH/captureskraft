import { database, ensureSettings, getDeviceFrameManifestStatus, json, methodNotAllowed, readBody, requireAdmin, stringIdCollection, type VercelRequest, type VercelResponse } from '../server'

type MaintenanceRecord = {
  _id: string
  storeId: string
  status: 'applying' | 'ready'
  operationId: string
  updatedAt?: Date
  targetConfigRevision?: number
  targetFrameRevision?: number
}

function toDate(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const date = value instanceof Date ? value : new Date(value as string | number)
  return Number.isNaN(date.getTime()) ? null : date
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  if (!requireAdmin(req, res)) return
  try {
    const body = readBody(req)
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : ''
    const operationId = typeof body.operationId === 'string' ? body.operationId.trim() : ''
    if (!deviceId || !/^[a-zA-Z0-9_-]{1,100}$/.test(operationId)) {
      return json(res, 400, { error: 'Perangkat atau ID operasi maintenance tidak valid.' })
    }

    const db = await database()
    const settings = await ensureSettings(db)
    const devices = stringIdCollection(db, 'devices')
    const device = await devices.findOne({ _id: deviceId, storeId: settings.storeId })
    if (!device) return json(res, 404, { error: 'Booth tidak ditemukan di toko ini.' })
    if (device.revokedAt || (device.publicKey && !device.approvedAt)) {
      return json(res, 409, { error: 'Setujui booth sebelum mengubah konfigurasinya.' })
    }

    const maintenance = stringIdCollection(db, 'device_maintenance')
    const current = await maintenance.findOne({ _id: deviceId, storeId: settings.storeId }) as MaintenanceRecord | null
    const action = body.action
    if (action === 'heartbeat') {
      const now = new Date()
      const result = await maintenance.updateOne(
        { _id: deviceId, storeId: settings.storeId, status: 'applying', operationId },
        { $set: { updatedAt: now } },
      )
      if (result.matchedCount !== 1) return json(res, 409, { error: 'Operasi maintenance tidak aktif.' })
      return json(res, 200, { active: true, operationId })
    }
    if (action === 'begin') {
      const currentAt = toDate(current?.updatedAt)
      if (current?.status === 'applying' && current.operationId !== operationId
        && currentAt && Date.now() - currentAt.getTime() < 5 * 60_000) {
        return json(res, 409, { error: 'WebAdmin lain sedang menyimpan perubahan untuk booth ini.' })
      }
      const now = new Date()
      await maintenance.updateOne(
        { _id: deviceId, storeId: settings.storeId },
        {
          $set: { status: 'applying', operationId, requestedAt: now, updatedAt: now },
          $unset: { readyAt: '', targetConfigRevision: '', targetFrameRevision: '' },
          $setOnInsert: { _id: deviceId, storeId: settings.storeId },
        },
        { upsert: true },
      )
      return json(res, 200, { started: true, operationId })
    }

    if (action !== 'complete') return json(res, 400, { error: 'Aksi maintenance tidak dikenal.' })
    if (current?.status === 'ready' && current.operationId === operationId) {
      return json(res, 200, { ready: true, operationId, configRevision: current.targetConfigRevision ?? 0, frameRevision: current.targetFrameRevision ?? 0 })
    }
    if (current?.status !== 'applying' || current.operationId !== operationId) {
      return json(res, 409, { error: 'Operasi maintenance sudah diganti atau tidak ditemukan.' })
    }

    const [config, frames] = await Promise.all([
      stringIdCollection(db, 'device_configs').findOne({ _id: deviceId, storeId: settings.storeId }, { projection: { revision: 1 } }),
      getDeviceFrameManifestStatus(db, deviceId, settings.storeId),
    ])
    const configRevision = typeof config?.revision === 'number' && Number.isSafeInteger(config.revision) ? config.revision : 0
    const now = new Date()
    const result = await maintenance.updateOne(
      { _id: deviceId, storeId: settings.storeId, status: 'applying', operationId },
      { $set: { status: 'ready', targetConfigRevision: configRevision, targetFrameRevision: frames.revision, readyAt: now, updatedAt: now } },
    )
    if (result.matchedCount !== 1) return json(res, 409, { error: 'Operasi maintenance berubah sebelum konfigurasi siap diterapkan.' })
    return json(res, 200, { ready: true, operationId, configRevision, frameRevision: frames.revision })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Status maintenance gagal diperbarui.' })
  }
}
