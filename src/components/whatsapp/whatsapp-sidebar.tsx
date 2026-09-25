'use client'

import { useState } from 'react'

export interface ConversationItem {
  phone: string
  name: string
  lastMessage: string
  lastMessageTime: string
  unreadCount?: number
  department?: string
  protocolNumber?: string
  triageState?: string
}

export function WhatsAppSidebar({
  conversations,
  selectedPhone,
  onSelectConversation,
}: {
  conversations: ConversationItem[]
  selectedPhone: string | null
  onSelectConversation: (phone: string) => void
}) {
  const [filterDept, setFilterDept] = useState<string>('all')

  const filtered = conversations.filter((c) => {
    if (filterDept === 'all') return true
    return c.department?.toLowerCase() === filterDept.toLowerCase()
  })

  return (
    <div className="flex h-full w-80 flex-col border-r border-gray-200 bg-white">
      {/* Filtro por Departamento */}
      <div className="border-b border-gray-200 p-3">
        <label className="block text-[11px] font-medium text-gray-500">Filtrar por Setor:</label>
        <select
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-brand-700 focus:outline-none"
        >
          <option value="all">Todos os setores</option>
          <option value="vendas">Vendas</option>
          <option value="financeiro">Financeiro</option>
          <option value="tecnico">Técnico</option>
        </select>
      </div>

      {/* Lista de Conversas */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
        {filtered.map((item) => {
          const isSelected = item.phone === selectedPhone
          return (
            <button
              key={item.phone}
              onClick={() => onSelectConversation(item.phone)}
              className={`w-full p-3 text-left transition-colors hover:bg-gray-50 ${
                isSelected ? 'bg-brand-50/60' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-900 truncate max-w-[140px]">
                  {item.name || item.phone}
                </p>
                <span className="text-[10px] text-gray-400">{item.lastMessageTime}</span>
              </div>

              <p className="mt-0.5 text-xs text-gray-500 truncate">{item.lastMessage}</p>

              {/* Badges de Setor e Protocolo */}
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                {item.department ? (
                  <span className="inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-medium text-brand-800">
                    {item.department.toUpperCase()}
                  </span>
                ) : item.triageState === 'awaiting_selection' ? (
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                    ⏳ Aguardando escolha
                  </span>
                ) : null}

                {item.protocolNumber && (
                  <span className="text-[10px] text-gray-400 font-mono">
                    #{item.protocolNumber}
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
