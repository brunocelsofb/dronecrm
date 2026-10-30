'use client'
// Peças do campo de mensagem da Central: emojis e gravação de áudio (sem biblioteca nova).
import { useEffect, useRef, useState } from 'react'

const EMOJI_GROUPS: { label: string; list: string[] }[] = [
  { label: 'Carinhas', list: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '🙂', '😉', '😍', '🥰', '😘', '😋', '😎', '🤩', '🥳', '🤔', '🤗', '🤭', '😐', '😶', '🙄', '😏', '😬', '😌', '😴', '😷', '🤒', '😢', '😭', '😤', '😡', '😱', '😳', '🥺', '😇', '🤝', '🙏'] },
  { label: 'Gestos', list: ['👍', '👎', '👌', '✌️', '🤞', '👏', '🙌', '👋', '💪', '👀', '✋', '🤙', '👉', '👈', '☝️', '🫶'] },
  { label: 'Símbolos', list: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '✅', '❌', '⚠️', '❗', '❓', '⭐', '🔥', '✨', '🎉', '🎁', '💰', '💵', '📦', '🚚', '📍', '📅', '⏰', '📞', '📷', '📄', '🔗', '🛒', '🏷️', '💳'] },
]

export function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div role="dialog" aria-label="Emojis"
        className="absolute bottom-full left-0 z-30 mb-2 max-h-72 w-72 overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
        {EMOJI_GROUPS.map(g => (
          <div key={g.label} className="mb-1">
            <p className="px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{g.label}</p>
            <div className="grid grid-cols-8 gap-0.5">
              {g.list.map(e => (
                <button key={e} type="button" onClick={() => onPick(e)}
                  className="rounded p-1 text-xl leading-none hover:bg-gray-100" aria-label={`Inserir ${e}`}>{e}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// Formato do áudio que o navegador grava (Chrome/Edge: webm; Firefox: ogg; Safari: mp4)
function pickAudioType(): { mime: string; ext: string } {
  const opts = [
    { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
    { mime: 'audio/webm;codecs=opus', ext: 'webm' },
    { mime: 'audio/webm', ext: 'webm' },
    { mime: 'audio/mp4', ext: 'm4a' },
  ]
  if (typeof MediaRecorder === 'undefined') return opts[1]
  return opts.find(o => MediaRecorder.isTypeSupported?.(o.mime)) ?? { mime: '', ext: 'webm' }
}

export type VoiceClip = { blob: Blob; ext: string; mime: string; seconds: number }

// Gravador de voz: start() pede o microfone; stop() devolve o áudio; cancel() descarta
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAt = useRef(0)
  const type = useRef(pickAudioType())

  function cleanup() {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    stream.current?.getTracks().forEach(t => t.stop())
    stream.current = null
    rec.current = null
    setRecording(false)
  }
  useEffect(() => () => cleanup(), [])

  async function start() {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Este navegador não grava áudio.')
      return
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Sem acesso ao microfone. Libere o microfone para este site no navegador.')
      return
    }
    type.current = pickAudioType()
    chunks.current = []
    const r = new MediaRecorder(stream.current, type.current.mime ? { mimeType: type.current.mime } : undefined)
    r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data) }
    r.start(250)
    rec.current = r
    startedAt.current = Date.now()
    setSeconds(0)
    setRecording(true)
    timer.current = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 250)
  }

  function stop(): Promise<VoiceClip | null> {
    const r = rec.current
    if (!r) return Promise.resolve(null)
    return new Promise(resolve => {
      r.onstop = () => {
        const mime = r.mimeType || type.current.mime || 'audio/webm'
        const blob = new Blob(chunks.current, { type: mime.split(';')[0] })
        const secs = Math.round((Date.now() - startedAt.current) / 1000)
        cleanup()
        resolve(blob.size && secs >= 1 ? { blob, ext: type.current.ext, mime: mime.split(';')[0], seconds: secs } : null)
      }
      r.stop()
    })
  }

  function cancel() {
    const r = rec.current
    if (r) { r.onstop = () => cleanup(); r.stop() } else cleanup()
    chunks.current = []
  }

  return { recording, seconds, error, start, stop, cancel, setError }
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
