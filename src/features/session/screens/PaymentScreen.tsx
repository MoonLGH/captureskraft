import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CreditCard, ShieldCheck } from 'lucide-react'
import type { Experience, OperationMode, PaymentEnvironment } from '../../../types/app'
import { money } from '../../../utils/format'

type PaymentScreenProps = {
  experience: Experience
  photoStripPrice: string
  singlePhotoPrice: string
  mode: OperationMode
  environment: PaymentEnvironment
  clientKey: string
  serverKeyConfigured: boolean
  onBack: () => void
  onPaymentComplete: (orderId: string) => void
  onSkipPayment: () => void
}

const AUTO_VERIFY_LIMIT_MS = 15 * 60 * 1000

export function PaymentScreen({ experience, photoStripPrice, singlePhotoPrice, mode, environment, clientKey, serverKeyConfigured, onBack, onPaymentComplete, onSkipPayment }: PaymentScreenProps) {
  const [snapReady, setSnapReady] = useState(false)
  const [working, setWorking] = useState(false)
  const [pendingOrderId, setPendingOrderId] = useState('')
  const [message, setMessage] = useState('')
  const activeOrderId = useRef('')
  const pollStartedAt = useRef(0)
  const pollTimer = useRef<number | undefined>(undefined)
  const total = experience === 'single'
    ? Number(singlePhotoPrice) || 24500
    : Number(photoStripPrice) || 35000
  const configured = Boolean(clientKey.trim() && serverKeyConfigured)

  useEffect(() => () => {
    activeOrderId.current = ''
    if (pollTimer.current !== undefined) window.clearTimeout(pollTimer.current)
  }, [])

  useEffect(() => {
    setSnapReady(false)
    setMessage('')
    if (!clientKey.trim()) return
    if (window.snap) {
      setSnapReady(true)
      return
    }

    const script = document.createElement('script')
    script.src = environment === 'sandbox'
      ? `https://app.sandbox.midtrans.com/snap/snap.js?clientKey=${encodeURIComponent(clientKey)}`
      : `https://app.midtrans.com/snap/snap.js?clientKey=${encodeURIComponent(clientKey)}`
    script.async = true
    script.onload = () => setSnapReady(Boolean(window.snap))
    script.onerror = () => setMessage('Snap Midtrans gagal dimuat. Periksa koneksi internet dan Client Key.')
    document.head.appendChild(script)

    return () => {
      script.onload = null
      script.onerror = null
    }
  }, [clientKey, environment])

  const pollPaymentStatus = async (orderId: string) => {
    if (activeOrderId.current !== orderId) return
    const elapsed = Date.now() - pollStartedAt.current
    if (elapsed >= AUTO_VERIFY_LIMIT_MS) {
      setWorking(false)
      setMessage('Status belum terkonfirmasi setelah 15 menit. Minta petugas memeriksa transaksi sebelum mencoba pembayaran lagi.')
      return
    }

    const checkStartedAt = Date.now()
    try {
      const verification = await window.boothConfig?.verifyMidtransPayment(orderId)
      if (activeOrderId.current !== orderId) return
      if (verification?.paid) {
        activeOrderId.current = ''
        setPendingOrderId('')
        setWorking(false)
        setMessage('Pembayaran terverifikasi.')
        window.snap?.hide?.()
        onPaymentComplete(orderId)
        return
      }
      if (verification?.terminal) {
        activeOrderId.current = ''
        setPendingOrderId('')
        setWorking(false)
        setMessage(verification.status === 'expire'
          ? 'Waktu pembayaran berakhir. Silakan mulai pembayaran lagi.'
          : 'Pembayaran tidak berhasil. Silakan mulai pembayaran lagi.')
        return
      }
      setMessage('Menunggu pembayaran. Status diperiksa otomatis…')
    } catch {
      if (activeOrderId.current !== orderId) return
      setMessage('Status pembayaran sedang diperiksa otomatis. Pastikan booth tetap terhubung ke internet.')
    }

    if (activeOrderId.current !== orderId) return
    const elapsedAfterCheck = Date.now() - pollStartedAt.current
    if (elapsedAfterCheck >= AUTO_VERIFY_LIMIT_MS) {
      setWorking(false)
      setMessage('Status belum terkonfirmasi setelah 15 menit. Minta petugas memeriksa transaksi sebelum mencoba pembayaran lagi.')
      return
    }
    const nextDelay = Math.max(0, 4000 - (Date.now() - checkStartedAt))
    pollTimer.current = window.setTimeout(() => { void pollPaymentStatus(orderId) }, nextDelay)
  }

  const startPayment = async () => {
    if (activeOrderId.current) return
    setWorking(true)
    setMessage('Menyiapkan pembayaran Midtrans…')
    try {
      if (!window.boothConfig?.createMidtransPayment) throw new Error('Payment gateway hanya tersedia di aplikasi desktop.')
      if (!window.snap) throw new Error('Snap Midtrans belum siap dimuat.')
      const payment = await window.boothConfig.createMidtransPayment({ amount: total, experience })
      activeOrderId.current = payment.orderId
      pollStartedAt.current = Date.now()
      setPendingOrderId(payment.orderId)
      setMessage('Pembayaran dibuka. Status akan diperiksa otomatis…')
      void pollPaymentStatus(payment.orderId)
      window.snap.pay(payment.token, {
        onSuccess: () => {
          if (activeOrderId.current === payment.orderId) setMessage('Pembayaran diterima. Memastikan status secara otomatis…')
        },
        onPending: () => {
          if (activeOrderId.current === payment.orderId) setMessage('Pembayaran masih menunggu. Status diperiksa otomatis…')
        },
        onError: () => {
          if (activeOrderId.current === payment.orderId) setMessage('Pembayaran belum selesai. Status tetap diperiksa otomatis…')
        },
        onClose: () => {
          if (activeOrderId.current === payment.orderId) setMessage('Snap ditutup. Status pembayaran tetap diperiksa otomatis…')
        },
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Pembayaran Midtrans gagal dimulai.')
      if (!activeOrderId.current) setWorking(false)
    }
  }

  return (
    <section className="flow-page checkout-page">
      <div className="flow-heading">
        <h2>Selesaikan pembayaran.</h2>
        <p>{mode === 'booth' ? 'Pembayaran wajib diselesaikan melalui Midtrans sebelum sesi foto.' : 'Uji alur pembayaran melalui Midtrans, atau lewati pembayaran untuk pengembangan.'}</p>
      </div>

      <div className="checkout-card admin-card">
        <div className="checkout-total"><span>Total sesi</span><b>{money(total)}</b><small>{experience === 'single' ? 'Foto tunggal' : 'Photo strip'}</small></div>
        <div className="checkout-gateway"><span className="config-icon mongo-icon"><CreditCard size={20} /></span><span><b>Midtrans Snap</b><small>{environment === 'sandbox' ? 'Sandbox · transaksi percobaan' : 'Production · transaksi langsung'}</small></span><ShieldCheck size={18} /></div>
        {!configured && <div className="checkout-setup-note">Atur Client Key dan Server Key Midtrans di Admin Settings → Koneksi data untuk mengaktifkan pembayaran.</div>}
        {message && <p className="checkout-message" role="status">{message}</p>}
        <div className="checkout-actions">
          <button className="soft-button" type="button" onClick={onBack}><ArrowLeft size={18} /> Kembali</button>
          <button className="primary-cta compact checkout-pay-button" type="button" onClick={() => { void startPayment() }} disabled={!configured || !snapReady || working || Boolean(pendingOrderId)}>
            <span>{working ? pendingOrderId ? 'Menunggu konfirmasi otomatis…' : 'Menyiapkan pembayaran…' : pendingOrderId ? 'Perlu bantuan petugas' : !configured ? 'Atur Midtrans di Admin Settings' : !snapReady ? 'Menyiapkan Midtrans…' : `Bayar ${money(total)}`}</span><span className="cta-icon"><ArrowRight size={20} /></span>
          </button>
        </div>
        {mode === 'dev' && <button className="checkout-skip-button" type="button" onClick={onSkipPayment} disabled={working || Boolean(pendingOrderId)}>Lewati pembayaran (DEV mode)</button>}
      </div>

      <div className="flow-progress"><span className="active" /><span className="active" /><span /><span /><span /><span /></div>
    </section>
  )
}
