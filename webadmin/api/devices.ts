import { database, ensureSettings, ensureDeviceConfig, json, methodNotAllowed, queueTelegramLogSafely, readBody, requireAdmin, stringIdCollection, type VercelRequest, type VercelResponse } from '../server'

function toDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null
  const date = value instanceof Date ? value : new Date(value as string | number)
  return Number.isNaN(date.getTime()) ? null : date
}

function latestDate(...values: unknown[]) {
  return values.map(toDate).filter((value): value is Date => value !== null).sort((left, right) => right.getTime() - left.getTime())[0] ?? null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method ?? '')) return methodNotAllowed(res, ['GET', 'POST', 'DELETE'])
  if (!requireAdmin(req, res)) return
  try {
    const db = await database()
    const collection = db.collection<{ _id: string; storeId: string; name: string; tokenHash?: string; publicKey?: string; approvedAt?: Date; revokedAt?: Date | null; createdAt: Date; lastSeenAt: Date | null; lastSignatureAt?: Date | null }>('devices')
    await collection.createIndex({ tokenHash: 1 }, { unique: true })
    await collection.createIndex({ storeId: 1, createdAt: -1 })
    const settings = await ensureSettings(db)

    if (req.method === 'GET') {
      const [devices, runRows, latestRunRows, latestSessionRows, latestPaymentRows] = await Promise.all([
        collection.find({ storeId: settings.storeId }).sort({ createdAt: -1 }).project<{
          _id: string
          storeId: string
          name: string
          publicKey?: string
          approvedAt?: Date
          revokedAt?: Date | null
          createdAt: Date
          lastSeenAt: Date | null
          lastSignatureAt?: Date | null
        }>({ tokenHash: 0 }).toArray(),
        (async () => {
          const runs = db.collection('device_runs')
          await runs.createIndex({ storeId: 1, startedAt: -1 })
          await runs.createIndex({ storeId: 1, receivedAt: -1 })
          return runs.find({ storeId: settings.storeId }).sort({ receivedAt: -1 }).limit(200).toArray()
        })(),
        (async () => {
          const runs = db.collection('device_runs')
          await runs.createIndex({ storeId: 1, receivedAt: -1 })
          return runs.aggregate([
            { $match: { storeId: settings.storeId } },
            { $sort: { receivedAt: -1 } },
            { $group: { _id: '$deviceId', receivedAt: { $first: '$receivedAt' } } },
          ]).toArray()
        })(),
        (async () => {
          const sessions = db.collection('sessions')
          await sessions.createIndex({ storeId: 1, receivedAt: -1 })
          return sessions.aggregate([
            { $match: { storeId: settings.storeId } },
            { $sort: { receivedAt: -1 } },
            { $group: { _id: '$deviceId', receivedAt: { $first: '$receivedAt' } } },
          ]).toArray()
        })(),
        (async () => {
          const payments = db.collection('payments')
          await payments.createIndex({ storeId: 1, receivedAt: -1 })
          return payments.aggregate([
            { $match: { storeId: settings.storeId } },
            { $sort: { receivedAt: -1 } },
            { $group: { _id: '$deviceId', receivedAt: { $first: '$receivedAt' } } },
          ]).toArray()
        })(),
      ])
      const deviceNames = new Map(devices.map((device) => [String(device._id), String(device.name)]))
      const lastRunByDevice = new Map(latestRunRows.map((run) => [String(run._id), run.receivedAt as Date]))
      const lastSessionByDevice = new Map(latestSessionRows.map((row) => [String(row._id), row.receivedAt]))
      const lastPaymentByDevice = new Map(latestPaymentRows.map((row) => [String(row._id), row.receivedAt]))
      const now = Date.now()
      const devicesWithLastSeen = devices.map((device) => {
        const id = String(device._id)
        const lastSeenAt = latestDate(
          device.lastSeenAt,
          device.lastSignatureAt,
          lastRunByDevice.get(id),
          lastSessionByDevice.get(id),
          lastPaymentByDevice.get(id),
        )
        const status = device.revokedAt ? 'revoked' : device.publicKey && !device.approvedAt ? 'pending' : 'approved'
        return {
          ...device,
          lastSeenAt,
          status,
          isOnline: status === 'approved' && Boolean(lastSeenAt && now - lastSeenAt.getTime() < 120_000),
          configRevision: 0,
        }
      })
      const configs = await db.collection('device_configs').find({ storeId: settings.storeId }).project({ _id: 1, revision: 1 }).toArray()
      const configRevisions = new Map(configs.map((item) => [String(item._id), Number.isSafeInteger(item.revision) ? Number(item.revision) : 0]))
      for (const device of devicesWithLastSeen) device.configRevision = configRevisions.get(String(device._id)) ?? 0
      const runs = runRows.map((run) => ({
        runId: run.runId,
        deviceName: run.deviceName ?? deviceNames.get(String(run.deviceId)) ?? 'Booth dihapus',
        startedAt: run.startedAt,
        receivedAt: run.receivedAt,
      }))
      return json(res, 200, { devices: devicesWithLastSeen, runs })
    }

    if (req.method === 'DELETE') {
      const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : ''
      if (!deviceId) return json(res, 400, { error: 'ID booth wajib diisi.' })
      const device = await collection.findOne({ _id: deviceId, storeId: settings.storeId })
      if (!device) return json(res, 404, { error: 'Booth tidak ditemukan.' })
      if (req.query.permanent === 'true') {
        if (!device.revokedAt) return json(res, 409, { error: 'Cabut akses booth sebelum menghapus entry permanen.' })

        const removedAt = new Date()
        await stringIdCollection(db, 'revoked_devices').updateOne(
          { _id: deviceId },
          { $setOnInsert: { _id: deviceId, storeId: settings.storeId, name: device.name, publicKey: device.publicKey ?? '', revokedAt: device.revokedAt, removedAt } },
          { upsert: true },
        )
        const snapshot = { $set: { deviceName: device.name } }
        await Promise.all([
          db.collection('device_runs').updateMany({ storeId: settings.storeId, deviceId, deviceName: { $exists: false } }, snapshot),
          db.collection('sessions').updateMany({ storeId: settings.storeId, deviceId, deviceName: { $exists: false } }, snapshot),
          db.collection('payments').updateMany({ storeId: settings.storeId, deviceId, deviceName: { $exists: false } }, snapshot),
        ])
        await stringIdCollection(db, 'device_configs').deleteOne({ _id: deviceId, storeId: settings.storeId })
        await Promise.all([
          stringIdCollection(db, 'device_frame_manifests').deleteOne({ _id: deviceId, storeId: settings.storeId }),
          db.collection('device_frame_assets').deleteMany({ deviceId, storeId: settings.storeId }),
        ])
        await queueTelegramLogSafely(db, settings.storeId, 'Perangkat booth dihapus permanen', [
          `Booth: ${device.name}`,
          `ID: ${deviceId}`,
        ])
        await collection.deleteOne({ _id: deviceId, storeId: settings.storeId, revokedAt: { $exists: true } })
        return json(res, 200, { removed: true, permanent: true })
      }
      const result = await collection.updateOne({ _id: deviceId, storeId: settings.storeId }, { $set: { revokedAt: new Date() } })
      if (result.modifiedCount === 1) {
        await queueTelegramLogSafely(db, settings.storeId, 'Akses booth dicabut', [
          `Booth: ${device.name}`,
          `ID: ${deviceId}`,
        ])
      }
      return json(res, 200, { revoked: true })
    }

    const body = readBody(req)
    const action = typeof body.action === 'string' ? body.action : ''
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : ''
    const device = await collection.findOne({ _id: deviceId, storeId: settings.storeId })
    if (!device) return json(res, 404, { error: 'Booth tidak ditemukan.' })
    if (action === 'approve') {
      if (!device.publicKey) return json(res, 409, { error: 'Booth ini memakai pairing lama dan sudah aktif.' })
      await collection.updateOne({ _id: deviceId, storeId: settings.storeId }, { $set: { approvedAt: device.approvedAt ?? new Date(), revokedAt: null } })
      const config = await ensureDeviceConfig(db, deviceId, settings.storeId)
      if (!device.approvedAt) {
        await queueTelegramLogSafely(db, settings.storeId, 'Booth disetujui', [
          `Booth: ${device.name}`,
          `ID: ${deviceId}`,
        ])
      }
      return json(res, 200, { approved: true, configRevision: config.revision })
    }
    if (action === 'rename') {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > 80) return json(res, 400, { error: 'Nama booth wajib diisi dan maksimal 80 karakter.' })
      await collection.updateOne({ _id: deviceId, storeId: settings.storeId }, { $set: { name } })
      if (name !== device.name) {
        await queueTelegramLogSafely(db, settings.storeId, 'Nama booth diperbarui', [
          `Sebelumnya: ${device.name}`,
          `Sekarang: ${name}`,
        ])
      }
      return json(res, 200, { renamed: true })
    }
    return json(res, 400, { error: 'Aksi perangkat tidak dikenali.' })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Daftar booth gagal dimuat.' })
  }
}
