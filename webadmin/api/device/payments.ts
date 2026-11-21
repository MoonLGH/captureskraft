import { authenticateDevice, ensureSettings, json, methodNotAllowed, queueTelegramLogSafely, readBody, stringIdCollection, type VercelRequest, type VercelResponse } from '../../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  try {
    const auth = await authenticateDevice(req, res)
    if (!auth) return
    const settings = await ensureSettings(auth.db)
    if (auth.device.storeId !== settings.storeId) return json(res, 403, { error: 'Booth ini sudah tidak terhubung ke toko aktif.' })
    const body = readBody(req)
    const paymentOrderId = typeof body.paymentOrderId === 'string' ? body.paymentOrderId.trim() : ''
    const paidAt = new Date(typeof body.paidAt === 'string' ? body.paidAt : '')
    const amount = body.amount
    const experience = body.experience
    const operationMode = body.operationMode
    const paymentEnvironment = body.paymentEnvironment
    if (!/^CAPTURS-[\w-]{8,100}$/.test(paymentOrderId) || Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 5 * 60_000) {
      return json(res, 400, { error: 'ID atau waktu pembayaran tidak valid.' })
    }
    if (!Number.isSafeInteger(amount) || Number(amount) < 1 || !['single', 'strip'].includes(String(experience))) {
      return json(res, 400, { error: 'Informasi pesanan tidak valid.' })
    }
    if (!['dev', 'booth'].includes(String(operationMode)) || !['sandbox', 'production'].includes(String(paymentEnvironment))) {
      return json(res, 400, { error: 'Mode pembayaran tidak valid.' })
    }
    const receivedAt = new Date()
    const collection = stringIdCollection(auth.db, 'payments')
    await collection.createIndex({ storeId: 1, paidAt: -1 })
    const result = await collection.updateOne(
      { _id: `${auth.device._id}:${paymentOrderId}` },
      { $setOnInsert: {
        paymentOrderId,
        storeId: settings.storeId,
        deviceId: auth.device._id,
        deviceName: auth.device.name,
        paymentStatus: 'paid',
        paidAt,
        amount: Number(amount),
        experience,
        operationMode,
        paymentEnvironment,
        customerEmail: '',
        driveUploaded: false,
        driveLink: '',
        sessionId: '',
        sessionCreatedAt: null,
        receivedAt,
      } },
      { upsert: true },
    )
    if (result.upsertedCount === 1) {
      await queueTelegramLogSafely(auth.db, settings.storeId, 'Pembayaran diterima', [
        `Booth: ${auth.device.name}`,
        `Transaksi: ${paymentOrderId}`,
        `Jumlah: Rp${Number(amount).toLocaleString('id-ID')}`,
        `Format: ${experience === 'strip' ? 'Photo strip' : 'Foto tunggal'}`,
        `Mode: ${operationMode} · ${paymentEnvironment}`,
      ], `payment:${auth.device._id}:${paymentOrderId}`)
    }
    return json(res, 202, { accepted: true, duplicate: result.upsertedCount === 0 })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Transaksi pembayaran gagal dicatat.' })
  }
}
