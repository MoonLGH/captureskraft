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
import { CameraSettingsScreen } from '../features/session/screens/CameraSettingsScreen'
import { PaymentScreen } from '../features/session/screens/PaymentScreen'
import { CustomerDetailsScreen } from '../features/session/screens/CustomerDetailsScreen'
import { createSessionExportFiles, type SessionExportFile } from '../features/session/sessionExport'
import { DEFAULT_SESSION_CAMERA_SETTINGS, type SessionCameraSettings } from '../features/camera/cameraEffects'
import { cameraTrackConstraints, parseCameraSettings, parseLegacyBoothFrame, serializeCameraSettings } from '../features/camera/cameraSettings'
import { getFramePhotoIndexes, isFullBoothFrameDataUrl, parseBoothFrames, serializeBoothFrameManifest } from '../features/camera/boothFrames'
import type { BoothFrame, BoothFrameAssetUpload } from '../features/camera/boothFrames'
import { playButtonClickSound, playTimerFotoSound, stopTimerFotoSound } from '../utils/sounds'

function normalizeStoredConfig(stored: Partial<Config>): Partial<Config> {
  const parsedFrames = parseBoothFrames(stored.boothFrames)
  const legacyFrame = parseLegacyBoothFrame(stored.cameraSettings)
  const boothFrames = parsedFrames.frames.length || !legacyFrame
    ? parsedFrames
    : { frames: [legacyFrame], activeFrameId: legacyFrame.id }
  return {
    ...stored,
    cameraSettings: serializeCameraSettings(parseCameraSettings(stored.cameraSettings)),
    boothFrames: serializeBoothFrameManifest(boothFrames),
  }
}

function updateCloudApplyPermissions(configAllowed: boolean, frameAllowed: boolean) {
  const bridge = window.boothConfig
  if (bridge?.setCloudApplyAllowed) return bridge.setCloudApplyAllowed(configAllowed, frameAllowed).then(() => {})
  return Promise.all([
    bridge?.setSyncApplyAllowed?.(configAllowed),
    bridge?.setFrameSyncApplyAllowed?.(frameAllowed),
  ]).then(() => {})
}

function recordCameraClip(stream: MediaStream, onRecorder: (recorder: MediaRecorder) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const mimeType = ['video/mp4;codecs=avc1', 'video/mp4;codecs=vp9', 'video/mp4']
      .find((candidate) => MediaRecorder.isTypeSupported(candidate))
    if (!mimeType) {
      reject(new Error('Format MP4 tidak didukung untuk merekam Live Photo di perangkat ini.'))
      return
    }
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType })
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Perekaman Live Photo tidak tersedia.'))
      return
    }

    const chunks: BlobPart[] = []
    let stopTimer = 0
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onerror = () => reject(new Error('Klip Live Photo gagal direkam.'))
    recorder.onstop = () => {
      window.clearTimeout(stopTimer)
      const clip = new Blob(chunks, { type: recorder.mimeType || 'video/mp4' })
      if (clip.size === 0) {
        reject(new Error('Klip Live Photo kosong.'))
        return
      }
      void clip.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
    }

    try {
      onRecorder(recorder)
      recorder.start()
      stopTimer = window.setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop()
      }, 3000)
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Perekaman Live Photo gagal dimulai.'))
    }
  })
}

