declare module 'gif.js' {
  type GifOptions = {
    workers?: number
    workerScript?: string
    width?: number
    height?: number
    repeat?: number
    quality?: number
    dither?: string | boolean
  }

  type FrameOptions = { copy?: boolean; delay?: number; dispose?: number }

  export default class GIF {
    constructor(options?: GifOptions)
    addFrame(source: CanvasRenderingContext2D | HTMLCanvasElement | HTMLImageElement, options?: FrameOptions): void
    on(event: 'finished', callback: (blob: Blob, bytes: Uint8Array) => void): this
    render(): void
  }
}
