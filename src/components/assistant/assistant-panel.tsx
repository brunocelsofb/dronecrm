'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type DisplayMessage = { role: 'user' | 'assistant'; text: string }
type PendingAction = { toolUseId: string; toolName: string; toolInput: Record<string, unknown> } | null

const TOOL_LABELS: Record<string, string> = {
  create_company: 'Criar empresa',
  add_note: 'Adicionar nota',
  move_contract_stage: 'Mover etapa do contrato',
}

const STORAGE_KEY = 'assistant_button_position'

export function AssistantPanel() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([])
  const [apiMessages, setApiMessages] = useState<unknown[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Posição do botão flutuante — arrastável e lembrada entre sessões
  // (guardada no navegador, não no banco — é só uma preferência visual
  // de tela, não precisa sincronizar entre dispositivos).
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const dragInfo = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setPosition(JSON.parse(saved))
    } catch {
      // sem problema se não conseguir ler — só usa a posição padrão
    }
  }, [])

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
    const newX = Math.min(Math.max(dragInfo.current.origX + dx, 8), window.innerWidth - 56)
    const newY = Math.min(Math.max(dragInfo.current.origY + dy, 8), window.innerHeight - 56)
    setPosition({ x: newX, y: newY })
  }

  function handleDragEnd() {
    document.removeEventListener('mousemove', handleDragMove)
    document.removeEventListener('mouseup', handleDragEnd)
    if (position) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(position))
      } catch {
        // se não conseguir salvar, só não lembra da próxima vez — sem problema
      }
    }
    // Se não moveu de verdade, foi um clique — abre/fecha o painel.
    if (dragInfo.current && !dragInfo.current.moved) {
      setOpen((v) => !v)
    }
    dragInfo.current = null
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [displayMessages, pendingAction])

  async function handleSend() {
    if (!input.trim() || busy) return
    const userText = input.trim()
    setInput('')
    setError(null)
    setDisplayMessages((prev) => [...prev, { role: 'user', text: userText }])
    setBusy(true)

    const newApiMessages = [...apiMessages, { role: 'user', content: userText }]

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newApiMessages }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Falha ao falar com o assistente.')
        setBusy(false)
        return
      }

      setApiMessages(data.messages)
      if (data.pendingAction) {
        setPendingAction(data.pendingAction)
      } else {
        setDisplayMessages((prev) => [...prev, { role: 'assistant', text: data.finalText || '(sem resposta)' }])
      }
    } catch {
      setError('Falha de conexão com o assistente.')
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmAction() {
    if (!pendingAction) return
    setBusy(true)
    setError(null)

    try {
      const res = await fetch('/api/assistant/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          toolUseId: pendingAction.toolUseId,
          toolName: pendingAction.toolName,
          toolInput: pendingAction.toolInput,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Falha ao executar a ação.')
        setBusy(false)
        return
      }

      setApiMessages(data.messages)
      setDisplayMessages((prev) => [...prev, { role: 'assistant', text: data.finalText }])
      setPendingAction(null)
      router.refresh()
    } catch {
      setError('Falha de conexão ao executar a ação.')
    } finally {
      setBusy(false)
    }
  }

  function handleCancelAction() {
    setPendingAction(null)
    setDisplayMessages((prev) => [...prev, { role: 'assistant', text: 'Ação cancelada.' }])
  }

  return (
    <>
      <button
        ref={buttonRef}
        onMouseDown={handleDragStart}
        style={
          position
            ? { position: 'fixed', left: position.x, top: position.y, right: 'auto', bottom: 'auto' }
            : { position: 'fixed', right: 20, bottom: 20 }
        }
        className="z-40 flex h-12 w-12 cursor-grab items-center justify-center rounded-full bg-brand-700 text-xl text-white shadow-lg hover:bg-brand-800 active:cursor-grabbing"
        title="Théo — clique pra abrir, arraste pra mover"
      >
        🤖
      </button>

      {open && (
        <div
          style={
            position
              ? { position: 'fixed', left: Math.min(position.x, window.innerWidth - 384 - 8), top: Math.max(position.y - 536, 8) }
              : { position: 'fixed', right: 12, bottom: 80 }
          }
          className="z-40 flex h-[min(520px,calc(100dvh-6rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col rounded-xl border border-gray-200 bg-white shadow-2xl"
        >
          <div className="flex items-center justify-between rounded-t-xl bg-brand-700 px-4 py-3">
            <p className="text-sm font-medium text-white">🤖 Théo</p>
            <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white">✕</button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {displayMessages.length === 0 && (
              <p className="mt-4 text-center text-xs text-gray-400">
                Pergunte algo como &ldquo;busque o contrato do cliente X&rdquo; ou &ldquo;crie uma nota no contrato X dizendo Y&rdquo;.
              </p>
            )}
            {displayMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-800'}`}>
                  {m.text}
                </div>
              </div>
            ))}

            {pendingAction && (
              <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm">
                <p className="font-medium text-yellow-900">Confirmar ação: {TOOL_LABELS[pendingAction.toolName] ?? pendingAction.toolName}</p>
                <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-yellow-800">{JSON.stringify(pendingAction.toolInput, null, 2)}</pre>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={handleConfirmAction}
                    disabled={busy}
                    className="rounded-md bg-positive-600 px-3 py-1 text-xs font-medium text-white hover:bg-positive-700 disabled:opacity-50"
                  >
                    {busy ? 'Executando...' : 'Confirmar'}
                  </button>
                  <button onClick={handleCancelAction} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>

          <div className="flex gap-2 border-t border-gray-200 p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              disabled={busy || !!pendingAction}
              placeholder="Digite um comando..."
              className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none disabled:bg-gray-100"
            />
            <button
              onClick={handleSend}
              disabled={busy || !!pendingAction}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {busy ? '...' : 'Enviar'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
