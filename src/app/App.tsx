import { useEffect, useMemo, useRef, useState } from 'react'
import type { AdminTab, Config, Experience, PaymentStatus, Screen } from '../types/app'
import { initialConfig } from './initialConfig'
import { AppHeader } from '../components/shared/AppHeader'
import { PasswordModal } from '../components/shared/PasswordModal'
import { ToastMessage } from '../components/shared/ToastMessage'
import { AdminPanel } from '../features/admin/AdminPanel'
import { CameraScreen } from '../features/session/screens/CameraScreen'
import { ExperienceScreen } from '../features/session/screens/ExperienceScreen'
import { HomeScreen } from '../features/session/screens/HomeScreen'
import { ResultScreen } from '../features/session/screens/ResultScreen'
import { SavedScreen } from '../features/session/screens/SavedScreen'
import { FrameSelectionScreen } from '../features/session/screens/FrameSelectionScreen'
import { PaymentScreen } from '../features/session/screens/PaymentScreen'
import { CustomerDetailsScreen } from '../features/session/screens/CustomerDetailsScreen'
import type { SessionExportFile } from '../features/session/sessionExport'
import { cameraTrackConstraints, parseCameraSettings, parseLegacyBoothFrame, serializeCameraSettings } from '../features/camera/cameraSettings'
import { getFramePhotoIndexes, parseBoothFrames, serializeBoothFrames } from '../features/camera/boothFrames'
import type { BoothFrame } from '../features/camera/boothFrames'

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [adminTab, setAdminTab] = useState<AdminTab>('overview')
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [config, setConfig] = useState<Config>(initialConfig)
  const [experience, setExperience] = useState<Experience>('strip')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null)
  const [paymentOrderId, setPaymentOrderId] = useState('')
  const [deliveryStatus, setDeliveryStatus] = useState('')
  const [selectedFrameId, setSelectedFrameId] = useState<string | null | undefined>(undefined)
  const [shots, setShots] = useState<string[]>([])
  const [sessionCount, setSessionCount] = useState(0)
  const [toast, setToast] = useState('')
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [cameraError, setCameraError] = useState('')
  const [countdown, setCountdown] = useState<number | null>(null)
  const [advanceCountdown, setAdvanceCountdown] = useState<number | null>(null)
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null)
  const [reviewIndex, setReviewIndex] = useState<number | null>(null)
  const [capturing, setCapturing] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const captureTimer = useRef<number | undefined>(undefined)
  const advanceTimer = useRef<number | undefined>(undefined)
  const cameraSettings = useMemo(() => parseCameraSettings(config.cameraSettings), [config.cameraSettings])
  const boothFrames = useMemo(() => parseBoothFrames(config.boothFrames), [config.boothFrames])
  const compatibleFrames = boothFrames.frames.filter((frame) => frame.appliesTo === 'both' || frame.appliesTo === experience)
  const sessionFrame = typeof selectedFrameId === 'string'
    ? compatibleFrames.find((frame) => frame.id === selectedFrameId) ?? null
    : null
  const shotLimit = experience === 'strip'
    ? sessionFrame ? getFramePhotoIndexes(sessionFrame).length || 3 : 3
    : 1

  useEffect(() => {
    void window.boothConfig?.load().then((stored) => {
      const parsedFrames = parseBoothFrames(stored.boothFrames)
      const legacyFrame = parseLegacyBoothFrame(stored.cameraSettings)
      const boothFrames = parsedFrames.frames.length || !legacyFrame
        ? parsedFrames
        : { frames: [legacyFrame], activeFrameId: legacyFrame.id }
      const camera = parseCameraSettings(stored.cameraSettings)
      setConfig((current) => ({
        ...current,
        ...stored,
        cameraSettings: serializeCameraSettings(camera),
        boothFrames: serializeBoothFrames(boothFrames),
      }))
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (screen === 'home' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        setPasswordOpen(true)
        setPassword('')
        setPasswordError('')
      }
      if (screen === 'admin' && event.key === 'Escape') setScreen('home')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [screen])

  useEffect(() => {
    if (screen !== 'camera') return
    let active = true
    setCameraError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Kamera tidak tersedia di mode preview ini.')
      return
    }
    const videoConstraints: MediaTrackConstraints = cameraSettings.cameraDeviceId
      ? { deviceId: { exact: cameraSettings.cameraDeviceId } }
      : { facingMode: 'user' }
    const openCamera = async (constraints: MediaTrackConstraints) => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false })
      const track = stream.getVideoTracks()[0]
      if (track && Object.keys(cameraSettings.controls).length) {
        try {
          await track.applyConstraints(cameraTrackConstraints(cameraSettings))
        } catch {
          if (active) setCameraError('Kamera tersambung, tetapi sebagian kontrol manual tidak dapat diterapkan oleh perangkat ini.')
        }
      }
      if (!active) stream.getTracks().forEach((item) => item.stop())
      else setCameraStream(stream)
    }
    const startCamera = async () => {
      try {
        await openCamera(videoConstraints)
      } catch {
        if (cameraSettings.cameraDeviceId) {
          try {
            await openCamera({ facingMode: 'user' })
            return
          } catch { /* Show the demo camera state below. */ }
        }
        if (active) setCameraError('Kamera belum tersambung. Kamu tetap bisa mencoba alur demo.')
      }
    }
    void startCamera()
    return () => {
      active = false
      setCameraStream((current) => {
        current?.getTracks().forEach((track) => track.stop())
        return null
      })
    }
  }, [screen, cameraSettings.cameraDeviceId, cameraSettings.controls])

  useEffect(() => {
    if (videoRef.current && cameraStream) videoRef.current.srcObject = cameraStream
  }, [cameraStream])

  useEffect(() => () => {
    window.clearInterval(captureTimer.current)
    window.clearInterval(advanceTimer.current)
  }, [])

  useEffect(() => {
    if (screen === 'camera') return
    window.clearInterval(captureTimer.current)
    window.clearInterval(advanceTimer.current)
    captureTimer.current = undefined
    advanceTimer.current = undefined
    setCountdown(null)
    setAdvanceCountdown(null)
    setRetakeIndex(null)
    setReviewIndex(null)
    setCapturing(false)
  }, [screen])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const makeDemoShot = (number: number) => {
    const colors = ['#ffb8d0', '#4298ed', '#f7d5a8']
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#ffe7f0"/><circle cx="320" cy="200" r="160" fill="${colors[(number - 1) % colors.length]}"/><circle cx="266" cy="188" r="42" fill="#bb805f"/><circle cx="365" cy="178" r="45" fill="#f0c19d"/><path d="M185 398c5-106 37-150 93-150s87 44 94 150" fill="#fff"/><path d="M286 398c8-118 44-170 99-170 58 0 83 53 88 170" fill="#4298ed"/><text x="320" y="445" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" letter-spacing="4" fill="#725665">CAPTURS · DEMO ${String(number).padStart(2, '0')}</text></svg>`
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  }

  const clearCaptureTimers = () => {
    window.clearInterval(captureTimer.current)
    window.clearInterval(advanceTimer.current)
    captureTimer.current = undefined
    advanceTimer.current = undefined
  }

  const resetShots = () => {
    clearCaptureTimers()
    setShots([])
    setCountdown(null)
    setAdvanceCountdown(null)
    setRetakeIndex(null)
    setReviewIndex(null)
    setCapturing(false)
  }

  const startAdvanceDelay = (shotIndex: number) => {
    let remaining = 5
    setReviewIndex(shotIndex)
    setAdvanceCountdown(remaining)
    const timer = window.setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        window.clearInterval(timer)
        advanceTimer.current = undefined
        setAdvanceCountdown(null)
        setReviewIndex(null)
        return
      }
      setAdvanceCountdown(remaining)
    }, 1000)
    advanceTimer.current = timer
  }

  const addShot = (targetIndex?: number) => {
    if (capturing || (advanceCountdown !== null && targetIndex === undefined)) return
    if (targetIndex !== undefined) {
      window.clearInterval(advanceTimer.current)
      advanceTimer.current = undefined
      setAdvanceCountdown(null)
      setReviewIndex(null)
    }
    setCapturing(true)
    setRetakeIndex(targetIndex ?? null)
    setCountdown(5)
    let remaining = 5
    const timer = window.setInterval(() => {
      remaining -= 1
      if (remaining > 0) {
        setCountdown(remaining)
        return
      }
      window.clearInterval(timer)
      captureTimer.current = undefined
      setCountdown(null)
      const video = videoRef.current
      let image = makeDemoShot((targetIndex ?? shots.length) + 1)
      if (cameraStream && video && video.videoWidth > 0) {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const context = canvas.getContext('2d')
        if (context) {
          context.translate(canvas.width, 0)
          context.scale(-1, 1)
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          image = canvas.toDataURL('image/jpeg', 0.92)
        }
      }
      setShots((current) => {
        if (targetIndex === undefined) return [...current, image]
        if (targetIndex < 0 || targetIndex >= current.length) return current
        const updated = [...current]
        updated[targetIndex] = image
        return updated
      })
      setRetakeIndex(null)
      setCapturing(false)
      startAdvanceDelay(targetIndex ?? shots.length)
    }, 1000)
    captureTimer.current = timer
  }

  const beginSession = () => {
    resetShots()
    setSelectedFrameId(undefined)
    setCustomerName('')
    setCustomerEmail('')
    setPaymentStatus(null)
    setPaymentOrderId('')
    setDeliveryStatus('')
    setScreen('experience')
  }

  const selectExperience = (nextExperience: Experience) => {
    setExperience(nextExperience)
    setSelectedFrameId(undefined)
  }

  const continueToPayment = () => {
    setSelectedFrameId(undefined)
    if (config.operationMode === 'event') {
      setPaymentStatus('event')
      setScreen('customer')
    } else setScreen('payment')
  }

  const paymentComplete = (orderId: string) => {
    setPaymentOrderId(orderId)
    setPaymentStatus('paid')
    setScreen('customer')
  }

  const skipPayment = () => {
    if (config.operationMode !== 'dev') return
    setPaymentOrderId('')
    setPaymentStatus('skipped')
    setScreen('customer')
  }

  const continueToCamera = () => {
    if (selectedFrameId === undefined) return
    if (typeof selectedFrameId === 'string' && !compatibleFrames.some((frame) => frame.id === selectedFrameId)) return
    setScreen('camera')
  }

  const selectSessionFrame = (frameId: string | null) => {
    if (frameId !== selectedFrameId) resetShots()
    setSelectedFrameId(frameId)
  }

  const unlockAdmin = () => {
    if (password === 'admin') {
      setPasswordOpen(false)
      setPassword('')
      setAdminTab('overview')
      setScreen('admin')
    } else setPasswordError('Password belum tepat. Coba lagi.')
  }

  const saveSettings = async () => {
    try {
      if (window.boothConfig) await window.boothConfig.save(config)
      if (window.boothConfig && config.midtransServerKey.trim()) {
        setConfig((current) => ({
          ...current,
          midtransServerKey: '',
          midtransServerKeyConfigured: true,
        }))
      }
      setToast(window.boothConfig
        ? 'Konfigurasi tersimpan pada perangkat.'
        : 'Mode preview: konfigurasi hanya tersimpan selama aplikasi terbuka.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Konfigurasi gagal disimpan.')
    }
  }

  const saveFrameCropPreset = async (updatedFrame: BoothFrame) => {
    const nextBoothFrames = {
      ...boothFrames,
      frames: boothFrames.frames.map((frame) => frame.id === updatedFrame.id ? updatedFrame : frame),
    }
    const nextConfig = { ...config, boothFrames: serializeBoothFrames(nextBoothFrames) }
    setConfig(nextConfig)
    try {
      if (window.boothConfig) await window.boothConfig.save(nextConfig)
      setToast(window.boothConfig ? 'Default crop disimpan ke preset frame di perangkat.' : 'Default crop diperbarui untuk preview ini.')
      return true
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Preset frame gagal disimpan.')
      return false
    }
  }

  const finishSession = async (files: SessionExportFile[]) => {
    if (!window.boothConfig?.saveSession) throw new Error('Penyimpanan sesi hanya tersedia di aplikasi desktop.')
    if (!paymentStatus) throw new Error('Status pembayaran sesi belum tersedia.')
    const receipt = await window.boothConfig.saveSession(files, {
      customerName,
      customerEmail,
      operationMode: config.operationMode,
      paymentStatus,
      paymentOrderId,
      experience,
    })
    const delivery = [
      'Foto tersimpan lokal.',
      config.rcloneEnabled === 'true' ? (receipt.backupSent ? 'Backup Google Drive berhasil.' : `Backup Google Drive gagal${receipt.backupError ? `: ${receipt.backupError}` : '.'}`) : '',
    ].filter(Boolean).join(' ')
    setDeliveryStatus(delivery)
    setSessionCount((count) => count + 1)
    setScreen('saved')
  }

  const handleBack = () => setScreen(screen === 'saved' ? 'home' : screen === 'result' ? 'camera' : screen === 'camera' ? 'frameSelect' : screen === 'frameSelect' ? 'customer' : screen === 'customer' ? config.operationMode === 'event' ? 'experience' : 'payment' : screen === 'payment' ? 'experience' : screen === 'experience' ? 'home' : 'home')
  const retryResult = () => {
    resetShots()
    setScreen('camera')
  }

  return (
    <div className={`app-shell ${screen === 'home' ? 'app-home' : ''} ${screen === 'camera' ? 'app-camera' : ''}`}>
      {screen !== 'admin' && <AppHeader screen={screen} boothName={config.storeName} onHome={() => setScreen('home')} onBack={handleBack} />}

      <main className={`main-content ${screen === 'camera' ? 'camera-main-content' : ''}`}>
        {screen === 'home' && <HomeScreen boothName={config.storeName} onBeginSession={beginSession} />}
        {screen === 'experience' && <ExperienceScreen experience={experience} price={config.price} paymentCoveredByEvent={config.operationMode === 'event'} onSelectExperience={selectExperience} onBack={() => setScreen('home')} onContinue={continueToPayment} />}
        {screen === 'payment' && <PaymentScreen experience={experience} price={config.price} mode={config.operationMode} environment={config.paymentEnvironment} clientKey={config.midtransClientKey} serverKeyConfigured={config.midtransServerKeyConfigured} onBack={() => setScreen('experience')} onPaymentComplete={paymentComplete} onSkipPayment={skipPayment} />}
        {screen === 'customer' && <CustomerDetailsScreen name={customerName} email={customerEmail} onNameChange={setCustomerName} onEmailChange={setCustomerEmail} onBack={handleBack} onContinue={() => setScreen('frameSelect')} />}
        {screen === 'frameSelect' && <FrameSelectionScreen experience={experience} frames={compatibleFrames} selectedFrameId={selectedFrameId} onSelectFrame={selectSessionFrame} onBack={() => setScreen('customer')} onContinue={continueToCamera} />}
        {screen === 'camera' && <CameraScreen experience={experience} frame={sessionFrame} shots={shots} shotLimit={shotLimit} cameraStream={cameraStream} cameraError={cameraError} countdown={countdown} advanceCountdown={advanceCountdown} retakeIndex={retakeIndex} reviewIndex={reviewIndex} capturing={capturing} videoRef={videoRef} onCapture={addShot} onRetakeShot={(index) => addShot(index)} onRetake={resetShots} onContinue={() => setScreen('result')} />}
        {screen === 'result' && <ResultScreen experience={experience} shots={shots} frame={sessionFrame} onRetake={retryResult} onFinish={finishSession} onSaveFramePreset={saveFrameCropPreset} />}
        {screen === 'saved' && <SavedScreen sessionCount={sessionCount} deliveryStatus={deliveryStatus} onHome={() => setScreen('home')} />}
        {screen === 'admin' && <AdminPanel activeTab={adminTab} setActiveTab={setAdminTab} config={config} setConfig={setConfig} onSave={saveSettings} sessionCount={sessionCount} onExit={() => setScreen('home')} />}
      </main>

      {passwordOpen && <PasswordModal password={password} error={passwordError} onPasswordChange={(value) => { setPassword(value); setPasswordError('') }} onClose={() => setPasswordOpen(false)} onSubmit={unlockAdmin} />}
      {toast && <ToastMessage message={toast} />}
    </div>
  )
}

export default App
