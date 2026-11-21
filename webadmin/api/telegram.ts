import { database, ensureSettings, json, methodNotAllowed, readBody, requireAdmin, stringIdCollection, type VercelRequest, type VercelResponse } from '../server'

type TelegramIntegration = {
  _id: string
  storeId: string
  deviceId?: string
  chatId?: string
  updatedAt?: Date
}

function toDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null
  const date = value instanceof Date ? value : new Date(value as string | number)
  return Number.isNaN(date.getTime()) ? null : date
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'PUT'].includes(req.method ?? '')) return methodNotAllowed(res, ['GET', 'PUT'])
  if (!requireAdmin(req, res)) return
  try {
    const db = await database()
    const settings = await ensureSettings(db)
    const integrations = stringIdCollection(db, 'telegram_integrations')
    const integration = await integrations.findOne({ _id: settings.storeId, storeId: settings.storeId }) as TelegramIntegration | null

    if (req.method === 'GET') {
      const device = integration?.deviceId
        ? await stringIdCollection(db, 'devices').findOne({ _id: integration.deviceId, storeId: settings.storeId }, { projection: { _id: 1, name: 1, publicKey: 1, approvedAt: 1, revokedAt: 1, lastSeenAt: 1 } })
        : null
      const linked = Boolean(device && !device.revokedAt && (device.approvedAt || !device.publicKey))
      const lastSeenAt = toDate(device?.lastSeenAt)
      return json(res, 200, {
        chatId: integration?.chatId ?? '',
        linked,
        deviceName: linked ? device?.name ?? '' : '',
        deviceOnline: Boolean(linked && lastSeenAt && Date.now() - lastSeenAt.getTime() < 2 * 60_000),
        updatedAt: integration?.updatedAt ?? null,
      })
    }

    const body = readBody(req)
    if (typeof body.chatId !== 'string') return json(res, 400, { error: 'Chat ID harus berupa teks angka.' })
    const chatId = body.chatId.trim()
    if (chatId && !/^-?\d{1,20}$/.test(chatId)) return json(res, 400, { error: 'Chat ID harus berupa angka atau kosong untuk menonaktifkan log.' })
    if (!integration?.deviceId) return json(res, 409, { error: 'Hubungkan bot dari app terlebih dahulu dengan mengirim /id ke bot.' })
    const device = await stringIdCollection(db, 'devices').findOne(
      { _id: integration.deviceId, storeId: settings.storeId },
      { projection: { _id: 1, publicKey: 1, approvedAt: 1, revokedAt: 1 } },
    )
    if (!device || device.revokedAt || (device.publicKey && !device.approvedAt)) {
      return json(res, 409, { error: 'Hubungkan kembali booth aktif dengan mengirim /id dari app.' })
    }

    const updatedAt = new Date()
    await integrations.updateOne(
      { _id: settings.storeId, storeId: settings.storeId },
      { $set: { chatId, updatedAt }, $unset: { botTokenEncrypted: '', updateOffset: '' } },
    )
    return json(res, 200, { saved: true, chatId, updatedAt })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Pengaturan Telegram gagal dimuat.' })
  }
}
