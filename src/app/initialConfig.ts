import type { Config } from '../types/app'
import { DEFAULT_CAMERA_SETTINGS } from '../features/camera/cameraSettings'
import { DEFAULT_BOOTH_FRAMES } from '../features/camera/boothFrames'

export const initialConfig: Config = {
  storeName: 'Capturs Photobooth',
  storeId: 'capturs-jakarta-01',
  price: '35000',
  mongoUri: '',
  syncUrl: '',
  storagePath: '',
  operationMode: 'dev',
  paymentEnvironment: 'sandbox',
  midtransClientKey: '',
  midtransServerKey: '',
  midtransServerKeyConfigured: false,
  rcloneEnabled: 'false',
  rcloneExecutable: 'rclone',
  rcloneRemote: 'gdrive',
  rcloneFolder: 'Capturs',
  rcloneConfigPath: '',
  cameraSettings: JSON.stringify(DEFAULT_CAMERA_SETTINGS),
  boothFrames: JSON.stringify(DEFAULT_BOOTH_FRAMES),
}
