import nodemailer from 'nodemailer'
import type { Db } from 'mongodb'
import { emailCredentials, ensureEmailSettings } from './server'

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
}

async function createEmailTransporter(db: Db) {
  const settings = await ensureEmailSettings(db)
  const credentials = await emailCredentials(settings)
  const options = {
    auth: settings.mode === 'gmail'
      ? { user: settings.fromAddress, pass: credentials.password }
      : { user: credentials.username, pass: credentials.password },
    connectionTimeout: 10_000,
    greetingTimeout: 7_000,
    socketTimeout: 12_000,
  }
  const transporter = settings.mode === 'gmail'
    ? nodemailer.createTransport({
      ...options,
      service: /@(gmail\.com|googlemail\.com)$/i.test(settings.fromAddress) ? 'gmail' : 'GmailWorkspace',
    })
    : nodemailer.createTransport({
      ...options,
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpSecure || settings.smtpPort === 465,
      requireTLS: !(settings.smtpSecure || settings.smtpPort === 465),
    })
  return { settings, transporter }
}

export async function verifyEmailSettings(db: Db) {
  const { settings, transporter } = await createEmailTransporter(db)
  try {
    await transporter.verify()
    return { message: `Koneksi ${settings.mode === 'gmail' ? 'Gmail' : 'SMTP'} berhasil dan autentikasi diterima.` }
  } finally {
    transporter.close()
  }
}

export async function sendCustomerDriveEmail(db: Db, input: {
  sessionId: string
  customerEmail: string
  driveLink: string
  driveExpiresAt: string
}) {
  const { settings, transporter } = await createEmailTransporter(db)
  const expiryDate = Number.isFinite(Date.parse(input.driveExpiresAt))
    ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(input.driveExpiresAt))
    : ''
  const expiryCopy = expiryDate ? `Folder dijadwalkan dihapus pada ${expiryDate}.` : 'Sebaiknya unduh foto sesegera mungkin.'
  const escapedLink = escapeHtml(input.driveLink)
  const text = `Hasil foto kamu sudah siap. Buka folder Google Drive ini untuk mengunduh foto dan Live Photos: ${input.driveLink}\n\n${expiryCopy}\n\nTerima kasih sudah berfoto bersama ${settings.fromName}.`
  try {
    const result = await transporter.sendMail({
      from: { name: settings.fromName, address: settings.fromAddress },
      to: input.customerEmail,
      subject: 'Hasil foto Capturs kamu sudah siap',
      text,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#51414a;line-height:1.6"><h2>Hasil fotomu sudah siap ✨</h2><p>Buka folder Google Drive ini untuk mengunduh foto, Boomerang, dan Live Photos:</p><p><a href="${escapedLink}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#c85f86;color:#fff;text-decoration:none">Buka foto saya</a></p><p>${escapeHtml(expiryCopy)}</p><p>Terima kasih sudah berfoto bersama ${escapeHtml(settings.fromName)}.</p></div>`,
      headers: { 'X-Capturs-Session-ID': input.sessionId },
    })
    if (!Array.isArray(result.accepted) || !result.accepted.length) throw new Error('Server email tidak menerima alamat pelanggan.')
    return { accepted: true, messageId: result.messageId }
  } finally {
    transporter.close()
  }
}

export async function sendCustomerAbandonedSessionEmail(db: Db, input: {
  sessionId: string
  customerEmail: string
}) {
  const { settings, transporter } = await createEmailTransporter(db)
  const message = 'Kamu tidak melakukan apa pun pada sesi foto berbayar tadi. Jika merasa memerlukan bantuan, silakan hubungi operator booth untuk mendapatkan dukungan.'
  try {
    const result = await transporter.sendMail({
      from: { name: settings.fromName, address: settings.fromAddress },
      to: input.customerEmail,
      subject: 'Sesi foto Capturs belum selesai',
      text: `${message}\n\nTerima kasih sudah berfoto bersama ${settings.fromName}.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#51414a;line-height:1.6"><h2>Sesi fotomu belum selesai</h2><p>${escapeHtml(message)}</p><p>Terima kasih sudah berfoto bersama ${escapeHtml(settings.fromName)}.</p></div>`,
      headers: { 'X-Capturs-Session-ID': input.sessionId },
    })
    if (!Array.isArray(result.accepted) || !result.accepted.length) throw new Error('Server email tidak menerima alamat pelanggan.')
    return { accepted: true, messageId: result.messageId }
  } finally {
    transporter.close()
  }
}
