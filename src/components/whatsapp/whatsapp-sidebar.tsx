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
        {filteredList.map((item) => {
          const isSelected = item.phone === selectedPhone
          const dept = item.department ?? item.triage_department
          const protocol = item.protocol_number ?? item.protocolNumber
          const state = item.triage_state

          return (
            <button
              key={`${item.phone}-${item.instance_name ?? 'default'}`}
              onClick={() => handleSelect(item.phone, item.instance_name ?? '')}
              className={`w-full p-3 text-left transition-colors hover:bg-gray-50 ${
                isSelected ? 'bg-brand-50/60' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-900 truncate max-w-[140px]">
                  {item.contact_name || item.name || item.phone}
                </p>
                <span className="text-[10px] text-gray-400">
                  {item.last_message_time || item.lastMessageTime || ''}
                </span>
              </div>

              <p className="mt-0.5 text-xs text-gray-500 truncate">
                {item.last_message || item.lastMessage || 'Sem mensagens'}
              </p>

              {/* Badges de Setor e Protocolo */}
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                {dept ? (
                  <span className="inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-medium text-brand-800">
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
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
