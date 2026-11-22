import buttonClickSource from '../../codex/button-click.mpeg'
import timerFotoSource from '../../codex/timer-foto.mpeg'

let buttonClickAudio: HTMLAudioElement | null = null
let timerFotoAudio: HTMLAudioElement | null = null

function play(audio: HTMLAudioElement) {
  try {
    audio.currentTime = 0
  } catch {
    // Metadata may not be ready on the first user click.
  }
  void audio.play().catch(() => {})
}

export function playButtonClickSound() {
  if (typeof Audio === 'undefined') return
  buttonClickAudio ??= new Audio(buttonClickSource)
  play(buttonClickAudio)
}

export function playTimerFotoSound() {
  if (typeof Audio === 'undefined') return
  timerFotoAudio ??= new Audio(timerFotoSource)
  play(timerFotoAudio)
}

export function stopTimerFotoSound() {
  if (!timerFotoAudio) return
  timerFotoAudio.pause()
  try {
    timerFotoAudio.currentTime = 0
  } catch {
    // Ignore resets before metadata is ready.
  }
}
