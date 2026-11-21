import { database, ensureSettings, json, methodNotAllowed, requireAdmin, type VercelRequest, type VercelResponse } from '../server'

function jakartaStart(year: number, month: number, day = 1) {
  return new Date(Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000)
}

function jakartaParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  if (!requireAdmin(req, res)) return
  try {
    const db = await database()
    const settings = await ensureSettings(db)
    const now = new Date()
    const parts = jakartaParts(now)
    const startToday = jakartaStart(parts.year, parts.month, parts.day)
    const startMonth = jakartaStart(parts.year, parts.month)
    const startChart = new Date(startToday.getTime() - 6 * 24 * 60 * 60 * 1000)
    const sessions = db.collection('sessions')
    const payments = db.collection('payments')
    const devices = db.collection('devices')
    const [todaySessions, todayPayments, todayLegacyPayments, monthSessions, monthPayments, monthLegacyPayments, chartSessions, chartPayments, chartLegacyPayments, recentRows, onlineBooths] = await Promise.all([
      sessions.aggregate([
        { $match: { storeId: settings.storeId, createdAt: { $gte: startToday } } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ]).toArray(),
      payments.aggregate([
        { $match: { storeId: settings.storeId, paymentStatus: 'paid', paidAt: { $gte: startToday } } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$amount' } } },
      ]).toArray(),
      sessions.aggregate([
        { $match: { storeId: settings.storeId, paymentStatus: 'paid', paymentOrderId: { $exists: false }, createdAt: { $gte: startToday } } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$amount' } } },
      ]).toArray(),
      sessions.aggregate([
        { $match: { storeId: settings.storeId, createdAt: { $gte: startMonth } } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ]).toArray(),
      payments.aggregate([
        { $match: { storeId: settings.storeId, paymentStatus: 'paid', paidAt: { $gte: startMonth } } },
        { $group: { _id: null, revenue: { $sum: '$amount' } } },
      ]).toArray(),
      sessions.aggregate([
        { $match: { storeId: settings.storeId, paymentStatus: 'paid', paymentOrderId: { $exists: false }, createdAt: { $gte: startMonth } } },
        { $group: { _id: null, revenue: { $sum: '$amount' } } },
      ]).toArray(),
      sessions.aggregate([
        { $match: { storeId: settings.storeId, createdAt: { $gte: startChart } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Jakarta' } },
          sessions: { $sum: 1 },
        } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      payments.aggregate([
        { $match: { storeId: settings.storeId, paymentStatus: 'paid', paidAt: { $gte: startChart } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: 'Asia/Jakarta' } },
          revenue: { $sum: '$amount' },
        } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      sessions.aggregate([
        { $match: { storeId: settings.storeId, paymentStatus: 'paid', paymentOrderId: { $exists: false }, createdAt: { $gte: startChart } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Jakarta' } },
          revenue: { $sum: '$amount' },
        } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      sessions.find({ storeId: settings.storeId }).sort({ createdAt: -1 }).limit(100).toArray(),
      devices.countDocuments({
        storeId: settings.storeId,
        lastSeenAt: { $gte: new Date(Date.now() - 2 * 60_000) },
        revokedAt: null,
        $or: [{ approvedAt: { $exists: true } }, { publicKey: { $exists: false } }],
      }),
    ])
    const deviceRows = await devices.find({ storeId: settings.storeId }).project({ _id: 1, name: 1 }).toArray()
    const deviceNames = new Map(deviceRows.map((device) => [String(device._id), String(device.name)]))
    const sessionsByDate = new Map(chartSessions.map((row) => [String(row._id), row]))
    const revenueByDate = new Map(chartPayments.map((row) => [String(row._id), row]))
    for (const row of chartLegacyPayments) {
      const key = String(row._id)
      revenueByDate.set(key, { revenue: (revenueByDate.get(key)?.revenue ?? 0) + row.revenue })
    }
    const chart = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(startChart.getTime() + index * 24 * 60 * 60 * 1000)
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(day)
      return { date: key, sessions: sessionsByDate.get(key)?.sessions ?? 0, revenue: revenueByDate.get(key)?.revenue ?? 0 }
    })
    return json(res, 200, {
      settings: { storeId: settings.storeId, storeName: settings.storeName },
      metrics: {
        sessionsToday: todaySessions[0]?.count ?? 0,
        paidToday: (todayPayments[0]?.count ?? 0) + (todayLegacyPayments[0]?.count ?? 0),
        revenueToday: (todayPayments[0]?.revenue ?? 0) + (todayLegacyPayments[0]?.revenue ?? 0),
        sessionsMonth: monthSessions[0]?.count ?? 0,
        revenueMonth: (monthPayments[0]?.revenue ?? 0) + (monthLegacyPayments[0]?.revenue ?? 0),
        onlineBooths,
        boothCount: deviceRows.length,
      },
      chart,
      sessions: recentRows.map((row) => ({
        sessionId: row.sessionId,
        createdAt: row.createdAt,
        customerEmail: row.customerEmail ?? '',
        operationMode: row.operationMode,
        paymentStatus: row.paymentStatus,
        paymentOrderId: row.paymentOrderId ?? '',
        experience: row.experience,
        sessionOutcome: row.sessionOutcome ?? 'complete',
        shotCount: Number.isInteger(row.shotCount) ? row.shotCount : 0,
        amount: row.amount,
        driveUploaded: row.driveUploaded === true,
        driveLink: row.driveLink ?? '',
        driveExpiresAt: row.driveExpiresAt ?? '',
        emailStatus: row.emailStatus ?? 'disabled',
        emailError: row.emailError ?? '',
        deviceId: String(row.deviceId ?? ''),
        deviceName: row.deviceName ?? deviceNames.get(String(row.deviceId)) ?? 'Booth dihapus',
      })),
    })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Ringkasan gagal dimuat.' })
  }
}
