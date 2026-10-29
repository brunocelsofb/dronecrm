'use client'

// Formulários de cadastro do Meta (Lead Ads): cada lead preenchido no Facebook/Instagram entra
// direto em Leads inbound. Formulário novo já vem ligado; aqui dá para desligar e escolher a campanha.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { refreshMetaFormsNow, updateMetaForm } from '@/lib/actions/ads-meta'
import type { MetaFormInfo, MetaPageInfo } from '@/lib/ads/meta-data'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const EV: Record<string, string> = { criado: 'lead criado', duplicado: 'já existia (nova conversão no histórico)', ignorado: 'formulário desligado', erro: 'erro', recebido: 'recebido' }

export function MetaLeadForms({ pages, forms, recent, campaigns, readOnly }: {
  pages: MetaPageInfo[]; forms: MetaFormInfo[]; recent: { created_at: string; status: string; error: string | null; form_id: string | null }[]
  campaigns: { id: string; name: string }[]; readOnly: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(key); setMsg(null)
    const r = await fn()
    setBusy(null)
    setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? 'Falhou.' })
    if (r.ok) router.refresh()
  }
  const pageName = (id: string) => pages.find(p => p.page_id === id)?.name ?? id
  const formName = (id: string | null) => forms.find(f => f.form_id === id)?.name ?? id ?? ''
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Formulários de cadastro (Lead Ads)</h2>
          <p className="text-xs text-gray-600">Quem preenche o formulário do anúncio no Facebook ou Instagram entra direto em Leads inbound, na hora.</p>
        </div>
        {!readOnly && <button type="button" disabled={!!busy} onClick={() => run('forms', refreshMetaFormsNow, 'Formulários atualizados.')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">{busy === 'forms' ? 'Atualizando…' : 'Atualizar formulários'}</button>}
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}</p>}
      {pages.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhuma página do Facebook autorizada. Clique em Reconectar e, na tela do Facebook, marque a página da empresa.</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2 text-xs">
            {pages.map(p => (
              <li key={p.page_id} className={`rounded-full px-2.5 py-1 ${p.subscribed ? 'bg-positive-100 text-positive-700' : 'bg-warn-100 text-warn-700'}`} title={p.last_error ?? ''}>
                {p.name} · {p.subscribed ? 'recebendo leads' : 'não ligada (reconecte)'}
              </li>
            ))}
          </ul>
          {forms.length === 0 ? <p className="text-sm text-gray-500">Nenhum formulário nestas páginas ainda. Crie o formulário no anúncio e clique em Atualizar formulários (formulário novo também entra sozinho no primeiro lead).</p> : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
              {forms.map(f => (
                <li key={f.form_id} className="flex flex-wrap items-center gap-3 p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={f.active} disabled={readOnly || !!busy} onChange={e => run(f.form_id, () => updateMetaForm(f.form_id, { active: e.target.checked }), e.target.checked ? 'Formulário ligado.' : 'Formulário desligado.')} />
                    <span className="sr-only">Receber leads deste formulário</span>
                  </label>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{f.name || f.form_id}</p>
                    <p className="text-xs text-gray-500">{pageName(f.page_id)}{f.status && f.status !== 'ACTIVE' ? ` · ${f.status.toLowerCase()}` : ''} · {f.leads_count} lead(s) · último {when(f.last_lead_at)}</p>
                  </div>
                  <select aria-label={`Campanha para ${f.name}`} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm sm:w-60" value={f.campaign_id ?? ''} disabled={readOnly || !!busy}
                    onChange={e => run(f.form_id, () => updateMetaForm(f.form_id, { campaignId: e.target.value || null }), 'Campanha salva.')}>
                    <option value="">Campanha: pelo anúncio (automático)</option>
                    {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-gray-500">Campanha: se a campanha do anúncio estiver ligada a uma campanha do Marketing (lista acima), o lead vai para ela; senão, para a escolhida aqui. Mesmo e-mail com lead aberto não duplica: vira nova conversão no histórico.</p>
          {recent.length > 0 && (
            <details className="text-xs text-gray-600">
              <summary className="cursor-pointer">Últimos recebidos</summary>
              <ul className="mt-1 space-y-0.5">{recent.map((r, i) => <li key={i}>{when(r.created_at)} · {formName(r.form_id)} · {EV[r.status] ?? r.status}{r.error ? `: ${r.error}` : ''}</li>)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  )
}
