import { authenticateDevice, ensureSettings, json, methodNotAllowed, queueTelegramLogSafely, readBody, stringIdCollection, type VercelRequest, type VercelResponse } from '../../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  try {
    const auth = await authenticateDevice(req, res)
    if (!auth) return
    const settings = await ensureSettings(auth.db)
    if (auth.device.storeId !== settings.storeId) return json(res, 403, { error: 'Booth ini sudah tidak terhubung ke toko aktif.' })
    const body = readBody(req)
    const runId = typeof body.runId === 'string' ? body.runId.trim() : ''
    const startedAt = new Date(typeof body.startedAt === 'string' ? body.startedAt : '')
    if (!/^[a-f\d-]{36}$/i.test(runId) || Number.isNaN(startedAt.getTime()) || startedAt.getTime() > Date.now() + 5 * 60_000) {
      return json(res, 400, { error: 'Identitas atau waktu mulai booth tidak valid.' })
    }
    const receivedAt = new Date()
    const collection = stringIdCollection(auth.db, 'device_runs')
    await collection.createIndex({ storeId: 1, startedAt: -1 })
    await stringIdCollection(auth.db, 'devices').updateOne(
      { _id: auth.device._id, storeId: settings.storeId },
      { $max: { lastSeenAt: receivedAt } },
    )
    const result = await collection.updateOne(
      { _id: `${auth.device._id}:${runId}` },
      { $setOnInsert: {
        runId,
        storeId: settings.storeId,
        deviceId: auth.device._id,
        deviceName: auth.device.name,
        startedAt,
        receivedAt,
      } },
      { upsert: true },
    )
    if (result.upsertedCount === 1) {
      await queueTelegramLogSafely(auth.db, settings.storeId, 'Aplikasi booth aktif', [
        `Booth: ${auth.device.name}`,
        `Mulai: ${startedAt.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`,
      ], `run:${auth.device._id}:${runId}`)
    }
    return json(res, 202, { accepted: true, duplicate: result.upsertedCount === 0 })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Log aplikasi booth gagal disimpan.' })
  }
}
