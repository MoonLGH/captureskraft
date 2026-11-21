export type Screen = 'home' | 'experience' | 'payment' | 'customer' | 'frameSelect' | 'cameraSettings' | 'camera' | 'result' | 'saved' | 'admin' | 'maintenance'
export type AdminTab = 'overview' | 'connections' | 'booth' | 'camera' | 'frames' | 'printer' | 'sync'
export type Experience = 'single' | 'strip'
export type PaymentStatus = 'paid' | 'skipped' | 'event'
export type OperationMode = 'dev' | 'booth' | 'event'
export type PaymentEnvironment = 'sandbox' | 'production'

export type Config = {
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
  operationMode: OperationMode
  paymentEnvironment: PaymentEnvironment
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
