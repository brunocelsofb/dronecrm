'use client'

// Anúncios do Meta: conectar (um clique), escolher a conta, ver os números e ligar às campanhas do Drone
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { chooseMetaAdAccount, disconnectMeta, linkMetaCampaign, syncMetaNow } from '@/lib/actions/retail-meta'
import { fmtBRL } from '@/lib/format'
import type { MetaConnectionInfo } from '@/lib/retail/meta-ads-data'

type Row = { meta_campaign_id: string; name: string; status: string | null; spend: number; reach: number; clicks: number; auto: { id: string; name: string } | null; manual: string | null }
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'nunca')
const n = (v: number) => v.toLocaleString('pt-BR')
const STATUS: Record<string, string> = { ACTIVE: 'ativa', PAUSED: 'pausada', ARCHIVED: 'arquivada', DELETED: 'excluída', CAMPAIGN_PAUSED: 'pausada', IN_PROCESS: 'em análise', WITH_ISSUES: 'com problema' }
const btn = 'rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50'

export function MetaAdsView({ enabled, readOnly, notice, error, conn, rows, campaigns }: {
  enabled: boolean; readOnly: boolean; notice: string | null; error: string | null
  conn: (MetaConnectionInfo & { token: 'ok' | 'vence-logo' | 'vencido' }) | null; rows: Row[]; campaigns: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(error ? { ok: false, text: error } : notice ? { ok: true, text: notice } : null)
  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(key); setMsg(null)
    const r = await fn()
    setBusy(null)
    setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? 'Falhou.' })
    if (r.ok) router.refresh()
  }
  const banner = msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}</p>

  if (!enabled) return (
    <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
      {banner}
      <p className="text-sm font-semibold text-gray-900">Em breve</p>
      <p className="text-sm text-gray-600">A conexão com o Meta ainda está sendo liberada pela plataforma. Enquanto isso: crie a campanha no Drone, use o link dela como destino do anúncio e lance o valor gasto no investimento da campanha.</p>
    </section>
  )

  const connectBtn = (label: string) => <a href="/api/varejo/meta/conectar" className="inline-block rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">{label}</a>

  if (!conn) return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      {banner}
      <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
        <li>Entre com o Facebook que gerencia os anúncios da loja e escolha a conta de anúncios.</li>
        <li>Só leitura: o Drone lê gasto, alcance e cliques. Não cria, não altera anúncios e não vê o cartão.</li>
        <li>Use o link da campanha do Drone como destino do anúncio: o Drone liga os dois sozinho.</li>
      </ul>
      {!readOnly && connectBtn('Conectar com o Facebook')}
    </section>
  )

  const linkedTotal = rows.filter(r => r.auto || r.manual).reduce((t, r) => t + r.spend, 0)
  return (
    <div className="space-y-3">
      {banner}
      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">{conn.adAccountName ?? 'Escolha a conta de anúncios'}{conn.adAccountId && <span className="ml-1 text-xs font-normal text-gray-500">conta {conn.adAccountId}{conn.currency ? ` · ${conn.currency}` : ''}</span>}</p>
            <p className="text-xs text-gray-500">Conectado por {conn.userName || 'Facebook'} · última atualização {when(conn.lastSyncAt)}</p>
          </div>
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              {conn.adAccountId && <button type="button" className={btn} disabled={!!busy} onClick={() => run('sync', syncMetaNow, 'Números atualizados.')}>{busy === 'sync' ? 'Atualizando…' : 'Atualizar agora'}</button>}
              <button type="button" className={`${btn} text-negative-700`} disabled={!!busy} onClick={() => { if (confirm('Desconectar o Meta? Os números lidos somem do Drone; as campanhas continuam.')) run('off', disconnectMeta, 'Desconectado.') }}>Desconectar</button>
            </div>
          )}
        </div>
        {conn.token !== 'ok' && <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700"><span className="flex-1">{conn.token === 'vencido' ? 'O acesso ao Meta venceu: os números pararam de atualizar.' : 'O acesso ao Meta vence em poucos dias.'} Entre de novo para renovar.</span>{!readOnly && connectBtn('Reconectar')}</div>}
        {conn.lastError && <p className="text-xs text-negative-700">Última leitura falhou: {conn.lastError}</p>}
        {(conn.accounts.length > 1 || !conn.adAccountId) && !readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="acc" className="text-xs text-gray-600">Conta de anúncios</label>
            <select id="acc" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={conn.adAccountId ?? ''} disabled={!!busy}
              onChange={e => e.target.value && run('acc', () => chooseMetaAdAccount(e.target.value), 'Conta escolhida e números lidos.')}>
              <option value="">Escolha…</option>
              {conn.accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.id}){a.active === false ? ' · inativa' : ''}</option>)}
            </select>
          </div>
        )}
      </section>

      {conn.adAccountId && (
        <section className="rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 p-3">
            <h2 className="text-sm font-semibold text-gray-900">Campanhas no Meta ({rows.length})</h2>
            <span className="text-xs text-gray-600">Ligadas às campanhas do Drone: {fmtBRL(linkedTotal)} de gasto</span>
          </div>
          {rows.length === 0 ? <p className="p-4 text-sm text-gray-500">Nenhuma campanha nesta conta ainda.</p> : (
            <ul className="divide-y divide-gray-100">
              {rows.map(r => (
                <li key={r.meta_campaign_id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{r.name || r.meta_campaign_id}</p>
                    <p className="text-xs text-gray-500">{STATUS[r.status ?? ''] ?? (r.status ?? '').toLowerCase()} · gasto {fmtBRL(r.spend)} · alcance {n(r.reach)} · {n(r.clicks)} cliques no link</p>
                  </div>
                  <div className="w-full text-xs sm:w-64">
                    {r.auto ? <p className="text-positive-700">Ligada a <strong>{r.auto.name}</strong> (pelo link do anúncio)</p> : (
                      <select aria-label={`Campanha do Drone para ${r.name}`} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={r.manual ?? ''} disabled={readOnly || !!busy}
                        onChange={e => run(r.meta_campaign_id, () => linkMetaCampaign(r.meta_campaign_id, e.target.value || null), 'Ligação salva.')}>
                        <option value="">Ligar a uma campanha do Drone…</option>
                        {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-gray-100 p-3 text-[11px] text-gray-500">Números desde o início de cada campanha, como o Meta informa (podem mudar alguns dias depois). Atualiza sozinho uma vez por dia.</p>
        </section>
      )}
    </div>
  )
}
