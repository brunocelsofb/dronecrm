'use client'
// Perfil de um fornecedor pelo CNPJ (concorrente ou a própria empresa): contratos assinados no PNCP,
// quanto somam, em que estados e com quais órgãos.

import { useEffect, useState } from 'react'
import { X, ExternalLink, Bookmark } from 'lucide-react'
import { fmtBRL } from '@/lib/format'
import { getSupplierProfile, saveCompetitor } from '@/lib/actions/licitacoes'
import type { SupplierContract } from '@/lib/pncp/results'

type Summary = { contratos: number; valor: number; nome: string | null; ufs: { uf: string; n: number; valor: number }[]; orgaos: { nome: string; uf: string | null; n: number; valor: number }[] }

export function fmtCnpjView(v: string) {
  const d = v.replace(/\D/g, '')
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : v
}

export function SupplierProfileBody({ cnpj, name, canSave, onSaved }: { cnpj: string; name?: string | null; canSave?: boolean; onSaved?: () => void }) {
  const [s, setS] = useState<Summary | null>(null)
  const [items, setItems] = useState<SupplierContract[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    getSupplierProfile(cnpj).then(r => {
      if (!alive) return
      if (r.ok) { setS(r.summary); setItems(r.items) } else setErr(r.error)
    })
    return () => { alive = false }
  }, [cnpj])

  const title = s?.nome ?? name ?? fmtCnpjView(cnpj)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-xs text-gray-500">CNPJ {fmtCnpjView(cnpj)}</p>
        </div>
        {canSave && (
          <button type="button" onClick={async () => { const r = await saveCompetitor({ cnpj, name: title }); setSaved(r.ok ? 'Guardado nos concorrentes.' : (r.error ?? 'Não foi possível.')); if (r.ok) onSaved?.() }}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"><Bookmark className="h-3.5 w-3.5" />Acompanhar este concorrente</button>
        )}
      </div>
      {saved && <p role="status" className="text-xs text-positive-700">{saved}</p>}
      {!s && !err && <p className="text-sm text-gray-500">Buscando os contratos no PNCP…</p>}
      {err && <p className="text-sm text-negative-700">{err}</p>}
      {s && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-gray-200 p-3"><p className="text-[11px] text-gray-500">Contratos no PNCP</p><p className="text-lg font-semibold text-gray-900">{s.contratos.toLocaleString('pt-BR')}</p></div>
            <div className="rounded-xl border border-gray-200 p-3"><p className="text-[11px] text-gray-500">Valor somado</p><p className="text-lg font-semibold text-gray-900">{fmtBRL(s.valor)}</p></div>
          </div>
          {s.contratos === 0 && <p className="text-xs text-gray-500">Nenhum contrato deste CNPJ publicado no PNCP.</p>}
          {s.ufs.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-700">Onde ganha</p>
              <div className="flex flex-wrap gap-1.5">{s.ufs.map(u => <span key={u.uf} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">{u.uf} · {u.n} · {fmtBRL(u.valor)}</span>)}</div>
            </div>
          )}
          {s.orgaos.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-700">Principais órgãos</p>
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 text-xs">
                {s.orgaos.map(o => <li key={o.nome} className="flex justify-between gap-2 px-3 py-1.5"><span className="min-w-0 truncate text-gray-800">{o.nome}{o.uf ? ` / ${o.uf}` : ''}</span><span className="shrink-0 text-gray-600">{o.n} · {fmtBRL(o.valor)}</span></li>)}
              </ul>
            </div>
          )}
          {items.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-700">Contratos mais recentes</p>
              <ul className="space-y-1.5">
                {items.slice(0, 30).map((c, i) => (
                  <li key={`${c.numero_controle ?? i}`} className="rounded-lg border border-gray-100 px-3 py-2 text-xs">
                    <p className="font-medium text-gray-800">{c.orgao_nome ?? '—'}{c.uf ? ` / ${c.uf}` : ''} · {fmtBRL(c.valor)}</p>
                    <p className="line-clamp-2 text-gray-600">{c.objeto ?? c.titulo}</p>
                    <p className="text-gray-400">
                      {c.assinatura ? `assinado em ${new Date(c.assinatura).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}
                      {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-brand-700 hover:underline"><ExternalLink className="h-3 w-3" />PNCP</a>}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-gray-400">Fonte: contratos publicados no PNCP. Participações sem vitória não são publicadas pelo PNCP.</p>
        </>
      )}
    </div>
  )
}

export function SupplierDrawer({ cnpj, name, onClose }: { cnpj: string; name?: string | null; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label="Perfil do fornecedor" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex justify-end"><button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button></div>
        <SupplierProfileBody cnpj={cnpj} name={name} canSave />
      </div>
    </div>
  )
}
