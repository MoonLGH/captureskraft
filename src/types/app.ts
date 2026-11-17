export type Screen = 'home' | 'experience' | 'camera' | 'result' | 'saved' | 'admin'
export type AdminTab = 'overview' | 'connections' | 'booth' | 'camera' | 'frames' | 'sync'
export type Experience = 'single' | 'strip'

export type Config = {
  storeName: string
  storeId: string
  price: string
  mongoUri: string
  ftpHost: string
  ftpPort: string
  ftpUser: string
  ftpPassword: string
  syncUrl: string
  cameraSettings: string
  boothFrames: string
}
