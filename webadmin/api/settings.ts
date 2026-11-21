import { changedFieldNames, database, ensureSettings, json, methodNotAllowed, queueTelegramLogSafely, readBody, requireAdmin, saveSettings, type VercelRequest, type VercelResponse } from '../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'PUT'].includes(req.method ?? '')) return methodNotAllowed(res, ['GET', 'PUT'])
  if (!requireAdmin(req, res)) return
  try {
    const db = await database()
    if (req.method === 'GET') return json(res, 200, { settings: await ensureSettings(db) })
    const body = readBody(req)
    const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
    const previous = await ensureSettings(db)
    const saved = await saveSettings(db, body, expectedRevision)
    const fields = ['storeName', 'photoStripPrice', 'singlePhotoPrice', 'sessionTimeoutMinutes', 'operationMode', 'paymentEnvironment', 'midtransClientKey']
    const changes = changedFieldNames(
      Object.fromEntries(fields.map((field) => [field, previous[field as keyof typeof previous]])),
      Object.fromEntries(fields.map((field) => [field, saved[field as keyof typeof saved]])),
    )
    if (changes.length) {
      await queueTelegramLogSafely(db, saved.storeId, 'Pengaturan WebAdmin diperbarui', [
        `Bagian berubah: ${changes.join(', ')}`,
      ], `settings:${saved.revision}`)
    }
    return json(res, 200, { settings: saved })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Pengaturan gagal dimuat.'
    return json(res, message.includes('sudah berubah') ? 409 : 400, { error: message })
  }
}
