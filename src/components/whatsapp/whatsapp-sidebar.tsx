'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { searchWhatsAppConversations, type WhatsAppSearchHit } from '@/lib/actions/whatsapp-search'
import { ContactKindBadge } from './contact-kind-badge'

// Sem acento e minúsculo, para comparar textos
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const last8 = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-8)

// Foto do contato (WhatsApp), pedida só quando o item aparece na tela; guardada na sessão
const picCache = new Map<string, string | null>()
const picPending = new Map<string, Promise<string | null>>()
function loadPic(phone: string, instance?: string | null): Promise<string | null> {
  const k = last8(phone)
  if (picCache.has(k)) return Promise.resolve(picCache.get(k) ?? null)
  if (!picPending.has(k)) {
    picPending.set(k, fetch(`/api/whatsapp/profile-pic?phone=${encodeURIComponent(phone)}${instance ? `&instance=${encodeURIComponent(instance)}` : ''}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { url: null })).then(d => (typeof d?.url === 'string' ? d.url : null)).catch(() => null)
      .then(url => { picCache.set(k, url); picPending.delete(k); return url }))
  }
  return picPending.get(k)!
}

export function ContactAvatar({ phone, name, instance, size = 40 }: { phone: string; name: string; instance?: string | null; size?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [url, setUrl] = useState<string | null>(() => picCache.get(last8(phone)) ?? null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let alive = true
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      io.disconnect()
      void loadPic(phone, instance).then(u => { if (alive) setUrl(u) })
    }, { rootMargin: '120px' })
    io.observe(el)
    return () => { alive = false; io.disconnect() }
  }, [phone, instance])
  const initial = (name || phone || '?').trim().charAt(0).toUpperCase()
  return (
    <span ref={ref} className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 text-sm font-semibold text-gray-500"
      style={{ width: size, height: size }} aria-hidden="true">
      {url && failedUrl !== url
        ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
        : initial}
    </span>
  )
}

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
  const [filterKind, setFilterKind] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<WhatsAppSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const reqId = useRef(0)

  // Busca em todo o histórico (a lista ao lado traz só as conversas recentes)
  useEffect(() => {
    const term = query.trim()
    if (term.length < 3) { setHits([]); setSearching(false); return }
    const id = ++reqId.current
    setSearching(true)
    const t = setTimeout(async () => {
      const r = await searchWhatsAppConversations(term)
      if (id !== reqId.current) return
      setHits(r.ok ? r.hits : [])
      setSearching(false)
    }, 350)
    return () => clearTimeout(t)
  }, [query])

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

  const q = norm(query.trim())
  const qDigits = query.replace(/\D/g, '')
  const matches = (item: any) => {
    if (!q) return true
    const latest = item.latest ?? item
    const fields = [item.contact_name, item.name, item.linked_label, latest.unlinked_sender_name, item.last_message, item.lastMessage, latest.message,
      item.department ?? item.triage_department, item.protocol_number ?? item.protocolNumber]
    if (fields.some(f => norm(f).includes(q))) return true
    return qDigits.length >= 3 && String(item.phone ?? '').replace(/\D/g, '').includes(qDigits)
  }
  const filteredList = list.filter((item) => {
    if (!matches(item)) return false
    if (filterKind !== 'all' && (item.kind ?? 'visitante') !== filterKind) return false
    if (filterDept === 'all') return true
    const dept = item.department ?? item.triage_department
    return dept?.toLowerCase() === filterDept.toLowerCase()
  })
  const openCount = q ? open.filter(matches).length : open.length
  const archivedCount = q ? archived.filter(matches).length : archived.length

  // Resultados do histórico que não estão na lista carregada
  const loadedKeys = new Set([...open, ...archived].map((i: any) => `${i.instance ?? i.instance_name ?? i.latest?.instance_name ?? ''}-${last8(i.phone)}`))
  const extraHits = hits.filter(h => !loadedKeys.has(`${h.instance}-${last8(h.phone)}`))
  const MATCH_LABEL: Record<WhatsAppSearchHit['matchedBy'], string> = { nome: 'nome', cliente: 'cliente', telefone: 'telefone', mensagem: 'mensagem' }

  function handleSelect(phone: string, instance?: string) {
    if (onSelectConv) {
      onSelectConv(phone, instance ?? '')
    } else if (onSelectConversation) {
      onSelectConversation(phone)
    }
  }

  return (
    // w-full em vez de w-80 — a largura é imposta pela coluna do Grid no client-shell
    <div className="flex h-full w-full flex-col bg-white">
      {/* Pesquisar conversas */}
      <div className="border-b border-gray-200 p-2.5">
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">🔍</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar nome, telefone, protocolo ou mensagem"
            aria-label="Pesquisar conversas"
            className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-7 text-xs focus:border-brand-700 focus:outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Limpar pesquisa"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-xs text-gray-400 hover:text-gray-700">✕</button>
          )}
        </div>
      </div>

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
          Em aberto ({openCount})
        </button>
        <button
          onClick={() => setTab('archived')}
          className={`flex-1 py-2.5 text-xs font-medium ${
            tab === 'archived'
              ? 'border-b-2 border-brand-700 text-brand-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Arquivados ({archivedCount})
        </button>
      </div>

      {/* Filtros: tipo do contato e setor */}
      <div className="grid grid-cols-2 gap-2 border-b border-gray-200 p-2.5 bg-gray-50/50">
        <label className="block min-w-0">
          <span className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Tipo:</span>
          <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs focus:border-brand-700 focus:outline-none">
            <option value="all">Todos</option>
            <option value="cliente">Clientes</option>
            <option value="lead">Leads</option>
            <option value="visitante">Visitantes</option>
          </select>
        </label>
        <label className="block min-w-0">
        <span className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Setor:</span>
        <select
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs focus:border-brand-700 focus:outline-none"
        >
          <option value="all">Todos</option>
          {uniqueDepts.map((dept) => (
            <option key={dept} value={dept}>
              {dept.charAt(0).toUpperCase() + dept.slice(1)}
            </option>
          ))}
        </select>
        </label>
      </div>

      {/* Lista de Conversas */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
        {filteredList.length === 0 && (
          <p className="p-4 text-center text-xs text-gray-400">
            {q ? 'Nenhuma conversa desta aba com esse termo.' : tab === 'archived' ? 'Nenhuma conversa arquivada.' : 'Nenhuma conversa em aberto.'}
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
          // Não lidas (a conversa aberta conta como lida)
          const unread = isSelected ? 0 : Number(item.unread ?? 0)

          return (
            <button
              key={`${item.phone}-${instanceKey || 'default'}`}
              onClick={() => handleSelect(item.phone, instanceKey)}
              className={`flex w-full gap-2.5 p-3 text-left transition-colors hover:bg-gray-50 ${
                isSelected ? 'bg-brand-50/60' : ''
              }`}
            >
              <ContactAvatar phone={item.phone} name={String(displayName ?? '')} instance={instanceKey || null} />
              <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className={`text-xs font-semibold truncate min-w-0 ${isArchived ? 'text-gray-500' : 'text-gray-900'}`}>
                  {isArchived && <span className="mr-1 text-gray-400">🔒</span>}
                  {displayName}
                </p>
                <span className={`text-[10px] shrink-0 ${unread ? 'font-semibold text-positive-600' : 'text-gray-400'}`}>{lastTime}</span>
              </div>

              {item.linked_label && (
                <p className="mt-0.5 truncate text-[11px] font-medium text-brand-700">🔗 {item.linked_label}</p>
              )}
              <div className="mt-0.5 flex items-center gap-2">
                <p className={`min-w-0 flex-1 truncate text-xs ${unread ? 'font-medium text-gray-800' : 'text-gray-500'}`}>
                  {lastMsg}
                </p>
                {unread > 0 && (
                  <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-positive-600 px-1 text-[10px] font-bold text-white"
                    aria-label={`${unread} mensagem(ns) não lida(s)`}>
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </div>

              {/* Badges de Setor, Protocolo e Estado da Triagem */}
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                {item.kind && <ContactKindBadge kind={item.kind} manual={item.kind_manual} />}
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
              </div>
            </button>
          )
        })}

        {query.trim().length >= 3 && (
          <div className="bg-gray-50/60">
            <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Em todo o histórico {searching ? '· buscando…' : `(${extraHits.length})`}
            </p>
            {!searching && extraHits.length === 0 && (
              <p className="px-3 pb-3 text-[11px] text-gray-400">Nada além do que já aparece acima.</p>
            )}
            {extraHits.map(h => (
              <button
                key={`${h.instance}-${h.phone}`}
                onClick={() => handleSelect(h.phone, h.instance)}
                className="w-full border-t border-gray-100 p-3 text-left transition-colors hover:bg-white"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-semibold text-gray-900">
                    {h.archived && <span className="mr-1 text-gray-400">🔒</span>}
                    {h.name || h.phone}
                  </p>
                  <span className="shrink-0 text-[10px] text-gray-400">{new Date(h.createdAt).toLocaleDateString('pt-BR')}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-500">{h.snippet || 'Sem texto'}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] text-brand-700">achado por {MATCH_LABEL[h.matchedBy]}</span>
                  {h.department && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{h.department.toUpperCase()}</span>}
                  {h.protocol_number && <span className="font-mono text-[10px] text-gray-400">#{h.protocol_number}</span>}
                  {h.archived && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">Arquivado</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
