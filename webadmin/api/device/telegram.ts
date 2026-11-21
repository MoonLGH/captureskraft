import { authenticateDevice, ensureSettings, json, methodNotAllowed, readBody, stringIdCollection, type VercelRequest, type VercelResponse } from '../../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT') return methodNotAllowed(res, ['PUT'])
  try {
    const auth = await authenticateDevice(req, res)
    if (!auth) return
    const settings = await ensureSettings(auth.db)
    if (auth.device.storeId !== settings.storeId) return json(res, 403, { error: 'Booth ini sudah tidak terhubung ke toko aktif.' })

    const body = readBody(req)
    const hasChatId = Object.prototype.hasOwnProperty.call(body, 'chatId')
    const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : ''
    if (hasChatId && typeof body.chatId !== 'string') return json(res, 400, { error: 'Chat ID harus berupa teks angka.' })
    if (chatId && !/^-?\d{1,20}$/.test(chatId)) return json(res, 400, { error: 'Chat ID harus berupa angka dari perintah /id bot.' })
    if (!hasChatId) return json(res, 400, { error: 'Chat ID Telegram belum diatur.' })

    const updatedAt = new Date()
    await stringIdCollection(auth.db, 'telegram_integrations').updateOne(
      { _id: settings.storeId, storeId: settings.storeId },
      {
        $set: { deviceId: auth.device._id, chatId, updatedAt },
        $unset: { botTokenEncrypted: '', updateOffset: '' },
        $setOnInsert: { _id: settings.storeId, storeId: settings.storeId, createdAt: updatedAt },
      },
      { upsert: true },
    )
    return json(res, 200, { saved: true, chatConfigured: Boolean(chatId) })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Pengaturan Telegram gagal disimpan.' })
  }
}
