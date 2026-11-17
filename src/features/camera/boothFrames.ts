export type FrameSlot = {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export type BoothFrame = {
  id: string
  name: string
  dataUrl: string
  width: number
  height: number
  slots: FrameSlot[]
}

export type BoothFramesSettings = {
  frames: BoothFrame[]
  activeFrameId: string
}

export type BoothFramePreset = {
  format: 'capturs-booth-frame'
  version: 1
  frame: BoothFrame
}

export const DEFAULT_BOOTH_FRAMES: BoothFramesSettings = {
  frames: [],
  activeFrameId: '',
}

export function createId(prefix = 'frame') {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

function parseFrame(value: unknown): BoothFrame | null {
  if (!value || typeof value !== 'object') return null
  const frame = value as Partial<BoothFrame>
  if (typeof frame.dataUrl !== 'string' || !frame.dataUrl.startsWith('data:image/png;base64,')) return null
  if (typeof frame.width !== 'number' || typeof frame.height !== 'number'
    || !Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width <= 0 || frame.height <= 0) return null

  const slots = Array.isArray(frame.slots) ? frame.slots.flatMap((slotValue) => {
    if (!slotValue || typeof slotValue !== 'object') return []
    const slot = slotValue as Partial<FrameSlot>
    if (typeof slot.id !== 'string' || ![slot.x, slot.y, slot.width, slot.height].every((number) => typeof number === 'number' && Number.isFinite(number))) return []
    const width = Math.min(frame.width!, Math.max(1, slot.width!))
    const height = Math.min(frame.height!, Math.max(1, slot.height!))
    return [{
      id: slot.id,
      x: Math.min(frame.width! - width, Math.max(0, slot.x!)),
      y: Math.min(frame.height! - height, Math.max(0, slot.y!)),
      width,
      height,
      rotation: typeof slot.rotation === 'number' && Number.isFinite(slot.rotation) ? slot.rotation : 0,
    }]
  }) : []

  return {
    id: typeof frame.id === 'string' ? frame.id : createId(),
    name: typeof frame.name === 'string' && frame.name ? frame.name : 'Custom frame',
    dataUrl: frame.dataUrl,
    width: frame.width,
    height: frame.height,
    slots,
  }
}

export function parseBoothFrames(value: string | undefined): BoothFramesSettings {
  if (!value) return { ...DEFAULT_BOOTH_FRAMES, frames: [] }
  try {
    const parsed = JSON.parse(value) as Partial<BoothFramesSettings>
    const frames = Array.isArray(parsed.frames) ? parsed.frames.map(parseFrame).filter((frame): frame is BoothFrame => frame !== null) : []
    const activeFrameId = typeof parsed.activeFrameId === 'string' && frames.some((frame) => frame.id === parsed.activeFrameId)
      ? parsed.activeFrameId
      : frames[0]?.id ?? ''
    return { frames, activeFrameId }
  } catch {
    return { ...DEFAULT_BOOTH_FRAMES, frames: [] }
  }
}

export function serializeBoothFrames(settings: BoothFramesSettings) {
  return JSON.stringify(settings)
}

export function createFramePreset(frame: BoothFrame): BoothFramePreset {
  return { format: 'capturs-booth-frame', version: 1, frame }
}

export function parseFramePreset(value: unknown): BoothFrame | null {
  if (!value || typeof value !== 'object') return null
  const preset = value as Partial<BoothFramePreset>
  if (preset.format !== 'capturs-booth-frame' || preset.version !== 1) return null
  return parseFrame(preset.frame)
}
