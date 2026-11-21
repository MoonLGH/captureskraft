/// <reference types="vite/client" />

type BoothConfig = {
  storeName: string
  storeId: string
  photoStripPrice: string
  singlePhotoPrice: string
  sessionTimeoutMinutes: string
  mongoUri: string
  syncUrl: string
  syncToken: string
  syncTokenConfigured: boolean
  telegramBotToken: string
  telegramBotTokenConfigured: boolean
  telegramChatId: string
  storagePath: string
  operationMode: 'dev' | 'booth' | 'event'
  paymentEnvironment: 'sandbox' | 'production'
  midtransClientKey: string
  midtransServerKey: string
  midtransServerKeyConfigured: boolean
  googleDriveEnabled: string
  googleDriveRetentionDays: string
  googleDriveFolder: string
  googleDriveClientId: string
  googleDriveAccountEmail: string
  cameraSettings: string
  boothFrames: string
  printerName: string
  printerAutoPrint: string
  printerPaperSize: string
  printerCopies: string
  printerColor: string
}

type BoothPrinter = {
  name: string
  displayName: string
  description: string
  status: number
  isDefault: boolean
}

type SessionFilePayload = {
  name: string
  bytes: Uint8Array
}

type SessionMetadata = {
  customerEmail: string
  operationMode: 'dev' | 'booth' | 'event'
  paymentStatus: 'paid' | 'skipped' | 'event'
  paymentOrderId: string
  experience: 'single' | 'strip'
  sessionStartedAt?: string
  sessionOutcome?: 'complete' | 'partial'
}

type AbandonedSessionMetadata = Omit<SessionMetadata, 'sessionOutcome'> & {
  sessionId: string
  sessionStartedAt: string
}

type DriveUploadUpdate = {
  sessionId: string
  status: 'uploaded' | 'error'
  error?: string
  driveExpiresAt?: string
}

type CreateMidtransPaymentInput = {
  amount: number
  experience: 'single' | 'strip'
}

type PrinterSettings = {
  printerName: string
  printerPaperSize: string
  printerCopies: number
  printerColor: boolean
}

interface Window {
  boothConfig?: {
    load: () => Promise<Partial<BoothConfig>>
    getRevision?: () => Promise<string>
    save: (config: BoothConfig, frameAssets?: { frameId: string; dataUrl: string }[]) => Promise<{ saved: boolean; revision?: string; syncStatus?: string; syncError?: string; telegramStatus?: string; telegramError?: string }>
    onTelegramChatId?: (callback: (chatId: string) => void) => () => void
    loadFrameAsset: (frameId: string) => Promise<string>
    listPrinters?: () => Promise<BoothPrinter[]>
    testPrinter?: (settings: PrinterSettings) => Promise<{ printed: boolean; error?: string }>
    syncNow?: () => Promise<{ synced: boolean; message: string; framesDeferred?: boolean }>
    checkCloudUpdates?: () => Promise<{ checked: boolean; changed?: boolean; remoteChanged?: boolean; synced?: boolean; failed?: boolean; busy?: boolean; deferred?: boolean; waitingForWebAdmin?: boolean; message?: string }>
    setSyncApplyAllowed?: (allowed: boolean) => Promise<boolean>
    setFrameSyncApplyAllowed?: (allowed: boolean) => Promise<boolean>
    setCloudApplyAllowed?: (configAllowed: boolean, frameAllowed: boolean) => Promise<{ config: boolean; frames: boolean }>
    setSessionActive?: (active: boolean) => Promise<{ active: boolean }>
    syncForMaintenance?: () => Promise<{ synced: boolean; allSynced: boolean; restartRequired?: boolean; waitingForWebAdmin?: boolean; busy?: boolean; failed?: boolean; message?: string }>
    restartAfterMaintenance?: () => Promise<{ restarting: boolean; restartRequired?: boolean; message?: string }>
    saveSession: (files: SessionFilePayload[], metadata: SessionMetadata) => Promise<{ saved: boolean; directory: string; sessionId: string; driveUploaded: boolean; driveLink: string; driveExpiresAt?: string; driveError?: string; driveStatus: 'disabled' | 'uploading' | 'uploaded' | 'error'; syncQueued?: boolean; syncQueueError?: string; printed?: boolean; printError?: string }>
    notifyAbandonedSession?: (metadata: AbandonedSessionMetadata) => Promise<{ queued: boolean; synced?: boolean; error?: string }>
    onDriveUploadStatus?: (callback: (update: DriveUploadUpdate) => void) => () => void
    chooseStoragePath: () => Promise<{ canceled: boolean; path: string }>
    createMidtransPayment: (input: CreateMidtransPaymentInput) => Promise<{ token: string; orderId: string }>
    verifyMidtransPayment: (orderId: string) => Promise<{ paid: boolean; status: string; terminal: boolean }>
    testGoogleDrive: () => Promise<{ message: string; account: string }>
    connectGoogleDrive: (credentials: { clientId: string; clientSecret?: string }) => Promise<{ message: string; account: string }>
  }
}

type MidtransSnapOptions = {
  onSuccess: (result: unknown) => void
  onPending: (result: unknown) => void
  onError: (result: unknown) => void
  onClose: () => void
}

interface Window {
  snap?: {
    pay: (token: string, options: MidtransSnapOptions) => void
    hide?: () => void
  }
}
