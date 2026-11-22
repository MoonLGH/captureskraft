import { database, ensureSettings, json, methodNotAllowed, requireAdmin, stringIdCollection, type VercelRequest, type VercelResponse } from '../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  if (!requireAdmin(req, res)) return
  try {
    const db = await database()
    const settings = await ensureSettings(db)
    const [paymentRows, legacyRows, unpaidSessionRows, deviceRows] = await Promise.all([
      db.collection('payments').find({ storeId: settings.storeId }).sort({ paidAt: -1 }).limit(250).toArray(),
      db.collection('sessions').find({ storeId: settings.storeId, paymentStatus: 'paid', paymentOrderId: { $exists: false } }).sort({ createdAt: -1 }).limit(250).toArray(),
      db.collection('sessions').find({ storeId: settings.storeId, paymentStatus: { $in: ['skipped', 'event'] } }).sort({ createdAt: -1 }).limit(250).toArray(),
      db.collection('devices').find({ storeId: settings.storeId }).project({ _id: 1, name: 1 }).toArray(),
    ])
    const relatedSessionKeys = paymentRows
      .filter((row) => typeof row.sessionId === 'string' && row.sessionId)
      .map((row) => `${String(row.deviceId)}:${row.sessionId}`)
    const relatedSessionRows = relatedSessionKeys.length
      ? await stringIdCollection(db, 'sessions').find({ _id: { $in: relatedSessionKeys }, storeId: settings.storeId }).toArray()
      : []
    const relatedSessions = new Map(relatedSessionRows.map((row) => [`${String(row.deviceId)}:${row.sessionId}`, row]))
    const deviceNames = new Map(deviceRows.map((device) => [String(device._id), String(device.name)]))
    const payments = [
      ...paymentRows.map((row) => {
        const session = typeof row.sessionId === 'string' && row.sessionId
          ? relatedSessions.get(`${String(row.deviceId)}:${row.sessionId}`)
          : undefined
        return {
        paymentOrderId: row.paymentOrderId,
        paymentStatus: row.paymentStatus,
        paidAt: row.paidAt,
        amount: row.amount,
        experience: row.experience,
        operationMode: row.operationMode,
        paymentEnvironment: row.paymentEnvironment,
        sessionOutcome: session?.sessionOutcome ?? 'complete',
        customerEmail: row.customerEmail || session?.customerEmail || '',
        driveUploaded: row.driveUploaded === true || session?.driveUploaded === true,
        driveLink: row.driveLink || session?.driveLink || '',
        driveExpiresAt: row.driveExpiresAt || session?.driveExpiresAt || '',
        emailStatus: session?.emailStatus ?? 'disabled',
        emailError: session?.emailError ?? '',
        deviceId: String(row.deviceId ?? ''),
        sessionId: row.sessionId || session?.sessionId || '',
        sessionCreatedAt: row.sessionCreatedAt ?? session?.createdAt ?? null,
        deviceName: row.deviceName ?? deviceNames.get(String(row.deviceId)) ?? 'Booth dihapus',
      }}),
      ...legacyRows.map((row) => ({
        paymentOrderId: '',
        paymentStatus: 'paid',
        paidAt: row.createdAt,
        amount: row.amount,
        experience: row.experience,
        operationMode: row.operationMode,
        paymentEnvironment: 'unknown',
        sessionOutcome: row.sessionOutcome ?? 'complete',
        customerEmail: row.customerEmail ?? '',
        driveUploaded: row.driveUploaded === true,
        driveLink: row.driveLink ?? '',
        driveExpiresAt: row.driveExpiresAt ?? '',
        emailStatus: row.emailStatus ?? 'disabled',
        emailError: row.emailError ?? '',
        deviceId: String(row.deviceId ?? ''),
        sessionId: row.sessionId,
        sessionCreatedAt: row.createdAt,
        deviceName: row.deviceName ?? deviceNames.get(String(row.deviceId)) ?? 'Booth dihapus',
      })),
      ...unpaidSessionRows.map((row) => ({
        paymentOrderId: '',
        paymentStatus: row.paymentStatus,
        paidAt: row.createdAt,
        amount: 0,
        experience: row.experience,
        operationMode: row.operationMode,
        paymentEnvironment: 'unknown',
        sessionOutcome: row.sessionOutcome ?? 'complete',
        customerEmail: row.customerEmail ?? '',
        driveUploaded: row.driveUploaded === true,
        driveLink: row.driveLink ?? '',
        driveExpiresAt: row.driveExpiresAt ?? '',
        emailStatus: row.emailStatus ?? 'disabled',
        emailError: row.emailError ?? '',
        deviceId: String(row.deviceId ?? ''),
        sessionId: row.sessionId,
        sessionCreatedAt: row.createdAt,
        deviceName: row.deviceName ?? deviceNames.get(String(row.deviceId)) ?? 'Booth dihapus',
      })),
    ].sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime()).slice(0, 250)
    return json(res, 200, {
      payments,
    })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Daftar transaksi gagal dimuat.' })
  }
}
