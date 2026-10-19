'use client'

import { useState, useTransition } from 'react'
import { setContactKind } from '@/lib/actions/whatsapp-kind'
import type { ContactKind } from '@/lib/whatsapp/contact-kind'

export const KIND_LABEL: Record<ContactKind, string> = { cliente: 'Cliente', lead: 'Lead', visitante: 'Visitante' }
const KIND_STYLE: Record<ContactKind, string> = {
  cliente: 'bg-positive-100 text-positive-700',
  lead: 'bg-[#83D0F5]/30 text-brand-800',
  visitante: 'bg-gray-100 text-gray-600',
}

export function ContactKindBadge({ kind, manual }: { kind: ContactKind; manual?: boolean }) {
  return (
    <span title={manual ? 'Marcado manualmente' : 'Automático (contrato ativo, lead aberto ou nenhum)'}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${KIND_STYLE[kind]}`}>
      {KIND_LABEL[kind]}{manual ? ' ✎' : ''}
    </span>
  )
}

// No topo da conversa: mostra o selo e permite corrigir (ou voltar ao automático)
export function ContactKindPicker({ phone, kind, manual, onChange }: {
  phone: string; kind: ContactKind; manual: boolean; onChange?: (kind: ContactKind, manual: boolean) => void
}) {
  const [cur, setCur] = useState({ kind, manual })
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function change(v: string) {
    setErr(null)
    start(async () => {
      const r = await setContactKind(phone, v === 'auto' ? null : (v as ContactKind))
      if (!r.ok) { setErr(r.error); return }
      setCur(r.info)
      onChange?.(r.info.kind, r.info.manual)
    })
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select
        aria-label="Tipo do contato"
        title={cur.manual ? 'Marcado manualmente — escolha "Automático" para voltar' : 'Automático — escolha para corrigir'}
        value={cur.manual ? cur.kind : 'auto'}
        disabled={pending}
        onChange={e => change(e.target.value)}
        className={`rounded-full border-0 px-2 py-0.5 text-[10px] font-medium focus:outline-none ${KIND_STYLE[cur.kind]}`}
      >
        <option value="auto">{KIND_LABEL[cur.kind]} (automático)</option>
        <option value="cliente">Cliente</option>
        <option value="lead">Lead</option>
        <option value="visitante">Visitante</option>
      </select>
      {err && <span className="text-[10px] text-negative-700">{err}</span>}
    </span>
  )
}
