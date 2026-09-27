'use client'

import { useState, useMemo } from 'react'

export interface WhatsAppSidebarProps {
  open?: any[]
  archived?: any[]
  selectedPhone: string | null
  selectedInstance?: string | null
  assignments?: Record<string, string>
  currentUserId?: string
  instanceAliases?: Record<string, any>
  onSelectConv?: (phone: string, instance: string) => void
  onSelectConversation?: (phone: string) => void
}

export function WhatsAppSidebar({
  open = [],
  archived = [],
  selectedPhone,
  selectedInstance,
  onSelectConv,
  onSelectConversation,
}: WhatsAppSidebarProps) {
  const [tab, setTab] = useState<'open' | 'archived'>('open')
  const [filterDept, setFilterDept] = useState<string>('all')

  const list = tab === 'open' ? open : archived

  // Gera dinamicamente os setores únicos presentes em TODAS as conversas (abertas + arquivadas)
  const uniqueDepts = useMemo(() => {
    const all = [...open, ...archived]
    const depts = new Set<string>()
    for (const item of all) {
      const dept = item.department ?? item.triage_department
      if (dept && dept.trim()) depts.add(dept.trim())
    }
    return Array.from(depts).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [open, archived])

  const filteredList = list.filter((item) => {
    if (filterDept === 'all') return true
    const dept = item.department ?? item.triage_department
    return dept?.toLowerCase() === filterDept.toLowerCase()
  })

  function handleSelect(phone: string, instance?: string) {
    if (onSelectConv) {
      onSelectConv(phone, instance ?? '')
    } else if (onSelectConversation) {
      onSelectConversation(phone)
    }
  }

  return (
    <div className="flex h-full w-80 flex-col border-r border-gray-200 bg-white">
      {/* Abas Em Aberto / Arquivados */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setTab('open')}
          className={`flex-1 py-2.5 text-xs font-medium ${
            tab === 'open'
              ? 'border-b-2 border-brand-700 text-brand-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Em aberto ({open.length})
        </button>
        <button
          onClick={() => setTab('archived')}
          className={`flex-1 py-2.5 text-xs font-medium ${
            tab === 'archived'
              ? 'border-b-2 border-brand-700 text-brand-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Arquivados ({archived.length})
        </button>
      </div>

      {/* Filtro por Setor — opções geradas dinamicamente */}
      <div className="border-b border-gray-200 p-2.5 bg-gray-50/50">
        <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Filtrar Setor:</label>
        <select
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs focus:border-brand-700 focus:outline-none"
        >
          <option value="all">Todos os setores</option>
          {uniqueDepts.map((dept) => (
            <option key={dept} value={dept}>
              {dept.charAt(0).toUpperCase() + dept.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Lista de Conversas */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
        {filteredList.length === 0 && (
          <p className="p-4 text-center text-xs text-gray-400">
            {tab === 'archived' ? 'Nenhuma conversa arquivada.' : 'Nenhuma conversa em aberto.'}
          </p>
        )}
        {filteredList.map((item) => {
          // Suporta tanto objetos flat (antigo) quanto objetos com `latest` (novo page.tsx)
          const latest = item.latest ?? item
          const displayName = item.contact_name
            || item.name
            || latest.unlinked_sender_name
            || item.phone

          const lastMsg = item.last_message
            || item.lastMessage
            || latest.message
            || 'Sem mensagens'

          const lastTime = item.last_message_time
            || item.lastMessageTime
            || (latest.created_at
              ? new Date(latest.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              : '')

          const instanceKey = item.instance ?? item.instance_name ?? latest.instance_name ?? ''
          const isSelected = item.phone === selectedPhone && instanceKey === (selectedInstance ?? '')
          const dept = item.department ?? item.triage_department
          const protocol = item.protocol_number ?? item.protocolNumber
          const state = item.triage_state
          const isArchived = tab === 'archived'

          return (
            <button
              key={`${item.phone}-${instanceKey || 'default'}`}
              onClick={() => handleSelect(item.phone, instanceKey)}
              className={`w-full p-3 text-left transition-colors hover:bg-gray-50 ${
                isSelected ? 'bg-brand-50/60' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <p className={`text-xs font-semibold truncate max-w-[140px] ${isArchived ? 'text-gray-500' : 'text-gray-900'}`}>
                  {isArchived && <span className="mr-1 text-gray-400">🔒</span>}
                  {displayName}
                </p>
                <span className="text-[10px] text-gray-400">{lastTime}</span>
              </div>

              <p className="mt-0.5 text-xs text-gray-500 truncate">
                {lastMsg}
              </p>

              {/* Badges de Setor, Protocolo e Estado da Triagem */}
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                {dept ? (
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    isArchived
                      ? 'bg-gray-100 text-gray-600'
                      : 'bg-brand-100 text-brand-800'
                  }`}>
                    {dept.toUpperCase()}
                  </span>
                ) : state === 'awaiting_selection' ? (
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                    ⏳ Aguardando escolha
                  </span>
                ) : null}

                {protocol && (
                  <span className="text-[10px] text-gray-400 font-mono">
                    #{protocol}
                  </span>
                )}

                {isArchived && (
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
                    Arquivado
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