function App() {
  const [screen, setScreenState] = useState<Screen>('home')
  const screenRef = useRef<Screen>('home')
  const maintenancePendingRef = useRef(false)
  const setScreen = (nextScreen: Screen) => {
    if (nextScreen === 'home' && maintenancePendingRef.current) nextScreen = 'maintenance'
    screenRef.current = nextScreen
    setScreenState(nextScreen)
    const sessionRunning = sessionStartedAtRef.current > 0 || !['home', 'admin', 'maintenance'].includes(nextScreen)
    void window.boothConfig?.setSessionActive?.(sessionRunning).catch(() => {})
  }
  const [adminTab, setAdminTab] = useState<AdminTab>('overview')
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [config, setConfig] = useState<Config>(initialConfig)
  const [experience, setExperience] = useState<Experience>('strip')
  const [customerEmail, setCustomerEmail] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null)
  const [paymentOrderId, setPaymentOrderId] = useState('')
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null)
  const [sessionRemainingMs, setSessionRemainingMs] = useState<number | null>(null)
  const [deliveryStatus, setDeliveryStatus] = useState('')
  const [printError, setPrintError] = useState('')
  const [driveLink, setDriveLink] = useState('')
  const [driveExpiresAt, setDriveExpiresAt] = useState('')
  const [driveUploadStatus, setDriveUploadStatus] = useState<'disabled' | 'uploading' | 'uploaded' | 'error'>('disabled')
  const [driveUploadError, setDriveUploadError] = useState('')
  const activeDriveSessionIdRef = useRef('')
  const driveUploadUpdatesRef = useRef<Record<string, DriveUploadUpdate>>({})
  const [savedPreviewFiles, setSavedPreviewFiles] = useState<{ image: Uint8Array | null; gif: Uint8Array | null; live: Uint8Array | null } | null>(null)
  const [selectedFrameId, setSelectedFrameId] = useState<string | null | undefined>(undefined)
  const [sessionFrameAsset, setSessionFrameAsset] = useState<BoothFrame | null>(null)
  const [sessionFrameLoading, setSessionFrameLoading] = useState(false)
  const [shots, setShots] = useState<string[]>([])
  const [sessionCount, setSessionCount] = useState(0)
  const [toast, setToast] = useState('')
  const [maintenanceMessage, setMaintenanceMessage] = useState('')
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [cameraError, setCameraError] = useState('')
  const [countdown, setCountdown] = useState<number | null>(null)
  const [shutterFlash, setShutterFlash] = useState(false)
  const [advanceCountdown, setAdvanceCountdown] = useState<number | null>(null)
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null)
  const [reviewIndex, setReviewIndex] = useState<number | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState<number | null>(null)
  const [liveClips, setLiveClips] = useState<(Uint8Array | null)[]>([])
  const [sessionCameraSettings, setSessionCameraSettings] = useState<SessionCameraSettings>(DEFAULT_SESSION_CAMERA_SETTINGS)
  const videoRef = useRef<HTMLVideoElement>(null)
  const configRevisionRef = useRef('')
  const sessionFrameRequestRef = useRef(0)
  const configLoadedRef = useRef(false)
  const captureTimer = useRef<number | undefined>(undefined)
  const shutterFlashStartTimer = useRef<number | undefined>(undefined)
  const shutterFlashTimer = useRef<number | undefined>(undefined)
  const advanceTimer = useRef<number | undefined>(undefined)
  const activeRecorderRef = useRef<MediaRecorder | null>(null)
  const captureGenerationRef = useRef(0)
  const sessionStartedAtRef = useRef(0)
  const sessionDeadlineRef = useRef(0)
  const sessionExpiredRef = useRef(false)
  const sessionFinalizingRef = useRef(false)
  const activeSessionIdRef = useRef('')
  const sessionTimeoutHandlerRef = useRef<() => void>(() => {})
  const cameraSettings = useMemo(() => parseCameraSettings(config.cameraSettings), [config.cameraSettings])
  const boothFrames = useMemo(() => parseBoothFrames(config.boothFrames), [config.boothFrames])
  const compatibleFrames = boothFrames.frames.filter((frame) => frame.appliesTo === 'both' || frame.appliesTo === experience)
  const sessionFrame = typeof selectedFrameId === 'string'
    ? sessionFrameAsset?.id === selectedFrameId ? sessionFrameAsset : compatibleFrames.find((frame) => frame.id === selectedFrameId) ?? null
    : null
  const shotLimit = experience === 'strip'
    ? sessionFrame ? getFramePhotoIndexes(sessionFrame).length || 3 : 3
    : 1

  useEffect(() => {
    if (screen !== 'saved') setSavedPreviewFiles(null)
  }, [screen])

  useEffect(() => {
    const playForProgressButton = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const button = event.target.closest('button')
      if (!button || !button.matches('.primary-cta, .checkout-skip-button')) return
      const label = `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`.trim()
      if (/\bkembali\b/i.test(label)) return
      playButtonClickSound()
    }

    document.addEventListener('click', playForProgressButton, true)
    return () => document.removeEventListener('click', playForProgressButton, true)
  }, [])

  useEffect(() => window.boothConfig?.onTelegramChatId?.((chatId) => {
    setConfig((current) => ({ ...current, telegramChatId: chatId }))
    setToast(`Telegram Chat ID ${chatId} tersimpan otomatis.`)
  }), [])

  useEffect(() => window.boothConfig?.onDriveUploadStatus?.((update) => {
    driveUploadUpdatesRef.current[update.sessionId] = update
    if (activeDriveSessionIdRef.current !== update.sessionId) return
    setDriveUploadStatus(update.status)
    setDriveUploadError(update.error ?? '')
    if (update.driveExpiresAt) setDriveExpiresAt(update.driveExpiresAt)
  }), [])

  const requestMaintenance = () => {
    maintenancePendingRef.current = true
    if (sessionStartedAtRef.current > 0) return
    if (screenRef.current === 'home' || screenRef.current === 'admin') setScreen('maintenance')
  }

  useEffect(() => {
    if (screen === 'maintenance') return
    void updateCloudApplyPermissions(false, false).catch(() => {})
  }, [screen])

  useEffect(() => {
    const bridge = window.boothConfig
    if (!bridge?.checkCloudUpdates) return

    let active = true
    let checking = false
    let intervalMs = 8000
    let timeoutId: number | undefined
    const schedule = (delay: number) => {
      if (active) timeoutId = window.setTimeout(() => { void checkUpdates() }, delay)
    }
    const checkUpdates = async () => {
      if (!active || checking) return
      if (!configLoadedRef.current) {
        schedule(intervalMs)
        return
      }
      if (screenRef.current === 'maintenance') {
        schedule(intervalMs)
        return
      }
      checking = true
      try {
        const result = await bridge.checkCloudUpdates?.()
        if (result?.remoteChanged) requestMaintenance()
        if (result?.failed || result?.synced === false) intervalMs = Math.min(intervalMs * 2, 60_000)
        else intervalMs = 8000
      } catch {
        intervalMs = Math.min(intervalMs * 2, 60_000)
      } finally {
        checking = false
        schedule(intervalMs + Math.floor(Math.random() * 2000))
      }
    }
    const onFocus = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      schedule(150)
    }

    schedule(Math.floor(Math.random() * 2000))
    window.addEventListener('focus', onFocus)
    return () => {
      active = false
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    if (screen !== 'maintenance') return
    let active = true
    let processing = false
    let retryTimer: number | undefined
    const bridge = window.boothConfig
    const applyPendingConfig = async () => {
      if (!active || processing) return
      processing = true
      try {
        if (bridge?.syncForMaintenance) {
          const result = await bridge.syncForMaintenance()
          if (result.waitingForWebAdmin) throw new Error(result.message || 'Menunggu WebAdmin menyelesaikan perubahan.')
          if (result.busy) throw new Error('Sinkronisasi booth masih berlangsung.')
          if (result.failed || result.synced !== true || result.allSynced !== true) {
            throw new Error(result.message || 'Sinkronisasi belum selesai.')
          }
          setMaintenanceMessage('Konfigurasi, gambar frame, dan antrean data sudah tersinkron.')
        }

        let revision = await bridge?.getRevision?.() ?? ''
        let stored = await bridge?.load() ?? {}
        const latestRevision = await bridge?.getRevision?.() ?? ''
        if (revision && latestRevision && revision !== latestRevision) {
          stored = await bridge?.load() ?? {}
          revision = await bridge?.getRevision?.() ?? ''
          if (revision !== latestRevision) throw new Error('Konfigurasi masih berubah. Menunggu versi terbaru.')
        } else revision = latestRevision || revision
        if (!active) return

        if (revision) configRevisionRef.current = revision
        configLoadedRef.current = true
        setConfig((current) => ({ ...current, ...normalizeStoredConfig(stored) }))
        if (!active) return
        if (bridge?.restartAfterMaintenance) {
          setMaintenanceMessage('Sinkronisasi selesai. Memulai ulang aplikasi…')
          const restart = await bridge.restartAfterMaintenance()
          if (restart.restarting) return
          if (restart.restartRequired !== false) throw new Error(restart.message || 'Aplikasi belum aman untuk dimulai ulang.')
        }
        maintenancePendingRef.current = false
        setMaintenanceMessage('')
        screenRef.current = 'home'
        setScreenState('home')
        setToast('Konfigurasi booth tersinkron.')
      } catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : 'Sinkronisasi konfigurasi gagal.'
          setMaintenanceMessage(`${message} Mencoba kembali otomatis.`)
          retryTimer = window.setTimeout(() => { void applyPendingConfig() }, 5000)
        }
      } finally {
        processing = false
      }
    }

    void applyPendingConfig()
    return () => {
      active = false
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    }
  }, [screen])

  useEffect(() => {
    let active = true
    const loadStoredConfig = async () => {
      const bridge = window.boothConfig
      if (!bridge) return
      try {
        const before = await bridge.getRevision?.() ?? ''
        let stored = await bridge.load()
        let revision = await bridge.getRevision?.() ?? ''
        if (before && revision && before !== revision) {
          stored = await bridge.load()
          revision = await bridge.getRevision?.() ?? ''
        }
        if (!active) return
        configRevisionRef.current = revision
        configLoadedRef.current = true
        setConfig((current) => ({ ...current, ...normalizeStoredConfig(stored) }))
      } catch (error) {
        if (active) setToast(error instanceof Error ? error.message : 'Konfigurasi gagal dimuat.')
      }
    }
    void loadStoredConfig()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (screen !== 'home' || !window.boothConfig?.getRevision) return
    let active = true
    let refreshing = false
    const refreshExternalConfig = async () => {
      const bridge = window.boothConfig
      if (!bridge?.getRevision || !configLoadedRef.current || refreshing) return
      refreshing = true
      try {
        const revision = await bridge.getRevision()
        if (!active || !revision || revision === configRevisionRef.current) return
        const latestRevision = await bridge.getRevision()
        if (!active || latestRevision !== revision) return
        configRevisionRef.current = latestRevision
        requestMaintenance()
      } catch (error) {
        if (active) setToast(error instanceof Error ? error.message : 'Konfigurasi gagal dimuat.')
      } finally {
        refreshing = false
      }
    }
    const interval = window.setInterval(() => { void refreshExternalConfig() }, 1500)
    window.addEventListener('focus', refreshExternalConfig)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshExternalConfig)
    }
  }, [screen])

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

  const cameraRequested = screen === 'camera' || screen === 'cameraSettings'

  useEffect(() => {
    if (!cameraRequested) return
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
  }, [cameraRequested, cameraSettings.cameraDeviceId, cameraSettings.controls])

  useEffect(() => {
    if (videoRef.current && cameraStream) videoRef.current.srcObject = cameraStream
  }, [cameraStream, screen])

  useEffect(() => () => {
    window.clearInterval(captureTimer.current)
    window.clearInterval(advanceTimer.current)
    window.clearTimeout(shutterFlashStartTimer.current)
    window.clearTimeout(shutterFlashTimer.current)
    stopTimerFotoSound()
    if (activeRecorderRef.current?.state !== 'inactive') activeRecorderRef.current?.stop()
  }, [])

  useEffect(() => {
    if (screen === 'camera') return
    window.clearInterval(captureTimer.current)
    window.clearInterval(advanceTimer.current)
    window.clearTimeout(shutterFlashStartTimer.current)
    window.clearTimeout(shutterFlashTimer.current)
    stopTimerFotoSound()
    captureGenerationRef.current += 1
    if (activeRecorderRef.current?.state !== 'inactive') activeRecorderRef.current?.stop()
    activeRecorderRef.current = null
    captureTimer.current = undefined
    shutterFlashStartTimer.current = undefined
    shutterFlashTimer.current = undefined
    advanceTimer.current = undefined
    setCountdown(null)
    setShutterFlash(false)
    setAdvanceCountdown(null)
    setRetakeIndex(null)
    setReviewIndex(null)
    setCapturing(false)
    setRecordingSeconds(null)
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
    window.clearTimeout(shutterFlashStartTimer.current)
    window.clearTimeout(shutterFlashTimer.current)
    stopTimerFotoSound()
    captureTimer.current = undefined
    shutterFlashStartTimer.current = undefined
    shutterFlashTimer.current = undefined
    advanceTimer.current = undefined
  }

  const resetShots = () => {
    clearCaptureTimers()
    captureGenerationRef.current += 1
    if (activeRecorderRef.current?.state !== 'inactive') activeRecorderRef.current?.stop()
    activeRecorderRef.current = null
    setShots([])
    setLiveClips([])
    setCountdown(null)
    setShutterFlash(false)
    setAdvanceCountdown(null)
    setRetakeIndex(null)
    setReviewIndex(null)
    setCapturing(false)
    setRecordingSeconds(null)
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
    playTimerFotoSound()
    setCapturing(true)
    setRetakeIndex(targetIndex ?? null)
    setCountdown(5)
    setShutterFlash(false)
    setRecordingSeconds(null)
    const captureIndex = targetIndex ?? shots.length
    const captureGeneration = captureGenerationRef.current
    let remaining = 5
    let clipPromise: Promise<Uint8Array | null> = Promise.resolve(null)
    const timer = window.setInterval(() => {
      remaining -= 1
      if (remaining > 0) {
        setCountdown(remaining)
        if (remaining === 1) {
          window.clearTimeout(shutterFlashStartTimer.current)
          shutterFlashStartTimer.current = window.setTimeout(() => {
            setShutterFlash(true)
            shutterFlashStartTimer.current = undefined
          }, 755)
        }
        if (cameraStream && remaining <= 3) setRecordingSeconds(remaining)
        if (cameraStream && remaining === 3) {
          clipPromise = recordCameraClip(cameraStream, (recorder) => { activeRecorderRef.current = recorder }).then((clip) => clip, (error) => {
            setToast(error instanceof Error ? error.message : 'Live Photo gagal direkam.')
            return null
          })
        }
        return
      }
      window.clearInterval(timer)
      captureTimer.current = undefined
      window.clearTimeout(shutterFlashStartTimer.current)
      shutterFlashStartTimer.current = undefined
      setCountdown(null)
      setRecordingSeconds(null)
      window.clearTimeout(shutterFlashTimer.current)
      setShutterFlash(true)
      shutterFlashTimer.current = window.setTimeout(() => {
        setShutterFlash(false)
        shutterFlashTimer.current = undefined
      }, 200)
      const video = videoRef.current
      let image = makeDemoShot(captureIndex + 1)
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

      void clipPromise.then((clip) => {
        if (captureGeneration !== captureGenerationRef.current) return
        activeRecorderRef.current = null
        setRecordingSeconds(null)
        setShots((current) => {
          if (targetIndex === undefined) return [...current, image]
          if (targetIndex < 0 || targetIndex >= current.length) return current
          const updated = [...current]
          updated[targetIndex] = image
          return updated
        })
        setLiveClips((current) => {
          const updated = [...current]
          if (targetIndex === undefined) updated.push(clip)
          else if (targetIndex >= 0 && targetIndex < updated.length) updated[targetIndex] = clip
          return updated
        })
        setRetakeIndex(null)
        setCapturing(false)
        startAdvanceDelay(captureIndex)
      })
    }, 1000)
    captureTimer.current = timer
  }

  const beginSession = () => {
    if (sessionStartedAtRef.current && !sessionExpiredRef.current && !sessionFinalizingRef.current) {
      setToast('Sesi yang sudah dibayar masih aktif. Lanjutkan sesi tersebut sebelum memulai sesi baru.')
      setScreen('frameSelect')
      return
    }
    resetShots()
    setSessionCameraSettings(DEFAULT_SESSION_CAMERA_SETTINGS)
    setSelectedFrameId(undefined)
    setCustomerEmail('')
    setPaymentStatus(null)
    setPaymentOrderId('')
    setSessionStartedAt(null)
    setSessionRemainingMs(null)
    sessionStartedAtRef.current = 0
    sessionDeadlineRef.current = 0
    sessionExpiredRef.current = false
    sessionFinalizingRef.current = false
    activeSessionIdRef.current = ''
    setDeliveryStatus('')
    setPrintError('')
    setDriveLink('')
    setDriveExpiresAt('')
    setDriveUploadStatus('disabled')
    setDriveUploadError('')
    activeDriveSessionIdRef.current = ''
    setScreen('experience')
  }

  const selectExperience = (nextExperience: Experience) => {
    setExperience(nextExperience)
    setSelectedFrameId(undefined)
  }

  const startPaidSession = () => {
    const startedAt = Date.now()
    sessionStartedAtRef.current = startedAt
    sessionDeadlineRef.current = startedAt + (Number(config.sessionTimeoutMinutes) || 5) * 60_000
    sessionExpiredRef.current = false
    sessionFinalizingRef.current = false
    activeSessionIdRef.current = `session-${startedAt}-${crypto.randomUUID().slice(0, 8)}`
    setSessionStartedAt(startedAt)
    setSessionRemainingMs(sessionDeadlineRef.current - startedAt)
    setScreen('frameSelect')
  }

  const continueToPayment = () => {
    if (paymentStatus) {
      setScreen('frameSelect')
    } else if (config.operationMode === 'event') {
      setPaymentStatus('event')
      startPaidSession()
    } else setScreen('payment')
  }

  const paymentComplete = (orderId: string) => {
    setPaymentOrderId(orderId)
    setPaymentStatus('paid')
    startPaidSession()
  }

  const skipPayment = () => {
    if (config.operationMode !== 'dev') return
    setPaymentOrderId('')
    setPaymentStatus('skipped')
    startPaidSession()
  }

  const continueToCamera = async () => {
    if (selectedFrameId === undefined) return
    if (typeof selectedFrameId === 'string' && !compatibleFrames.some((frame) => frame.id === selectedFrameId)) return
    if (typeof selectedFrameId === 'string') {
      const frame = compatibleFrames.find((item) => item.id === selectedFrameId)
      if (frame && !isFullBoothFrameDataUrl(frame.dataUrl, frame.thumbnailDataUrl ?? '') && sessionFrameAsset?.id !== frame.id) {
        if (!window.boothConfig?.loadFrameAsset) return
        setSessionFrameLoading(true)
        try {
          const dataUrl = await window.boothConfig.loadFrameAsset(frame.id)
          const loadedFrame = { ...frame, dataUrl }
          setSessionFrameAsset(loadedFrame)
        } catch (error) {
          setToast(error instanceof Error ? error.message : 'Gambar frame gagal dimuat.')
          return
        } finally {
          setSessionFrameLoading(false)
        }
      }
    }
    setScreen('cameraSettings')
  }

  const startCamera = () => setScreen('camera')

  const selectSessionFrame = (frameId: string | null) => {
    if (frameId !== selectedFrameId) resetShots()
    setSelectedFrameId(frameId)
    setSessionFrameAsset(null)
    setSessionFrameLoading(false)
    const requestId = ++sessionFrameRequestRef.current
    if (!frameId) return
    const frame = compatibleFrames.find((item) => item.id === frameId)
    if (!frame) return
    if (isFullBoothFrameDataUrl(frame.dataUrl, frame.thumbnailDataUrl ?? '')) {
      setSessionFrameAsset(frame)
      return
    }
    if (!window.boothConfig?.loadFrameAsset) return
    setSessionFrameLoading(true)
    void window.boothConfig.loadFrameAsset(frameId).then((dataUrl) => {
      if (sessionFrameRequestRef.current === requestId) setSessionFrameAsset({ ...frame, dataUrl })
    }).catch((error) => {
      if (sessionFrameRequestRef.current === requestId) setToast(error instanceof Error ? error.message : 'Gambar frame gagal dimuat.')
    }).finally(() => {
      if (sessionFrameRequestRef.current === requestId) setSessionFrameLoading(false)
    })
  }

  const unlockAdmin = () => {
    if (password === 'admin') {
      setPasswordOpen(false)
      setPassword('')
      setAdminTab('overview')
      setScreen('admin')
    } else setPasswordError('Password belum tepat. Coba lagi.')
  }

  const saveSettings = async (
    frameAssets: BoothFrameAssetUpload[] = [],
    configToSave: Config = config,
    itemLabel = 'Konfigurasi',
  ) => {
    try {
      if (window.boothConfig && !configLoadedRef.current) throw new Error('Konfigurasi masih dimuat. Coba simpan lagi sebentar.')
      let saveResult: Awaited<ReturnType<NonNullable<typeof window.boothConfig>['save']>> | undefined
      if (window.boothConfig) {
        saveResult = await window.boothConfig.save(configToSave, frameAssets)
        if (saveResult.revision) configRevisionRef.current = saveResult.revision
        const stored = await window.boothConfig.load()
        if (typeof stored.boothFrames === 'string') setConfig((current) => ({ ...current, boothFrames: stored.boothFrames! }))
      }
      if (window.boothConfig && (configToSave.midtransServerKey.trim() || configToSave.syncToken.trim() || configToSave.telegramBotToken.trim())) {
        setConfig((current) => ({
          ...current,
          ...(configToSave.midtransServerKey.trim() ? { midtransServerKey: '', midtransServerKeyConfigured: true } : {}),
          ...(configToSave.syncToken.trim() ? { syncToken: '', syncTokenConfigured: true } : {}),
          ...(configToSave.telegramBotToken.trim() ? { telegramBotToken: '', telegramBotTokenConfigured: true } : {}),
        }))
      }
      const syncMessage = saveResult?.syncStatus === 'synced'
        ? ' Perubahan juga tersinkron ke web admin.'
        : saveResult?.syncStatus === 'pending'
          ? ` Sinkronisasi cloud tertunda${saveResult.syncError ? `: ${saveResult.syncError}` : '.'}`
          : ''
      const telegramMessage = saveResult?.telegramStatus === 'ready'
        ? ' Log Telegram aktif.'
        : saveResult?.telegramStatus === 'setup'
          ? ' Token Telegram tersimpan. Kirim /id ke bot dari chat tujuan; Chat ID disimpan otomatis.'
          : saveResult?.telegramStatus === 'pending'
            ? ` Telegram belum tersambung${saveResult.telegramError ? `: ${saveResult.telegramError}` : '.'}`
            : ''
      setToast(window.boothConfig
        ? `${itemLabel} tersimpan pada perangkat.${syncMessage}${telegramMessage}`
        : 'Mode preview: konfigurasi hanya tersimpan selama aplikasi terbuka.')
      return true
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Konfigurasi gagal disimpan.')
      return false
    }
  }

  const saveFrameCropPreset = async (updatedFrame: BoothFrame) => {
    const nextBoothFrames = {
      ...boothFrames,
      frames: boothFrames.frames.map((frame) => frame.id === updatedFrame.id ? { ...updatedFrame, dataUrl: updatedFrame.thumbnailDataUrl ?? '' } : frame),
    }
    const nextConfig = { ...config, boothFrames: serializeBoothFrameManifest(nextBoothFrames) }
    setConfig(nextConfig)
    return saveSettings([], nextConfig, 'Default crop')
  }

  const finishSession = async (files: SessionExportFile[], sessionOutcome: 'complete' | 'partial' = 'complete') => {
    if (!window.boothConfig?.saveSession) throw new Error('Penyimpanan sesi hanya tersedia di aplikasi desktop.')
    if (!paymentStatus) throw new Error('Status pembayaran sesi belum tersedia.')
    sessionFinalizingRef.current = true
    try {
      const receipt = await window.boothConfig.saveSession(files, {
        customerEmail,
        operationMode: config.operationMode,
        paymentStatus,
        paymentOrderId,
        experience,
        sessionStartedAt: new Date(sessionStartedAtRef.current || Date.now()).toISOString(),
        sessionOutcome,
      })
      const delivery = receipt.driveLink
        ? ''
        : config.googleDriveEnabled !== 'true'
          ? 'Foto tersimpan lokal. Upload Google Drive belum diaktifkan.'
          : `Folder Google Drive gagal disiapkan${receipt.driveError ? `: ${receipt.driveError}` : '.'}`
      const cloudStatus = config.syncUrl && config.syncTokenConfigured
        ? receipt.syncQueued ? ' Laporan sesi masuk antrean sinkronisasi cloud.' : ` Sinkronisasi sesi belum disiapkan${receipt.syncQueueError ? `: ${receipt.syncQueueError}` : '.'}`
        : ''
      const printStatus = receipt.printed ? ' Foto berhasil dikirim ke printer.' : ''
      setDeliveryStatus([delivery, printStatus, cloudStatus].filter(Boolean).join(''))
      setPrintError(receipt.printError ?? '')
      setDriveLink(receipt.driveLink)
      setDriveExpiresAt(receipt.driveExpiresAt ?? '')
      activeDriveSessionIdRef.current = receipt.sessionId
      const driveUpdate = driveUploadUpdatesRef.current[receipt.sessionId]
      setDriveUploadStatus(driveUpdate?.status ?? receipt.driveStatus)
      setDriveUploadError(driveUpdate?.error ?? receipt.driveError ?? '')
      setSavedPreviewFiles({
        image: files.find((file) => file.name === 'Hasil.png')?.bytes ?? null,
        gif: files.find((file) => file.name.toLowerCase().endsWith('.gif'))?.bytes ?? null,
        live: files.find((file) => file.name.toLowerCase().endsWith('.mp4'))?.bytes ?? null,
      })
      sessionStartedAtRef.current = 0
      sessionDeadlineRef.current = 0
      sessionExpiredRef.current = true
      activeSessionIdRef.current = ''
      setSessionStartedAt(null)
      setSessionRemainingMs(null)
      setSessionCount((count) => count + 1)
      setScreen('saved')
    } finally {
      sessionFinalizingRef.current = false
    }
  }

  const expireActiveSession = async () => {
    if (!sessionStartedAtRef.current || sessionFinalizingRef.current) return
    if (shots.length === 0 || selectedFrameId === undefined) {
      const shouldNotify = paymentStatus === 'paid' || paymentStatus === 'event'
      let noticeError = ''
      let noticeSynced = false
      if (shouldNotify) {
        try {
          if (!window.boothConfig?.notifyAbandonedSession) throw new Error('Pengiriman email sesi hanya tersedia di aplikasi booth.')
          const notification = await window.boothConfig.notifyAbandonedSession({
            sessionId: activeSessionIdRef.current,
            sessionStartedAt: new Date(sessionStartedAtRef.current).toISOString(),
            customerEmail,
            operationMode: config.operationMode,
            paymentStatus,
            paymentOrderId,
            experience,
          })
          noticeSynced = notification.synced === true
        } catch (error) {
          noticeError = error instanceof Error ? error.message : 'Pemberitahuan sesi gagal masuk antrean email.'
        }
      }
      sessionStartedAtRef.current = 0
      sessionDeadlineRef.current = 0
      sessionExpiredRef.current = true
      activeSessionIdRef.current = ''
      setSessionStartedAt(null)
      setSessionRemainingMs(null)
      setScreen('home')
      setToast(noticeError || (shouldNotify
        ? noticeSynced ? 'Sesi tanpa foto sudah dicatat di WebAdmin.' : 'Sesi tanpa foto masuk antrean lokal sampai booth terhubung ke WebAdmin.'
        : 'Waktu sesi development habis. Tidak ada foto yang diambil.'))
      return
    }

    sessionFinalizingRef.current = true
    try {
      let frameToSave = sessionFrame
      if (typeof selectedFrameId === 'string' && frameToSave
        && !isFullBoothFrameDataUrl(frameToSave.dataUrl, frameToSave.thumbnailDataUrl ?? '')) {
        if (!window.boothConfig?.loadFrameAsset) throw new Error('File frame belum siap untuk membuat hasil sesi.')
        const dataUrl = await window.boothConfig.loadFrameAsset(selectedFrameId)
        frameToSave = { ...frameToSave, dataUrl }
        setSessionFrameAsset(frameToSave)
      }
      const photoIndexes = frameToSave ? getFramePhotoIndexes(frameToSave) : []
      const frameShots = frameToSave && experience === 'single' && shots.length > 0
        ? Array.from({ length: photoIndexes.length }, () => shots[0])
        : shots
      const frameLiveClips = frameToSave && experience === 'single' && liveClips.length > 0
        ? Array.from({ length: photoIndexes.length }, () => liveClips[0] ?? null)
        : liveClips
      const files = await createSessionExportFiles({
        shots,
        liveClips: frameLiveClips,
        frame: frameToSave,
        frameShots,
        adjustments: {},
        cameraSettings: sessionCameraSettings,
      })
      const sessionOutcome = shots.length < shotLimit ? 'partial' : 'complete'
      await finishSession(files, sessionOutcome)
      setToast(sessionOutcome === 'partial'
        ? 'Waktu habis. Foto yang sudah diambil disimpan dan dikirim sebagai sesi parsial.'
        : 'Waktu habis. Hasil foto disimpan dan dikirim.')
    } catch (error) {
      sessionFinalizingRef.current = false
      setSessionRemainingMs(null)
      setScreen('result')
      setToast(`Waktu habis, tetapi penyimpanan otomatis gagal: ${error instanceof Error ? error.message : 'coba simpan hasil foto lagi.'}`)
    }
  }

  sessionTimeoutHandlerRef.current = () => { void expireActiveSession() }
  useEffect(() => {
    if (sessionStartedAt === null) return
    const updateTimer = () => {
      const remaining = Math.max(0, sessionDeadlineRef.current - Date.now())
      setSessionRemainingMs(remaining)
      if (remaining === 0 && !sessionExpiredRef.current && !sessionFinalizingRef.current) {
        sessionExpiredRef.current = true
        sessionTimeoutHandlerRef.current()
      }
    }
    updateTimer()
    const timerId = window.setInterval(updateTimer, 1000)
    return () => window.clearInterval(timerId)
  }, [sessionStartedAt, config.sessionTimeoutMinutes])

  const handleBack = () => {
    if (screen === 'customer') return
    setScreen(screen === 'saved' ? 'home' : screen === 'result' ? 'camera' : screen === 'camera' ? 'cameraSettings' : screen === 'cameraSettings' ? 'frameSelect' : screen === 'frameSelect' ? 'customer' : screen === 'payment' ? 'customer' : screen === 'experience' ? 'home' : 'home')
  }
  const retryResult = () => {
    resetShots()
    setScreen('camera')
  }

  return (
    <div className={`app-shell ${screen === 'admin' ? 'app-admin-side' : 'app-user-side'} ${screen === 'home' ? 'app-home' : ''} ${screen === 'camera' ? 'app-camera' : ''} ${screen === 'maintenance' ? 'app-maintenance' : ''}`}>
      {screen !== 'admin' && screen !== 'maintenance' && <AppHeader screen={screen} boothName={config.storeName} sessionRemainingMs={sessionRemainingMs} onHome={() => setScreen('home')} onBack={handleBack} />}

      <main className={`main-content ${screen === 'camera' ? 'camera-main-content' : ''}`}>
        {screen === 'home' && <HomeScreen boothName={config.storeName} onBeginSession={beginSession} />}
        {screen === 'maintenance' && <section className="maintenance-page" role="status" aria-live="polite">
          <span className="maintenance-spinner" aria-hidden="true" />
          <div className="eyebrow">WEB ADMIN UPDATE</div>
          <h1>MAINTENANCE MODE</h1>
          <p>{maintenanceMessage || 'Menyelaraskan konfigurasi booth dan frame terbaru…'}</p>
        </section>}
        {screen === 'experience' && <ExperienceScreen experience={experience} photoStripPrice={config.photoStripPrice} singlePhotoPrice={config.singlePhotoPrice} paymentCoveredByEvent={config.operationMode === 'event'} onSelectExperience={selectExperience} onBack={() => setScreen('home')} onContinue={() => setScreen('customer')} />}
        {screen === 'payment' && <PaymentScreen experience={experience} photoStripPrice={config.photoStripPrice} singlePhotoPrice={config.singlePhotoPrice} mode={config.operationMode} environment={config.paymentEnvironment} clientKey={config.midtransClientKey} serverKeyConfigured={config.midtransServerKeyConfigured} onBack={() => setScreen('customer')} onPaymentComplete={paymentComplete} onSkipPayment={skipPayment} />}
        {screen === 'customer' && <CustomerDetailsScreen email={customerEmail} onEmailChange={setCustomerEmail} continueLabel={config.operationMode === 'event' ? 'Mulai sesi foto' : paymentStatus ? 'Lanjutkan sesi' : 'Lanjut ke pembayaran'} onBack={() => setScreen('experience')} onContinue={continueToPayment} />}
        {screen === 'frameSelect' && <FrameSelectionScreen experience={experience} frames={compatibleFrames} selectedFrameId={selectedFrameId} loadingFrame={sessionFrameLoading} onSelectFrame={selectSessionFrame} onContinue={() => { void continueToCamera() }} />}
        {screen === 'cameraSettings' && <CameraSettingsScreen settings={sessionCameraSettings} cameraStream={cameraStream} cameraError={cameraError} videoRef={videoRef} onChange={setSessionCameraSettings} onBack={() => setScreen('frameSelect')} onContinue={startCamera} />}
        {screen === 'camera' && <CameraScreen experience={experience} frame={sessionFrame} shots={shots} shotLimit={shotLimit} cameraStream={cameraStream} cameraError={cameraError} countdown={countdown} shutterFlash={shutterFlash} advanceCountdown={advanceCountdown} recordingSeconds={recordingSeconds} retakeIndex={retakeIndex} reviewIndex={reviewIndex} capturing={capturing} videoRef={videoRef} cameraSettings={sessionCameraSettings} onCapture={addShot} onRetakeShot={(index) => addShot(index)} onRetake={resetShots} onContinue={() => setScreen('result')} />}
        {screen === 'result' && <ResultScreen experience={experience} printerAutoPrint={config.printerAutoPrint !== 'false'} shots={shots} liveClips={liveClips} frame={sessionFrame} cameraSettings={sessionCameraSettings} onRetake={retryResult} onFinish={finishSession} onSaveFramePreset={saveFrameCropPreset} />}
        {screen === 'saved' && <SavedScreen sessionCount={sessionCount} deliveryStatus={deliveryStatus} printError={printError} driveLink={driveLink} driveExpiresAt={driveExpiresAt} driveUploadStatus={driveUploadStatus} driveUploadError={driveUploadError} driveRetentionDays={Number(config.googleDriveRetentionDays) || 7} autoReturn={config.operationMode !== 'dev'} previewFiles={savedPreviewFiles} onHome={() => setScreen('home')} />}
        {screen === 'admin' && <AdminPanel activeTab={adminTab} setActiveTab={setAdminTab} config={config} setConfig={setConfig} onSave={saveSettings} sessionCount={sessionCount} onExit={() => setScreen('home')} />}
      </main>

      {passwordOpen && <PasswordModal password={password} error={passwordError} onPasswordChange={(value) => { setPassword(value); setPasswordError('') }} onClose={() => setPasswordOpen(false)} onSubmit={unlockAdmin} />}
      {toast && <ToastMessage message={toast} />}
    </div>
  )
}

export default App
