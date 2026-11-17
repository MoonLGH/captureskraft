export type Screen = 'home' | 'experience' | 'payment' | 'customer' | 'frameSelect' | 'camera' | 'result' | 'saved' | 'admin'
export type AdminTab = 'overview' | 'connections' | 'booth' | 'camera' | 'frames' | 'sync'
export type Experience = 'single' | 'strip'
export type PaymentStatus = 'paid' | 'skipped' | 'event'
export type OperationMode = 'dev' | 'booth' | 'event'
export type PaymentEnvironment = 'sandbox' | 'production'

export type Config = {
  storeName: string
  storeId: string
  price: string
  mongoUri: string
  syncUrl: string
  storagePath: string
  operationMode: OperationMode
  paymentEnvironment: PaymentEnvironment
  midtransClientKey: string
  midtransServerKey: string
  midtransServerKeyConfigured: boolean
  rcloneEnabled: string
  rcloneExecutable: string
  rcloneRemote: string
  rcloneFolder: string
  rcloneConfigPath: string
  cameraSettings: string
  boothFrames: string
}
