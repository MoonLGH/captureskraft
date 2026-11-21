const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

class TelegramApiError extends Error {
  constructor(message, retryAfter = 0) {
    super(message)
    this.retryAfter = retryAfter
  }
}

async function telegramRequest(token, method, payload = {}, timeoutMs = 15_000, signal) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  })
  const result = await response.json().catch(() => null)
  if (response.ok && result?.ok === true) return result.result
  const retryAfter = Number(result?.parameters?.retry_after) || 0
  throw new TelegramApiError(`Telegram HTTP ${response.status}`, retryAfter)
}

function createTelegramBot({ getSettings, claimEvent, settleEvent, onChatId = async () => {}, onStatus = () => {} }) {
  let running = false
  let controller
  let updateOffset = 0
  let offsetToken = ''
  let lastWarning = 0

  const isRunning = (signal) => running && !signal.aborted
  const warn = (message) => {
    if (Date.now() - lastWarning < 30_000) return
    lastWarning = Date.now()
    onStatus(message)
    console.warn(`[telegram] ${message}`)
  }

  async function pollCommands(signal) {
    while (isRunning(signal)) {
      try {
        const settings = await getSettings()
        if (!settings.token) {
          await sleep(1500)
          continue
        }
        if (settings.token !== offsetToken) {
          offsetToken = settings.token
          updateOffset = 0
        }
        const updates = await telegramRequest(settings.token, 'getUpdates', {
          offset: updateOffset || undefined,
          limit: 50,
          timeout: 15,
          allowed_updates: ['message'],
        }, 20_000, signal)
        for (const update of updates) {
          if (!isRunning(signal)) return
          const nextOffset = update.update_id + 1
          const message = update.message
          const command = typeof message?.text === 'string'
            ? message.text.trim().split(/\s+/, 1)[0].split('@', 1)[0].toLowerCase()
            : ''
          if (message?.chat?.id === undefined || !['/start', '/id', '/help'].includes(command)) {
            updateOffset = nextOffset
            continue
          }
          const chatId = String(message.chat.id)
          await telegramRequest(settings.token, 'sendMessage', {
            chat_id: chatId,
            text: [
              'Capturs WebAdmin Telegram Logger siap.',
              `Chat ID: ${chatId}`,
              'App menyimpan Chat ID ini otomatis. Tujuan log bisa diatur di WebAdmin → Telegram.',
              'Setelah terhubung, bot mengirim log sesi, pembayaran, konfigurasi, perangkat, dan perubahan frame.',
            ].join('\n'),
          }, 12_000, signal)
          if (command === '/id') await onChatId(chatId)
          updateOffset = nextOffset
          onStatus('Bot Telegram aktif.')
        }
      } catch (error) {
        if (!isRunning(signal)) return
        warn(error instanceof TelegramApiError ? 'Belum bisa menghubungi bot Telegram; akan mencoba lagi.' : 'Pengaturan bot Telegram belum bisa dibaca; akan mencoba lagi.')
        await sleep(2500)
      }
    }
  }

  async function deliverEvents(signal) {
    while (isRunning(signal)) {
      let settings
      let event
      try {
        settings = await getSettings()
        if (!settings.token || !settings.syncUrl || !settings.deviceApproved) {
          await sleep(1500)
          continue
        }
        event = await claimEvent()
        if (!event?.id || !event?.text || !event?.chatId) {
          await sleep(5000)
          continue
        }
        await telegramRequest(settings.token, 'sendMessage', {
          chat_id: event.chatId,
          text: event.text,
        }, 12_000, signal)
        await settleEvent(event.id, { action: 'sent' })
      } catch (error) {
        if (!isRunning(signal)) return
        if (event?.id) {
          const retryAfterMs = error instanceof TelegramApiError && error.retryAfter > 0
            ? error.retryAfter * 1000
            : 10_000
          await settleEvent(event.id, { action: 'retry', retryAfterMs }).catch(() => {})
        }
        warn(error instanceof TelegramApiError ? 'Pengiriman log Telegram tertunda; akan dicoba lagi.' : 'Koneksi antrean log belum tersedia; akan mencoba lagi.')
        await sleep(2500)
      }
    }
  }

  return {
    start() {
      if (running) return
      running = true
      controller = new AbortController()
      onStatus('Bot Telegram berjalan dari aplikasi.')
      void Promise.all([pollCommands(controller.signal), deliverEvents(controller.signal)])
    },
    stop() {
      running = false
      controller?.abort()
    },
  }
}

module.exports = { createTelegramBot }
