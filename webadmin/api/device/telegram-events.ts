import { authenticateDevice, ensureSettings, json, methodNotAllowed, readBody, stringIdCollection, type VercelRequest, type VercelResponse } from '../../server'

declare global {
  var captursTelegramOutboxIndexes: Promise<void> | undefined
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  try {
    const auth = await authenticateDevice(req, res)
    if (!auth) return
    const settings = await ensureSettings(auth.db)
    if (auth.device.storeId !== settings.storeId) return json(res, 403, { error: 'Booth ini sudah tidak terhubung ke toko aktif.' })

    const outbox = stringIdCollection(auth.db, 'telegram_outbox')
    if (!global.captursTelegramOutboxIndexes) {
      global.captursTelegramOutboxIndexes = Promise.all([
        outbox.createIndex({ storeId: 1, status: 1, availableAt: 1, createdAt: 1 }),
        outbox.createIndex({ storeId: 1, status: 1, claimedAt: 1 }),
        outbox.createIndex({ sentAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60, partialFilterExpression: { status: 'sent' } }),
      ]).then(() => undefined)
    }
    try {
      await global.captursTelegramOutboxIndexes
    } catch (error) {
      global.captursTelegramOutboxIndexes = undefined
      throw error
    }

    const body = readBody(req)
    if (body.action === 'claim') {
      const integration = await stringIdCollection(auth.db, 'telegram_integrations').findOne(
        { _id: settings.storeId, storeId: settings.storeId, deviceId: auth.device._id, chatId: { $type: 'string', $ne: '' } },
        { projection: { _id: 1, chatId: 1 } },
      )
      if (!integration) return json(res, 200, { event: null })
      const now = new Date()
      const result = await outbox.findOneAndUpdate(
        {
          storeId: settings.storeId,
          $or: [
            { status: 'pending', availableAt: { $lte: now } },
            { status: 'processing', claimedAt: { $lt: new Date(now.getTime() - 60_000) } },
          ],
        },
        { $set: { status: 'processing', claimedAt: now, claimedBy: auth.device._id }, $inc: { attempts: 1 } },
        { sort: { createdAt: 1 }, returnDocument: 'after' },
      )
      const event = result?.value ?? result
      return json(res, 200, {
        event: event?._id ? { id: event._id, text: event.text, chatId: integration.chatId } : null,
      })
    }

    const eventId = typeof body.eventId === 'string' ? body.eventId : ''
    if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(eventId)) return json(res, 400, { error: 'ID log Telegram tidak valid.' })
    const ownedEvent = { _id: eventId, storeId: settings.storeId, status: 'processing', claimedBy: auth.device._id }
    if (body.action === 'sent') {
      await outbox.updateOne(
        ownedEvent,
        { $set: { status: 'sent', sentAt: new Date() }, $unset: { claimedAt: '', claimedBy: '', lastError: '' } },
      )
      return json(res, 200, { saved: true })
    }
    if (body.action === 'retry') {
      const retryAfterMs = typeof body.retryAfterMs === 'number' && Number.isFinite(body.retryAfterMs)
        ? Math.max(1000, Math.min(body.retryAfterMs, 60 * 60_000))
        : 10_000
      await outbox.updateOne(
        ownedEvent,
        {
          $set: { status: 'pending', availableAt: new Date(Date.now() + retryAfterMs), lastError: 'telegram_delivery_failed' },
          $unset: { claimedAt: '', claimedBy: '' },
        },
      )
      return json(res, 200, { saved: true })
    }
    return json(res, 400, { error: 'Aksi antrean Telegram tidak dikenal.' })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Antrean log Telegram gagal diproses.' })
  }
}
