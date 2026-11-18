/// <reference types="vite/client" />

type BoothConfig = {
  storeName: string
  storeId: string
  price: string
  mongoUri: string
  syncUrl: string
  storagePath: string
  operationMode: 'dev' | 'booth' | 'event'
  paymentEnvironment: 'sandbox' | 'production'
  midtransClientKey: string
  midtransServerKey: string
  midtransServerKeyConfigured: boolean
  rcloneEnabled: string
  rcloneExecutable: string
  rcloneRemote: string
  rcloneFolder: string
  rcloneConfigPath: string
  rcloneClientId: string
  rcloneClientSecret: string
  rcloneClientSecretConfigured: boolean
  cameraSettings: string
  boothFrames: string
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
}

type CreateMidtransPaymentInput = {
  amount: number
  experience: 'single' | 'strip'
}

type RcloneSettings = {
  executable: string
  remote: string
  folder: string
  configPath: string
}

interface Window {
  boothConfig?: {
    load: () => Promise<Partial<BoothConfig>>
    getRevision?: () => Promise<string>
    save: (config: BoothConfig) => Promise<{ saved: boolean; revision?: string }>
    saveSession: (files: SessionFilePayload[], metadata: SessionMetadata) => Promise<{ saved: boolean; directory: string; driveUploaded: boolean; driveLink: string; driveError?: string }>
    chooseStoragePath: () => Promise<{ canceled: boolean; path: string }>
    createMidtransPayment: (input: CreateMidtransPaymentInput) => Promise<{ token: string; orderId: string }>
    verifyMidtransPayment: (orderId: string) => Promise<{ paid: boolean; status: string; terminal: boolean }>
    testRclone: (settings: RcloneSettings) => Promise<{ message: string; account: string }>
    connectRclone: (settings: RcloneSettings) => Promise<{ message: string; account: string }>
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
