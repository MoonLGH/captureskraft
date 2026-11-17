import type { BoothFrame } from './boothFrames'

export type CameraControlKey =
  | 'iso'
  | 'exposureCompensation'
  | 'exposureTime'
  | 'colorTemperature'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'sharpness'
  | 'focusDistance'
  | 'zoom'
  | 'exposureMode'
  | 'whiteBalanceMode'
  | 'focusMode'

export type CameraControlValue = number | string
export type CameraControlValues = Partial<Record<CameraControlKey, CameraControlValue>>

export type CameraSettings = {
  cameraDeviceId: string
  cameraDeviceLabel: string
  controls: CameraControlValues
}

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  cameraDeviceId: '',
  cameraDeviceLabel: '',
  controls: {},
}

export const NUMERIC_CAMERA_CONTROLS: { key: Extract<CameraControlKey,
  'iso' | 'exposureCompensation' | 'exposureTime' | 'colorTemperature' | 'brightness' | 'contrast' | 'saturation' | 'sharpness' | 'focusDistance' | 'zoom'>; label: string; unit: string }[] = [
  { key: 'iso', label: 'ISO', unit: 'ISO' },
  { key: 'exposureCompensation', label: 'Kompensasi exposure', unit: 'EV' },
  { key: 'exposureTime', label: 'Waktu exposure', unit: 's' },
  { key: 'colorTemperature', label: 'Temperatur warna', unit: 'K' },
  { key: 'brightness', label: 'Brightness', unit: '' },
  { key: 'contrast', label: 'Contrast', unit: '' },
  { key: 'saturation', label: 'Saturation', unit: '' },
  { key: 'sharpness', label: 'Sharpness', unit: '' },
  { key: 'focusDistance', label: 'Focus distance', unit: 'm' },
  { key: 'zoom', label: 'Zoom', unit: '×' },
]

const CAMERA_CONTROL_KEYS = new Set<CameraControlKey>([
  ...NUMERIC_CAMERA_CONTROLS.map(({ key }) => key),
  'exposureMode', 'whiteBalanceMode', 'focusMode',
])

export function parseCameraSettings(value: string | undefined): CameraSettings {
  if (!value) return { ...DEFAULT_CAMERA_SETTINGS, controls: {} }

  try {
    const parsed = JSON.parse(value) as Partial<CameraSettings> & Record<string, unknown>
    const rawControls = parsed.controls && typeof parsed.controls === 'object'
      ? parsed.controls as Record<string, unknown>
      : {}
    const controls: CameraControlValues = {}

    for (const [key, controlValue] of Object.entries(rawControls)) {
      if (!CAMERA_CONTROL_KEYS.has(key as CameraControlKey)) continue
      if (typeof controlValue === 'number' && Number.isFinite(controlValue)) controls[key as CameraControlKey] = controlValue
      if (typeof controlValue === 'string') controls[key as CameraControlKey] = controlValue
    }

    return {
      cameraDeviceId: typeof parsed.cameraDeviceId === 'string' ? parsed.cameraDeviceId : '',
      cameraDeviceLabel: typeof parsed.cameraDeviceLabel === 'string' ? parsed.cameraDeviceLabel : '',
      controls,
    }
  } catch {
    return { ...DEFAULT_CAMERA_SETTINGS, controls: {} }
  }
}

export function serializeCameraSettings(settings: CameraSettings) {
  return JSON.stringify(settings)
}

export function cameraTrackConstraints(settings: CameraSettings): MediaTrackConstraints {
  const exactControls = Object.fromEntries(Object.entries(settings.controls).map(([key, value]) => [key, { exact: value }]))
  return Object.keys(exactControls).length
    ? { advanced: [exactControls] as unknown as MediaTrackConstraintSet[] }
    : {}
}

export function parseLegacyBoothFrame(value: string | undefined): BoothFrame | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as { frame?: Record<string, unknown> | null }
    const frame = parsed.frame
    if (!frame || typeof frame.dataUrl !== 'string' || !frame.dataUrl.startsWith('data:image/png;base64,')) return null
    const width = Number(frame.width)
    const height = Number(frame.height)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
    const slots = Array.isArray(frame.slots) ? frame.slots.map((slotValue, index) => {
      if (!slotValue || typeof slotValue !== 'object') return null
      const slot = slotValue as { id?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown }
      const converted = {
        id: typeof slot.id === 'string' ? slot.id : `legacy-slot-${index + 1}`,
        x: Number(slot.x) * width / 100,
        y: Number(slot.y) * height / 100,
        width: Number(slot.width) * width / 100,
        height: Number(slot.height) * height / 100,
        rotation: 0,
      }
      return Object.values(converted).every((item) => typeof item === 'string' || Number.isFinite(item))
        && converted.width > 0 && converted.height > 0
        ? converted
        : null
    }).filter((slot): slot is NonNullable<typeof slot> => slot !== null) : []
    return {
      id: `migrated-${Date.now()}`,
      name: typeof frame.name === 'string' ? frame.name : 'Imported frame',
      dataUrl: frame.dataUrl,
      width,
      height,
      slots,
    }
  } catch {
    return null
  }
}

