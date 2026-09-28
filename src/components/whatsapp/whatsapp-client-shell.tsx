'use client'

import { useState, useEffect, useTransition, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { WhatsAppSidebar } from './whatsapp-sidebar'
import { WhatsAppConversationPanel } from './whatsapp-conversation-panel'
import { WhatsAppInboxRealtimeWatcher } from './whatsapp-inbox-realtime-watcher'
import { NewConversationModal } from './new-conversation-modal'

type Profile = { id: string; full_name: string; job_title?: string | null }

const SIDEBAR_MIN = 220
const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 280

function ConvSkeleton() {
  return (
    <div className="flex flex-col h-full animate-pulse p-4 gap-3 bg-white">
      <div className="shrink-0 h-16 rounded-lg bg-gray-100" />
      <div className="flex-1 bg-[#e5ddd5] rounded-lg p-4 space-y-3">
        {[75, 55, 80, 45].map((w, i) => (
          <div key={i} className={`flex ${i % 2 ? 'justify-end' : ''}`}>
            <div className="h-10 rounded-lg bg-white/60" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
      <div className="shrink-0 h-12 rounded-lg bg-gray-100" />
    </div>
  )
}

export function WhatsAppClientShell({
  open, archived, initialPhone, initialInstance, currentUserId, teamUsers, instanceAliases,
}: {
  open: any[]; archived: any[]
  initialPhone: string | null; initialInstance?: string | null
  currentUserId: string; teamUsers: Profile[]; instanceAliases: Record<string, any>
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [selectedPhone, setSelectedPhone] = useState(initialPhone)
  const [selectedInstance, setSelectedInstance] = useState(initialInstance ?? null)
  const [convData, setConvData] = useState<any>(null)
  const [loadingConv, setLoadingConv] = useState(false)
  const [showNewConv, setShowNewConv] = useState(false)

  // ── Splitter ──────────────────────────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(SIDEBAR_DEFAULT)

  const onDraggerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartWidth.current = sidebarWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [sidebarWidth])

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return
      const delta = e.clientX - dragStartX.current
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, dragStartWidth.current + delta))
      setSidebarWidth(next)
    }
    function onMouseUp() {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedPhone) { setConvData(null); return }
    setLoadingConv(true)
    setConvData(null)
    const params = new URLSearchParams({ phone: selectedPhone })
    if (selectedInstance) params.set('instance', selectedInstance)
    fetch(`/api/whatsapp/conversation?${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setConvData(d); setLoadingConv(false) })
      .catch(() => setLoadingConv(false))
  }, [selectedPhone, selectedInstance])

  function handleSelectConv(phone: string, instance: string) {
    setSelectedPhone(phone)
    setSelectedInstance(instance)
    startTransition(() => {
      router.push(
        `/whatsapp?phone=${encodeURIComponent(phone)}&instance=${encodeURIComponent(instance)}`,
        { scroll: false } as any
      )
    })
  }

  function handleArchived() {
    setSelectedPhone(null)
    setSelectedInstance(null)
    setConvData(null)
    router.push('/whatsapp')
    router.refresh()
  }

  const isArchived = archived.some(
    (c: any) => c.phone === selectedPhone && (c.instance ?? '') === (selectedInstance ?? '')
  )

  return (
    <div
      className="grid w-full h-full min-h-0 bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm"
      style={{ gridTemplateColumns: `${sidebarWidth}px 4px 1fr` }}
    >
      <WhatsAppInboxRealtimeWatcher />

      {/* Sidebar — largura imposta pela 1ª coluna do Grid */}
      <div className="flex flex-col min-h-0 min-w-0 border-r border-gray-200 bg-white shrink-0 overflow-hidden">
        <div className="p-2 shrink-0 border-b border-gray-100 min-w-0">
          <button
            onClick={() => setShowNewConv(true)}
            title="Nova Conversa"
            className="w-[220px] mx-auto rounded-lg bg-[#1B556B] py-2 px-2 text-sm font-semibold text-white hover:bg-[#164659] flex items-center justify-center gap-1.5 transition-colors shrink-0 shadow-sm"
          >
            ✏️ Nova Conversa
          </button>
        </div>

        {/* Lista de contatos: sem barra horizontal, com respiro no fim */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden pb-20 min-w-0">
          <WhatsAppSidebar
            open={open}
            archived={archived}
            selectedPhone={selectedPhone}
            selectedInstance={selectedInstance}
            assignments={{}}
            currentUserId={currentUserId}
            instanceAliases={instanceAliases}
            onSelectConv={handleSelectConv}
          />
        </div>
      </div>

      {/* Dragger — ocupa a 2ª coluna do Grid (4px fixos) */}
      <div
        onMouseDown={onDraggerMouseDown}
        className="w-full h-full bg-gray-200 hover:bg-[#1B556B]/40 active:bg-[#1B556B]/60 cursor-col-resize transition-colors duration-150 select-none z-10 shrink-0"
        title="Arraste para redimensionar"
      />

      {/* Painel de chat — ocupa o resto */}
      <div className="flex flex-col min-w-0 min-h-0 bg-white relative flex-1">
        {selectedPhone ? (
          loadingConv ? <ConvSkeleton /> : convData ? (
            <WhatsAppConversationPanel
              phone={selectedPhone}
              displayName={convData.displayName ?? null}
              leadId={convData.leadId ?? null}
              messages={convData.messages ?? []}
              searchContracts={async () => []}
              currentUserId={currentUserId}
              users={teamUsers}
              assignment={convData.assignment ?? null}
              instanceName={selectedInstance ?? convData.instanceName ?? null}
              initialIsArchived={isArchived}
              onArchiveSuccess={handleArchived}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
              Erro ao carregar. Tente novamente.
            </div>
          )
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400 bg-gray-50">
            Selecione uma conversa à esquerda para começar.
          </div>
        )}
      </div>

      {showNewConv && (
        <NewConversationModal onClose={() => { setShowNewConv(false); router.refresh() }} />
      )}
    </div>
  )
}
