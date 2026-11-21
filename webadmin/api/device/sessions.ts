import { ensureEmailSettings, ensureSettings, json, methodNotAllowed, readBody, authenticateDevice, queueTelegramLogSafely, stringIdCollection, type VercelRequest, type VercelResponse } from '../../server'
import { sendCustomerAbandonedSessionEmail, sendCustomerDriveEmail } from '../../email'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  try {
    const auth = await authenticateDevice(req, res)
    if (!auth) return
    const body = readBody(req)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
    const createdAt = new Date(typeof body.createdAt === 'string' ? body.createdAt : '')
    const customerEmail = typeof body.customerEmail === 'string' ? body.customerEmail.trim().toLowerCase() : ''
    const operationMode = body.operationMode
    const paymentStatus = body.paymentStatus
    const experience = body.experience
    const sessionOutcome = body.sessionOutcome ?? 'complete'
    const shotCount = body.shotCount === undefined ? 0 : Number(body.shotCount)
    const amount = body.amount
    if (!/^[a-zA-Z0-9_-]{5,100}$/.test(sessionId) || Number.isNaN(createdAt.getTime()) || createdAt.getTime() > Date.now() + 5 * 60_000) {
      return json(res, 400, { error: 'Identitas atau waktu sesi tidak valid.' })
    }
    if (!['dev', 'booth', 'event'].includes(String(operationMode)) || !['paid', 'skipped', 'event'].includes(String(paymentStatus)) || !['single', 'strip'].includes(String(experience))) {
      return json(res, 400, { error: 'Informasi sesi tidak valid.' })
    }
    if (!['complete', 'partial', 'abandoned'].includes(String(sessionOutcome)) || !Number.isInteger(shotCount) || Number(shotCount) < 0 || Number(shotCount) > 10
      || sessionOutcome === 'abandoned' && Number(shotCount) !== 0) return json(res, 400, { error: 'Status penyelesaian sesi tidak valid.' })
    if (customerEmail && (customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))) return json(res, 400, { error: 'Email pelanggan tidak valid.' })
    if (operationMode === 'booth' && paymentStatus !== 'paid' || operationMode === 'event' && paymentStatus !== 'event' || operationMode === 'dev' && !['paid', 'skipped'].includes(String(paymentStatus))) {
      return json(res, 400, { error: 'Status pembayaran tidak cocok dengan mode booth.' })
    }
    if (!Number.isSafeInteger(amount) || Number(amount) < 0 || paymentStatus === 'paid' && Number(amount) < 1) return json(res, 400, { error: 'Nilai transaksi tidak valid.' })
    const paymentOrderId = typeof body.paymentOrderId === 'string' ? body.paymentOrderId.trim() : ''
    const paidAtValue = typeof body.paidAt === 'string' && body.paidAt
      ? body.paidAt
      : typeof body.createdAt === 'string' ? body.createdAt : ''
    const paidAt = new Date(paidAtValue)
    if (paymentStatus === 'paid' && !/^CAPTURS-[\w-]{8,100}$/.test(paymentOrderId)) return json(res, 400, { error: 'ID transaksi pembayaran tidak valid.' })
    if (paymentStatus === 'paid' && (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 5 * 60_000)) return json(res, 400, { error: 'Waktu pembayaran tidak valid.' })
    const driveLink = typeof body.driveLink === 'string' ? body.driveLink.trim() : ''
    if (driveLink) {
      try {
        const url = new URL(driveLink)
        if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com') throw new Error('invalid link')
      } catch {
        return json(res, 400, { error: 'Link Google Drive tidak valid.' })
      }
    }
    const driveUploaded = body.driveUploaded === true
    const driveExpiresAtValue = typeof body.driveExpiresAt === 'string' ? body.driveExpiresAt : ''
    const driveExpiresAt = driveExpiresAtValue ? new Date(driveExpiresAtValue) : null
    if (driveExpiresAtValue && (!driveUploaded || Number.isNaN(driveExpiresAt?.getTime()))) {
      return json(res, 400, { error: 'Waktu retensi Google Drive tidak valid.' })
    }
    const driveExpiresAtIso = driveExpiresAt?.toISOString() ?? ''
    const settings = await ensureSettings(auth.db)
    const emailSettings = await ensureEmailSettings(auth.db)
    const emailCanBeSent = emailSettings.enabled && Boolean(customerEmail) && (Boolean(driveLink) || sessionOutcome === 'abandoned')
    if (auth.device.storeId !== settings.storeId) return json(res, 403, { error: 'Booth ini sudah tidak terhubung ke toko aktif.' })
    const document = {
      _id: `${auth.device._id}:${sessionId}`,
      sessionId,
      storeId: settings.storeId,
      deviceId: auth.device._id,
      createdAt,
      customerEmail,
      operationMode,
      paymentStatus,
      paymentOrderId,
      experience,
      sessionOutcome,
      shotCount: Number(shotCount),
      amount: paymentStatus === 'paid' ? Number(amount) : 0,
      driveUploaded,
      driveLink,
      driveExpiresAt: driveExpiresAtIso,
    }
    const result = await auth.db.collection<{ _id: string }>('sessions').updateOne(
      { _id: document._id },
      {
        $set: {
          customerEmail,
          operationMode,
          paymentStatus,
          paymentOrderId,
          experience,
          sessionOutcome,
          shotCount: Number(shotCount),
          amount: paymentStatus === 'paid' ? Number(amount) : 0,
          driveUploaded,
          driveLink,
          driveExpiresAt: driveExpiresAtIso,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          sessionId,
          storeId: settings.storeId,
          deviceId: auth.device._id,
          deviceName: auth.device.name,
          createdAt,
          receivedAt: new Date(),
          emailStatus: emailCanBeSent ? 'waiting_upload' : 'disabled',
        },
      },
      { upsert: true },
    )
    if (paymentStatus === 'paid') {
      await stringIdCollection(auth.db, 'payments').updateOne(
        { _id: `${auth.device._id}:${paymentOrderId}` },
        {
          $set: { customerEmail, driveUploaded, driveLink, driveExpiresAt: driveExpiresAtIso, sessionId, sessionCreatedAt: createdAt, updatedAt: new Date() },
          $setOnInsert: {
            paymentOrderId,
            storeId: settings.storeId,
            deviceId: auth.device._id,
            deviceName: auth.device.name,
            paymentStatus: 'paid',
            paidAt,
            amount: Number(amount),
            experience,
            operationMode,
            paymentEnvironment: 'unknown',
            receivedAt: new Date(),
          },
        },
        { upsert: true },
      )
    }
    if (result.upsertedCount === 1) {
      await queueTelegramLogSafely(auth.db, settings.storeId, 'Sesi foto baru', [
        `Booth: ${auth.device.name}`,
        `Sesi: ${sessionId}`,
        `Format: ${experience === 'strip' ? 'Photo strip' : 'Foto tunggal'}`,
        `Status: ${paymentStatus}`,
        ...(paymentStatus === 'paid' ? [`Pembayaran: Rp${Number(amount).toLocaleString('id-ID')}`] : []),
      ], `session:${document._id}`)
    }
    let emailStatus: string = emailCanBeSent ? 'waiting_upload' : 'disabled'
    if (sessionOutcome === 'abandoned' && emailCanBeSent) {
      const sessions = stringIdCollection(auth.db, 'sessions')
      const current = await sessions.findOne({ _id: document._id }, { projection: { emailStatus: 1 } })
      const currentEmailStatus = typeof current?.emailStatus === 'string' ? current.emailStatus : 'waiting_upload'
      if (currentEmailStatus === 'disabled') {
        await sessions.updateOne({ _id: document._id, emailStatus: 'disabled' }, { $set: { emailStatus: 'waiting_upload' } })
      }
      const claim = await sessions.updateOne(
        { _id: document._id, sessionOutcome: 'abandoned', emailStatus: 'waiting_upload' },
        { $set: { emailStatus: 'sending', emailError: '', emailAttemptedAt: new Date() }, $inc: { emailAttempts: 1 } },
      )
      if (claim.modifiedCount === 1) {
        try {
          await sendCustomerAbandonedSessionEmail(auth.db, { sessionId, customerEmail })
          emailStatus = 'accepted'
          await sessions.updateOne({ _id: document._id, emailStatus: 'sending' }, { $set: { emailStatus, emailError: '', emailAcceptedAt: new Date() } })
        } catch (error) {
          emailStatus = 'failed'
          const emailError = error instanceof Error ? error.message.slice(0, 500) : 'Pengiriman email gagal.'
          console.error('[customer-email-timeout]', emailError)
          await sessions.updateOne({ _id: document._id, emailStatus: 'sending' }, { $set: { emailStatus, emailError } })
        }
      } else {
        const latest = await sessions.findOne({ _id: document._id }, { projection: { emailStatus: 1 } })
        emailStatus = typeof latest?.emailStatus === 'string' ? latest.emailStatus : 'waiting_upload'
      }
    } else if (driveUploaded && customerEmail) {
      const sessions = stringIdCollection(auth.db, 'sessions')
      const currentEmail = await sessions.findOne({ _id: document._id }, { projection: { emailStatus: 1 } })
      const currentEmailStatus = typeof currentEmail?.emailStatus === 'string' ? currentEmail.emailStatus : 'disabled'
      if (!emailSettings.enabled) {
        if (!['accepted', 'sending'].includes(currentEmailStatus)) {
          emailStatus = 'disabled'
          await sessions.updateOne({ _id: document._id, emailStatus: { $nin: ['accepted', 'sending'] } }, { $set: { emailStatus } })
        } else {
          emailStatus = currentEmailStatus
        }
      } else if (!driveLink) {
        emailStatus = currentEmailStatus === 'accepted' ? 'accepted' : 'failed'
        if (currentEmailStatus !== 'accepted') await sessions.updateOne({ _id: document._id, emailStatus: { $ne: 'accepted' } }, { $set: { emailStatus, emailError: 'Link Google Drive tidak tersedia.' } })
      } else {
        if (currentEmailStatus === 'disabled') {
          await sessions.updateOne({ _id: document._id, emailStatus: 'disabled' }, { $set: { emailStatus: 'waiting_upload' } })
        }
        const claim = await sessions.updateOne(
          { _id: document._id, driveUploaded: true, emailStatus: 'waiting_upload' },
          { $set: { emailStatus: 'sending', emailError: '', emailAttemptedAt: new Date() }, $inc: { emailAttempts: 1 } },
        )
        if (claim.modifiedCount === 1) {
          try {
            await sendCustomerDriveEmail(auth.db, { sessionId, customerEmail, driveLink, driveExpiresAt: driveExpiresAtIso })
            emailStatus = 'accepted'
            await sessions.updateOne({ _id: document._id, emailStatus: 'sending' }, { $set: { emailStatus, emailError: '', emailAcceptedAt: new Date() } })
          } catch (error) {
            emailStatus = 'failed'
            const emailError = error instanceof Error ? error.message.slice(0, 500) : 'Pengiriman email gagal.'
            console.error('[customer-email]', emailError)
            await sessions.updateOne({ _id: document._id, emailStatus: 'sending' }, { $set: { emailStatus, emailError } })
          }
        } else {
          const latest = await sessions.findOne({ _id: document._id }, { projection: { emailStatus: 1 } })
          emailStatus = typeof latest?.emailStatus === 'string' ? latest.emailStatus : 'waiting_upload'
        }
      }
    }
    return json(res, 202, { accepted: true, duplicate: result.upsertedCount === 0, emailStatus })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Sesi gagal disinkronkan.' })
  }
}
