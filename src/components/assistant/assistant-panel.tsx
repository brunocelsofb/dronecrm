'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

// Théo: conversa (pergunta → resposta; ações pedem confirmação) e a aba "O que o Théo faz",
// com as consultas e ações liberadas para esta pessoa na licença da empresa.

type Turn = { role: 'user' | 'assistant'; text: string }
type Pending = { name: string; input: Record<string, unknown>; label: string; lines: string[] }
type Info = { canUse: boolean; isAdmin?: boolean; ready?: boolean; provider?: string | null; tools?: { name: string; label: string; group: string; kind: 'consulta' | 'acao' }[] }

const STORAGE_KEY = 'assistant_button_position'

export function AssistantPanel() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'chat' | 'acoes'>('chat')
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [info, setInfo] = useState<Info | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Posição do botão flutuante — arrastável e lembrada neste navegador
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const dragInfo = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Lido depois de montar (o servidor não tem localStorage)
    const t = setTimeout(() => { try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) setPosition(JSON.parse(saved)) } catch { /* posição padrão */ } }, 0)
    return () => clearTimeout(t)
  }, [])

  // O que o Théo faz (carrega ao abrir pela primeira vez)
  useEffect(() => {
    if (!open || info) return
    fetch('/api/assistant/info', { credentials: 'include' }).then(r => r.json()).then(setInfo).catch(() => setInfo({ canUse: false }))
  }, [open, info])

  function handleDragStart(e: React.MouseEvent) {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    dragInfo.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top, moved: false }
    document.addEventListener('mousemove', handleDragMove)
    document.addEventListener('mouseup', handleDragEnd)
  }
  function handleDragMove(e: MouseEvent) {
    if (!dragInfo.current) return
    const dx = e.clientX - dragInfo.current.startX
    const dy = e.clientY - dragInfo.current.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragInfo.current.moved = true
    setPosition({ x: Math.min(Math.max(dragInfo.current.origX + dx, 8), window.innerWidth - 56), y: Math.min(Math.max(dragInfo.current.origY + dy, 8), window.innerHeight - 56) })
  }
  function handleDragEnd() {
    document.removeEventListener('mousemove', handleDragMove)
    document.removeEventListener('mouseup', handleDragEnd)
    if (position) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(position)) } catch { /* sem problema */ } }
    if (dragInfo.current && !dragInfo.current.moved) setOpen(v => !v)
    dragInfo.current = null
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, pending])

  async function handleSend(text?: string) {
    const userText = (text ?? input).trim()
    if (!userText || busy || pending) return
    setInput('')
    setError(null)
    setTab('chat')
    const history: Turn[] = [...turns, { role: 'user', text: userText }]
    setTurns(history)
    setBusy(true)
    try {
      const res = await fetch('/api/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ history }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Falha ao falar com o Théo.'); return }
      if (data.text) setTurns(t => [...t, { role: 'assistant', text: data.text }])
      if (data.pending) setPending(data.pending)
      else if (!data.text) setTurns(t => [...t, { role: 'assistant', text: '(sem resposta)' }])
    } catch {
      setError('Falha de conexão com o Théo.')
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmAction() {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/assistant/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: pending.name, input: pending.input }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Falha ao executar a ação.'); return }
      setTurns(t => [...t, { role: 'assistant', text: data.text ?? 'Feito.' }])
      setPending(null)
      router.refresh()
    } catch {
      setError('Falha de conexão ao executar a ação.')
    } finally {
      setBusy(false)
    }
  }

  function handleCancelAction() {
    setPending(null)
    setTurns(t => [...t, { role: 'assistant', text: 'Ação cancelada.' }])
  }

  const groups = [...new Set((info?.tools ?? []).map(t => t.group))]

  return (
    <>
      <button
        ref={buttonRef}
        onMouseDown={handleDragStart}
        style={position ? { position: 'fixed', left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : { position: 'fixed', right: 20, bottom: 20 }}
        className="z-40 flex h-12 w-12 cursor-grab items-center justify-center rounded-full bg-brand-700 text-xl text-white shadow-lg hover:bg-brand-800 active:cursor-grabbing"
        title="Théo — clique pra abrir, arraste pra mover"
        aria-label="Abrir o Théo, assistente de IA"
      >
        🤖
      </button>

      {open && (
        <div
          style={position
            ? { position: 'fixed', left: Math.min(position.x, window.innerWidth - 384 - 8), top: Math.max(position.y - 536, 8) }
            : { position: 'fixed', right: 12, bottom: 80 }}
          className="z-40 flex h-[min(520px,calc(100dvh-6rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col rounded-xl border border-gray-200 bg-white shadow-2xl"
          role="dialog" aria-label="Théo, assistente de IA"
        >
          <div className="flex items-center justify-between rounded-t-xl bg-brand-700 px-4 py-2.5">
            <p className="text-sm font-medium text-white">🤖 Théo{info?.provider ? <span className="ml-1 text-[11px] font-normal text-white/70">· {info.provider}</span> : null}</p>
            <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white" aria-label="Fechar">✕</button>
          </div>
          <div className="flex border-b border-gray-200 text-xs" role="tablist">
            {([['chat', 'Conversa'], ['acoes', 'O que o Théo faz']] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`flex-1 py-2 font-medium ${tab === k ? 'border-b-2 border-brand-700 text-brand-700' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
            ))}
          </div>

          {tab === 'acoes' ? (
            <div className="flex-1 overflow-y-auto p-3 text-sm">
              {!info ? <p className="text-xs text-gray-400">Carregando…</p> : !info.canUse ? (
                <p className="text-xs text-gray-500">O Théo não está liberado para você.</p>
              ) : (
                <>
                  {!info.ready && (
                    <p className="mb-3 rounded-md bg-warn-100 px-2 py-1.5 text-xs text-warn-700">
                      {info.isAdmin ? <>O Théo ainda não está ligado. <Link href="/settings/assistente" className="font-semibold underline">Ligar agora</Link></> : 'O Théo ainda não está ligado na empresa. Fale com o administrador.'}
                    </p>
                  )}
                  <p className="mb-2 text-xs text-gray-500">Clique num item para perguntar. Ações só acontecem depois que você confirma.</p>
                  {groups.map(g => (
                    <div key={g} className="mb-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g}</p>
                      <ul className="mt-1 space-y-0.5">
                        {(info.tools ?? []).filter(t => t.group === g).map(t => (
                          <li key={t.name}>
                            <button onClick={() => { setTab('chat'); setInput(t.kind === 'acao' ? `${t.label}: ` : t.label) }}
                              className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-gray-50">
                              <span className={`mt-0.5 shrink-0 rounded px-1 text-[9px] font-semibold ${t.kind === 'acao' ? 'bg-warn-100 text-warn-700' : 'bg-brand-100 text-brand-700'}`}>{t.kind === 'acao' ? 'AÇÃO' : 'CONSULTA'}</span>
                              <span className="text-gray-800">{t.label}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {info.isAdmin && <p className="mt-2 text-[11px] text-gray-400">Tudo sobre a IA da empresa: <Link href="/ia" className="text-brand-700 hover:underline">IA da empresa</Link></p>}
                </>
              )}
            </div>
          ) : (
            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
              {turns.length === 0 && (
                <p className="mt-4 text-center text-xs text-gray-400">
                  Pergunte algo como &ldquo;minhas atividades de hoje&rdquo; ou &ldquo;anote na oportunidade do cliente X que…&rdquo;. Veja tudo em <button onClick={() => setTab('acoes')} className="text-brand-700 hover:underline">O que o Théo faz</button>.
                </p>
              )}
              {turns.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-800'}`}>{m.text}</div>
                </div>
              ))}
              {busy && !pending && <p className="text-xs text-gray-400">Théo está pensando…</p>}
              {pending && (
                <div className="rounded-lg border border-warn-600/40 bg-warn-100 p-3 text-sm">
                  <p className="font-medium text-warn-700">Confirmar: {pending.label}</p>
                  {pending.lines.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-gray-700">{pending.lines.map((l, i) => <li key={i} className="break-words">• {l}</li>)}</ul>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button onClick={handleConfirmAction} disabled={busy} className="rounded-md bg-positive-600 px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">{busy ? 'Executando…' : 'Confirmar'}</button>
                    <button onClick={handleCancelAction} disabled={busy} className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
                  </div>
                </div>
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
          )}

          <div className="flex gap-2 border-t border-gray-200 p-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSend() }}
              disabled={busy || !!pending}
              placeholder="Pergunte ou peça algo…"
              aria-label="Mensagem para o Théo"
              className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none disabled:bg-gray-100"
            />
            <button onClick={() => handleSend()} disabled={busy || !!pending} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? '…' : 'Enviar'}</button>
          </div>
        </div>
      )}
    </>
  )
}
