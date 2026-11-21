import { consumeDeviceProof, database, ensureSettings, enrollDevice, json, methodNotAllowed, queueTelegramLogSafely, readBody, stringIdCollection, validateDevicePublicKey, type VercelRequest, type VercelResponse } from '../../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  try {
    const body = readBody(req)
    const db = await database()
    const settings = await ensureSettings(db)
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : ''
    if (!/^[a-f\d-]{36}$/i.test(deviceId)) return json(res, 400, { error: 'ID booth tidak valid.' })
    const tombstone = await stringIdCollection(db, 'revoked_devices').findOne({ _id: deviceId })
    if (tombstone) return json(res, 401, { error: 'Identitas booth ini sudah dihapus. Buat identitas booth baru sebelum mendaftarkannya lagi.' })
    const publicKey = validateDevicePublicKey(body.publicKey)
    const proof = await consumeDeviceProof(db, req, publicKey, deviceId)
    if (proof !== 'accepted') return json(res, 401, { error: 'Identitas booth tidak valid atau permintaan sudah digunakan.' })
    const existing = await stringIdCollection(db, 'devices').findOne({ _id: deviceId })
    const registration = await enrollDevice(db, body, settings.storeId)
    if (!existing && registration.status === 'pending') {
      await queueTelegramLogSafely(db, settings.storeId, 'Booth baru menunggu persetujuan', [
        `Nama: ${typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : `Booth ${deviceId.slice(0, 8)}`}`,
        `ID: ${deviceId}`,
      ], `device-registration:${deviceId}`)
    }
    return json(res, registration.status === 'approved' ? 200 : 202, registration)
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Pendaftaran booth gagal.' })
  }
}
