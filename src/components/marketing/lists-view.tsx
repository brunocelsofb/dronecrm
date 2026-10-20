'use client'

// Marketing → Listas: quem recebe e-mail marketing. O CRM monta a lista
// (leads e/ou clientes, com filtros), tira descadastrados e e-mails inválidos
// e envia ao Mailchimp ou ao RD Station, que fazem o disparo.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveList, deleteList, previewList, startSync, runSyncBatch, addOptout, removeOptout } from '@/lib/actions/marketing-lists'
import { readFilters, type ListFilters } from '@/lib/marketing/segments'
import { CHANNELS } from '@/lib/marketing/tracking'
import type { ToolsStatus } from './tool-connect'

export type ListRow = { id: string; name: string; audience: string; filters: unknown; updated_at: string }
export type SyncRow = { id: string; list_id: string; provider: string; target: string | null; status: string; total: number; sent: number; failed: number; errors: string | null; started_at: string }
export type OptoutRow = { id: string; email: string; source: string | null; created_at: string }

const AUD: Record<string, string> = { leads: 'Leads', clientes: 'Clientes (carteira)', ambos: 'Leads e clientes', inativos: 'Clientes inativos (reativação)' }
const LEAD_STATUS: [string, string][] = [['novo', 'Novo'], ['em_qualificacao', 'Em qualificação'], ['qualificado', 'Qualificado'], ['convertido', 'Convertido'], ['descartado', 'Descartado']]
const PROVIDER: Record<string, string> = { mailchimp: 'Mailchimp', rd_station: 'RD Station' }
const br = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

type Props = {
  lists: ListRow[]; syncs: SyncRow[]; optouts: { count: number; recent: OptoutRow[] }
  tools: ToolsStatus; options: { segments: string[]; ufs: string[]; tags: { id: string; name: string }[]; companySegments: string[] }
  campaigns: { id: string; name: string; status: string }[]
  isAdmin: boolean
}

