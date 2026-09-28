'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { WhatsAppSidebar } from './whatsapp-sidebar'
import { WhatsAppConversationPanel } from './whatsapp-conversation-panel'
import { WhatsAppInboxRealtimeWatcher } from './whatsapp-inbox-realtime-watcher'
import { NewConversationModal } from './new-conversation-modal'

type Profile = { id: string; full_name: string; job_title?: string | null }

function ConvSkeleton() {
  return (
    <div className="flex flex-col h-full animate-pulse p-4 gap-3">
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
    // CORRECÇÃO PRINCIPAL: overflow-hidden impede o chat de vazar sobre a sidebar
    <div className="flex flex-1 min-h-0 overflow-hidden gap-3">
      <WhatsAppInboxRealtimeWatcher />

      {/* Sidebar — largura fixa, não encolhe, não cresce */}
      <div className="w-72 shrink-0 flex flex-col min-h-0 border-r border-gray-100 pr-2">
        <button onClick={() => setShowNewConv(true)}
          className="mb-2 shrink-0 w-full rounded-lg bg-[#1B556B] py-2 text-sm font-semibold text-white hover:bg-[#164659] flex items-center justify-center gap-1.5">
          ✏️ Nova Conversa
        </button>
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

      {/* Painel de chat — ocupa o restante, min-w-0 impede overflow horizontal */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
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
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            Selecione uma conversa à esquerda.
          </div>
        )}
      </div>
      {showNewConv && <NewConversationModal onClose={() => { setShowNewConv(false); router.refresh() }} />}
    </div>
  )
}
