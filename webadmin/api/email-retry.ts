import { database, ensureEmailSettings, ensureSettings, json, methodNotAllowed, readBody, requireAdmin, stringIdCollection, type VercelRequest, type VercelResponse } from '../server'
import { sendCustomerAbandonedSessionEmail, sendCustomerDriveEmail } from '../email'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  if (!requireAdmin(req, res)) return
  try {
    const body = readBody(req)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : ''
    if (!/^[a-zA-Z0-9_-]{5,100}$/.test(sessionId) || !/^[a-zA-Z0-9_-]{5,200}$/.test(deviceId)) {
      return json(res, 400, { error: 'Identitas sesi tidak valid.' })
    }

    const db = await database()
    const [settings, emailSettings] = await Promise.all([ensureSettings(db), ensureEmailSettings(db)])
    if (!emailSettings.enabled) return json(res, 400, { error: 'Aktifkan pengiriman email di WebAdmin terlebih dahulu.' })

    const sessionKey = `${deviceId}:${sessionId}`
    const sessions = stringIdCollection(db, 'sessions')
    const session = await sessions.findOne({ _id: sessionKey, storeId: settings.storeId })
    if (!session) return json(res, 404, { error: 'Sesi tidak ditemukan di toko ini.' })
    const storedEmail = typeof session.customerEmail === 'string' ? session.customerEmail.trim().toLowerCase() : ''
    const requestedEmail = typeof body.customerEmail === 'string' ? body.customerEmail.trim().toLowerCase() : ''
    const validEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    const customerEmail = validEmail(storedEmail) ? storedEmail : requestedEmail
    const driveLink = typeof session.driveLink === 'string' ? session.driveLink : ''
    const abandoned = session.sessionOutcome === 'abandoned'
    if (!validEmail(customerEmail) || (!abandoned && (session.driveUploaded !== true || !driveLink))) {
      return json(res, 409, { error: 'Email perlu alamat pelanggan dan upload Google Drive yang sudah selesai.' })
    }
    if (!abandoned) {
      try {
        const url = new URL(driveLink)
        if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com') throw new Error('invalid link')
      } catch {
        return json(res, 409, { error: 'Link Google Drive sesi ini tidak valid.' })
      }
    }

    const currentStatus = typeof session.emailStatus === 'string' ? session.emailStatus : 'disabled'
    if (currentStatus === 'accepted') return json(res, 409, { error: 'Email sesi ini sudah diterima server email.' })
    if (currentStatus === 'sending' || currentStatus === 'waiting_upload') return json(res, 409, { error: 'Pengiriman email sesi ini sedang diproses.' })

    const claim = await sessions.updateOne(
      {
        _id: sessionKey,
        storeId: settings.storeId,
        ...(abandoned ? { sessionOutcome: 'abandoned' } : { driveUploaded: true }),
        emailStatus: { $in: ['failed', 'disabled', null] },
      },
      { $set: { customerEmail, emailStatus: 'sending', emailError: '', emailAttemptedAt: new Date() }, $inc: { emailAttempts: 1 } },
    )
    if (claim.modifiedCount !== 1) return json(res, 409, { error: 'Status email sesi berubah. Segarkan daftar sesi lalu coba lagi.' })
    const paymentOrderId = typeof session.paymentOrderId === 'string' ? session.paymentOrderId : ''
    if (paymentOrderId) {
      await stringIdCollection(db, 'payments').updateOne(
        { _id: `${deviceId}:${paymentOrderId}` },
        { $set: { customerEmail, updatedAt: new Date() } },
      ).catch((error) => console.error('[customer-email-retry-payment-update]', error instanceof Error ? error.message : 'Email tidak tercermin pada transaksi.'))
    }

    try {
      if (abandoned) await sendCustomerAbandonedSessionEmail(db, { sessionId, customerEmail })
      else await sendCustomerDriveEmail(db, {
        sessionId,
        customerEmail,
        driveLink,
        driveExpiresAt: typeof session.driveExpiresAt === 'string' ? session.driveExpiresAt : '',
      })
      await sessions.updateOne({ _id: sessionKey, emailStatus: 'sending' }, { $set: { emailStatus: 'accepted', emailError: '', emailAcceptedAt: new Date() } })
      return json(res, 200, { accepted: true, emailStatus: 'accepted' })
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Pengiriman email gagal.'
      await sessions.updateOne({ _id: sessionKey, emailStatus: 'sending' }, { $set: { emailStatus: 'failed', emailError: message } })
      console.error('[customer-email-retry]', message)
      return json(res, 502, { error: message, emailStatus: 'failed' })
    }
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Email gagal dikirim ulang.' })
  }
}