export function ListsView(p: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<{ id: string | null; name: string; audience: string; filters: ListFilters } | null>(null)
  const [preview, setPreview] = useState<{ total: number; sample: { email: string; name: string; company: string | null; kind: string }[]; excludedOptout: number; excludedInvalid: number } | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [progress, setProgress] = useState<{ listId: string; provider: string; done: number; total: number; failed: number } | null>(null)
  const [optEmail, setOptEmail] = useState('')

  const mcReady = !!p.tools.mailchimp?.list_id
  const rdReady = !!p.tools.rd_station

  const open = (l?: ListRow) => {
    setMsg(null); setPreview(null)
    setEditing(l ? { id: l.id, name: l.name, audience: l.audience, filters: readFilters(l.filters) } : { id: null, name: '', audience: 'leads', filters: readFilters({}) })
  }
  const setF = (patch: Partial<ListFilters>) => setEditing(e => (e ? { ...e, filters: { ...e.filters, ...patch } } : e))
  const toggle = (k: 'lead_status' | 'campaign_ids' | 'channels' | 'segments' | 'ufs' | 'tag_ids', v: string) => setEditing(e => {
    if (!e) return e
    const cur = e.filters[k] ?? []
    return { ...e, filters: { ...e.filters, [k]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] } }
  })

  const doPreview = () => editing && start(async () => {
    const r = await previewList({ audience: editing.audience, filters: editing.filters })
    if (r.ok) setPreview(r); else setMsg({ ok: false, text: r.error })
  })
  const doSave = () => editing && start(async () => {
    const r = await saveList({ id: editing.id, name: editing.name, audience: editing.audience, filters: editing.filters })
    if (r.ok) { setMsg({ ok: true, text: 'Lista salva.' }); setEditing(null); setPreview(null); router.refresh() } else setMsg({ ok: false, text: r.error })
  })

  async function send(listId: string, provider: 'mailchimp' | 'rd_station') {
    setMsg(null)
    const s = await startSync(listId, provider)
    if (!s.ok) { setMsg({ ok: false, text: s.error }); return }
    let offset = 0
    setProgress({ listId, provider, done: 0, total: s.total, failed: 0 })
    for (let guard = 0; guard < 2000; guard++) {
      const r = await runSyncBatch(s.syncId, offset)
      if (!r.ok) { setMsg({ ok: false, text: r.error }); break }
      setProgress({ listId, provider, done: r.sent + r.failed, total: s.total, failed: r.failed })
      if (r.done) {
        setMsg(r.failed ? { ok: r.sent > 0, text: `${r.sent} enviado(s), ${r.failed} com problema${r.lastError ? `: ${r.lastError}` : ''}.` } : { ok: true, text: `${r.sent} contato(s) enviado(s) ao ${PROVIDER[provider]}.` })
        break
      }
      offset = r.next
    }
    setProgress(null)
    router.refresh()
  }

  const lastSync = (listId: string, provider: string) => p.syncs.find(s => s.list_id === listId && s.provider === provider) ?? null
  const summary = (l: ListRow) => {
    const f = readFilters(l.filters); const parts: string[] = []
    if (f.lead_status?.length) parts.push(`situação: ${f.lead_status.map(s => LEAD_STATUS.find(x => x[0] === s)?.[1] ?? s).join(', ')}`)
    if (f.campaign_ids?.length) parts.push(`${f.campaign_ids.length} campanha(s)`)
    if (f.channels?.length) parts.push(`canal: ${f.channels.map(c => CHANNELS.find(x => x.id === c)?.label ?? c).join(', ')}`)
    if (f.min_score !== null && f.min_score !== undefined) parts.push(`pontuação ≥ ${f.min_score}`)
    if (f.created_from) parts.push(`desde ${f.created_from.split('-').reverse().join('/')}`)
    if (f.segments?.length) parts.push(`segmento: ${f.segments.join(', ')}`)
    if (f.ufs?.length) parts.push(`UF: ${f.ufs.join(', ')}`)
    if (f.tag_ids?.length) parts.push(`${f.tag_ids.length} etiqueta(s)`)
    if (f.only_primary) parts.push('só contato principal')
    return parts.join(' · ') || 'sem filtros'
  }

  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs ${on ? 'border-brand-700 bg-brand-100 text-brand-800' : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'}`

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <p><strong className="text-gray-900">Como funciona:</strong> você monta a lista aqui (quem recebe), o CRM tira quem se descadastrou e e-mails inválidos e envia os contatos ao <strong>Mailchimp</strong> ou ao <strong>RD Station</strong>, com a etiqueta &quot;CRM - nome da lista&quot;. O e-mail é escrito e disparado lá.</p>
        <p className="mt-1 text-xs">
          Mailchimp: {mcReady ? <span className="text-positive-700">conectado ({p.tools.mailchimp?.list_name ?? 'público escolhido'})</span> : <span>não conectado</span>} ·
          RD Station: {rdReady ? <span className="text-positive-700">conectado</span> : <span>não conectado</span>}
          {(!mcReady || !rdReady) && (p.isAdmin ? <> — <a href="/settings/integracoes?cat=automacao" className="text-brand-700 hover:underline">conectar em Integrações → Automação de marketing</a></> : <> — peça ao Admin para conectar em Configurações → Integrações</>)}
        </p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">Listas ({p.lists.length})</p>
        {!editing && <button onClick={() => open()} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">+ Nova lista</button>}
      </div>
      {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-red-600'}`}>{msg.text}</p>}

      {editing && (
        <div className="flex flex-col gap-3 rounded-2xl border border-brand-700/30 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <label className="text-xs font-medium text-gray-700">Nome da lista
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Ex.: Hospitais SP — leads qualificados" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
            </label>
            <label className="text-xs font-medium text-gray-700">Quem entra
              <select value={editing.audience} onChange={e => { const a = e.target.value; setEditing({ ...editing, audience: a, filters: (a === 'inativos') !== (editing.audience === 'inativos') ? { ...editing.filters, segments: [] } : editing.filters }); setPreview(null) }} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
                {Object.entries(AUD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>

          {(editing.audience === 'leads' || editing.audience === 'ambos') && (
            <fieldset className="rounded-xl bg-gray-50 p-3">
              <legend className="px-1 text-xs font-semibold text-gray-700">Filtros dos leads</legend>
              <p className="text-[11px] text-gray-500">Situação</p>
              <div className="mt-1 flex flex-wrap gap-1.5">{LEAD_STATUS.map(([k, v]) => <button key={k} type="button" onClick={() => toggle('lead_status', k)} className={chip(!!editing.filters.lead_status?.includes(k))}>{v}</button>)}</div>
              <p className="mt-2 text-[11px] text-gray-500">Canal de origem</p>
              <div className="mt-1 flex flex-wrap gap-1.5">{CHANNELS.map(c => <button key={c.id} type="button" onClick={() => toggle('channels', c.id)} className={chip(!!editing.filters.channels?.includes(c.id))}>{c.label}</button>)}</div>
              {p.campaigns.length > 0 && <>
                <p className="mt-2 text-[11px] text-gray-500">Campanha</p>
                <div className="mt-1 flex flex-wrap gap-1.5">{p.campaigns.map(c => <button key={c.id} type="button" onClick={() => toggle('campaign_ids', c.id)} className={chip(!!editing.filters.campaign_ids?.includes(c.id))}>{c.name}</button>)}</div>
              </>}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="text-[11px] text-gray-500">Pontuação mínima
                  <input type="number" min={0} value={editing.filters.min_score ?? ''} onChange={e => setF({ min_score: e.target.value === '' ? null : Number(e.target.value) })} className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
                </label>
                <label className="text-[11px] text-gray-500">Recebidos a partir de
                  <input type="date" value={editing.filters.created_from ?? ''} onChange={e => setF({ created_from: e.target.value || null })} className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
                </label>
              </div>
            </fieldset>
          )}

          {editing.audience !== 'leads' && (
            <fieldset className="rounded-xl bg-gray-50 p-3">
              <legend className="px-1 text-xs font-semibold text-gray-700">{editing.audience === 'inativos' ? 'Filtros dos inativos (contatos das empresas sem contrato ativo e sem compra no prazo de Segmentos e inativos)' : 'Filtros dos clientes (contatos das empresas com contrato em gestão)'}</legend>
              {(editing.audience === 'inativos' ? p.options.companySegments : p.options.segments).length > 0 && <>
                <p className="text-[11px] text-gray-500">{editing.audience === 'inativos' ? 'Segmento da empresa' : 'Segmento do contrato'}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">{(editing.audience === 'inativos' ? p.options.companySegments : p.options.segments).map(s => <button key={s} type="button" onClick={() => toggle('segments', s)} className={chip(!!editing.filters.segments?.includes(s))}>{s}</button>)}</div>
              </>}
              {p.options.ufs.length > 0 && <>
                <p className="mt-2 text-[11px] text-gray-500">UF</p>
                <div className="mt-1 flex flex-wrap gap-1.5">{p.options.ufs.map(s => <button key={s} type="button" onClick={() => toggle('ufs', s)} className={chip(!!editing.filters.ufs?.includes(s))}>{s}</button>)}</div>
              </>}
              {p.options.tags.length > 0 && <>
                <p className="mt-2 text-[11px] text-gray-500">Etiqueta da empresa</p>
                <div className="mt-1 flex flex-wrap gap-1.5">{p.options.tags.map(t => <button key={t.id} type="button" onClick={() => toggle('tag_ids', t.id)} className={chip(!!editing.filters.tag_ids?.includes(t.id))}>{t.name}</button>)}</div>
              </>}
              <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={!!editing.filters.only_primary} onChange={e => setF({ only_primary: e.target.checked })} className="accent-brand-700" />
                Só o contato principal de cada empresa
              </label>
            </fieldset>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button disabled={pending} onClick={doPreview} className="rounded-md border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">Ver quem entra</button>
            <button disabled={pending} onClick={doSave} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{pending ? 'Aguarde…' : 'Salvar lista'}</button>
            <button onClick={() => { setEditing(null); setPreview(null) }} className="text-sm text-gray-500 hover:underline">Cancelar</button>
          </div>
          {preview && (
            <div className="rounded-xl border border-gray-200 p-3 text-sm">
              <p className="font-medium text-gray-900">{preview.total} contato(s) entram nesta lista</p>
              <p className="text-xs text-gray-500">Fora da lista: {preview.excludedOptout} descadastrado(s) · {preview.excludedInvalid} sem e-mail válido</p>
              <ul className="mt-2 divide-y divide-gray-50 text-xs">
                {preview.sample.map(m => <li key={m.email} className="flex justify-between gap-3 py-1"><span className="truncate">{m.name}{m.company ? ` · ${m.company}` : ''}</span><span className="truncate text-gray-500">{m.email} · {m.kind}</span></li>)}
              </ul>
              {preview.total > preview.sample.length && <p className="mt-1 text-[11px] text-gray-400">Mostrando {preview.sample.length} de {preview.total}.</p>}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {p.lists.map(l => {
          const busy = progress?.listId === l.id
          return (
            <div key={l.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{l.name} <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-normal text-gray-600">{AUD[l.audience] ?? l.audience}</span></p>
                  <p className="mt-0.5 text-xs text-gray-500">{summary(l)}</p>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {(['mailchimp', 'rd_station'] as const).map(pv => { const s = lastSync(l.id, pv); return s ? `${PROVIDER[pv]}: ${s.sent}/${s.total} em ${br(s.started_at)}${s.failed ? ` (${s.failed} com problema)` : ''}` : null }).filter(Boolean).join(' · ') || 'Ainda não enviada.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button disabled={!!progress || !mcReady} title={mcReady ? '' : 'Conecte o Mailchimp e escolha o público em Integrações'} onClick={() => send(l.id, 'mailchimp')}
                    className="rounded-md bg-brand-700 px-2.5 py-1 font-medium text-white hover:bg-brand-800 disabled:opacity-40">Enviar ao Mailchimp</button>
                  <button disabled={!!progress || !rdReady} title={rdReady ? '' : 'Conecte o RD Station em Integrações'} onClick={() => send(l.id, 'rd_station')}
                    className="rounded-md bg-brand-700 px-2.5 py-1 font-medium text-white hover:bg-brand-800 disabled:opacity-40">Enviar ao RD Station</button>
                  <button onClick={() => open(l)} className="text-brand-700 hover:underline">Editar</button>
                  <button disabled={pending || !!progress} onClick={() => { if (window.confirm(`Excluir a lista "${l.name}"? Os contatos já enviados continuam no Mailchimp/RD.`)) start(async () => { const r = await deleteList(l.id); setMsg(r.ok ? { ok: true, text: 'Lista excluída.' } : { ok: false, text: r.error }); router.refresh() }) }}
                    className="text-gray-500 hover:underline">Excluir</button>
                </div>
              </div>
              {busy && progress && (
                <div className="mt-3">
                  <p className="text-xs text-gray-600">Enviando ao {PROVIDER[progress.provider]}: {progress.done} de {progress.total}{progress.failed ? ` · ${progress.failed} com problema` : ''}… não feche esta tela.</p>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full bg-positive-600" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
                </div>
              )}
            </div>
          )
        })}
        {p.lists.length === 0 && !editing && <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">Nenhuma lista ainda. Crie a primeira com &quot;+ Nova lista&quot;.</p>}
      </div>

      {p.syncs.length > 0 && (
        <details className="rounded-2xl border border-gray-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-gray-900">Histórico de envios</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-gray-500"><tr><th className="py-1 text-left font-medium">Quando</th><th className="text-left font-medium">Lista</th><th className="text-left font-medium">Para</th><th className="text-right font-medium">Enviados</th><th className="text-right font-medium">Problemas</th><th className="pl-3 text-left font-medium">Situação</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {p.syncs.map(s => (
                  <tr key={s.id}>
                    <td className="py-1 pr-3 whitespace-nowrap">{br(s.started_at)}</td>
                    <td className="pr-3">{p.lists.find(l => l.id === s.list_id)?.name ?? '—'}</td>
                    <td className="pr-3">{PROVIDER[s.provider] ?? s.provider}{s.target ? ` · ${s.target}` : ''}</td>
                    <td className="text-right tabular-nums">{s.sent}/{s.total}</td>
                    <td className="text-right tabular-nums">{s.failed}</td>
                    <td className="pl-3" title={s.errors ?? ''}>{s.status === 'concluido' ? 'Concluído' : s.status === 'erro' ? 'Erro' : 'Interrompido/enviando'}{s.errors ? ' ⓘ' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-semibold text-gray-900">Descadastrados ({p.optouts.count})</p>
        <p className="text-xs text-gray-500">Quem pediu para não receber e-mail marketing (LGPD). Nunca entram nas listas. O descadastro no Mailchimp chega aqui sozinho pela integração; pedidos por telefone ou e-mail, inclua à mão.</p>
        <div className="mt-2 flex gap-2">
          <input value={optEmail} onChange={e => setOptEmail(e.target.value)} placeholder="email@empresa.com.br" className="min-w-0 flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
          <button disabled={pending || !optEmail.trim()} onClick={() => start(async () => { const r = await addOptout(optEmail); setMsg(r.ok ? { ok: true, text: 'Descadastro registrado.' } : { ok: false, text: r.error }); if (r.ok) { setOptEmail(''); router.refresh() } })}
            className="rounded-md border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">Descadastrar</button>
        </div>
        {p.optouts.recent.length > 0 && (
          <ul className="mt-2 divide-y divide-gray-50 text-xs">
            {p.optouts.recent.map(o => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-1">
                <span className="truncate">{o.email} <span className="text-gray-400">· {o.source ?? '—'} · {br(o.created_at)}</span></span>
                <button disabled={pending} onClick={() => { if (window.confirm(`Voltar a incluir ${o.email} nas listas? Só faça isso se a pessoa pediu.`)) start(async () => { await removeOptout(o.id); router.refresh() }) }} className="text-gray-500 hover:underline">remover</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
