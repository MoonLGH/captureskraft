/// <reference types="vite/client" />

type BoothConfig = {
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

interface Window {
  boothConfig?: {
    load: () => Promise<Partial<BoothConfig>>
    save: (config: BoothConfig) => Promise<{ saved: boolean }>
  }
}
