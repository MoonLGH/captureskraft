import { authenticateDevice, json, methodNotAllowed, readBody, stringIdCollection, validateDevicePublicKey, type VercelRequest, type VercelResponse } from '../../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  try {
    const auth = await authenticateDevice(req, res)
    if (!auth) return
    if (!req.headers.authorization?.startsWith('Bearer ')) return json(res, 400, { error: 'Migrasi identitas hanya tersedia untuk booth lama.' })
    const body = readBody(req)
    const publicKey = validateDevicePublicKey(body.publicKey)
    if (typeof auth.device.publicKey === 'string' && auth.device.publicKey !== publicKey) {
      return json(res, 409, { error: 'Booth ini sudah memiliki identitas lain.' })
    }
    await stringIdCollection(auth.db, 'devices').updateOne(
      { _id: auth.device._id },
      { $set: { publicKey, approvedAt: auth.device.approvedAt ?? new Date(), enrollmentType: 'device-signature' } },
    )
    return json(res, 200, { deviceId: auth.device._id, status: 'approved' })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Migrasi identitas booth gagal.' })
  }
}
