'use client'

// Uma campanha: link para divulgar, mensagem (editável), quem vai receber (revisar e enviar uma a uma)
// e o resultado com a conta aberta.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteRetailCampaign, saveRetailCampaign, sendRetailCampaignMessage, skipRetailCampaignCustomer } from '@/lib/actions/retail-campaigns'
import { AUDIENCES, renderCampaignMessage, type Audience, type AudienceParams } from '@/lib/retail/campaigns'
import { fmtBRL, fmtNum1 } from '@/lib/format'

type Person = { id: string; name: string; phone: string | null; birth_date: string | null; last_purchase: string | null }
type Send = { status: string; channel: string | null; sent_at: string }
type Result = { orders: number; paid: number; sold: number; grossMargin: number | null; roas: number | null; costPerSale: number | null }
const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : '')
const waDigits = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('55') ? d : `55${d}` }

export function CampaignDetail({ campaign, people, sends, result, link, store, instances, readOnly, optinMissing }: {
  campaign: { id: string; name: string; code: string; audience: Audience; params: AudienceParams; message: string; investment: number; status: string }
  people: Person[]; sends: Record<string, Send>; result: Result; link: string | null; store: string
  instances: { name: string; label: string }[]; readOnly: boolean; optinMissing: number
}) {
  const router = useRouter()
  const [message, setMessage] = useState(campaign.message)
  const [investment, setInvestment] = useState(campaign.investment ? campaign.investment.toFixed(2).replace('.', ',') : '')
  const [via, setVia] = useState<'drone' | 'manual'>(instances.length ? 'drone' : 'manual')
  const [instance, setInstance] = useState(instances[0]?.name ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const closed = campaign.status !== 'ativa'
  const pending = people.filter(p => !sends[p.id])
  const sentCount = people.filter(p => sends[p.id]?.status === 'enviada').length
  const textFor = (p: Person) => renderCampaignMessage(message, { nome: p.name, loja: store, link: link ?? '' })

  async function save(extra: Partial<{ status: string }> = {}) {
    setBusy('save'); setMsg(null)
    const r = await saveRetailCampaign({ id: campaign.id, name: campaign.name, audience: campaign.audience, params: campaign.params, message, investment, status: extra.status ?? campaign.status })
    setBusy(null)
    setMsg(r.ok ? { ok: true, text: 'Salvo.' } : { ok: false, text: r.error })
    if (r.ok) router.refresh()
  }
  async function send(p: Person) {
    const text = textFor(p)
    // Manual: abre o WhatsApp no aparelho com a mensagem pronta e registra o envio
    if (via === 'manual') window.open(`https://wa.me/${waDigits(p.phone ?? '')}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    setBusy(p.id); setMsg(null)
    const r = await sendRetailCampaignMessage(campaign.id, p.id, { text, via, instance })
    setBusy(null)
    if (!r.ok) { setMsg({ ok: false, text: `${p.name}: ${r.error}` }); return }
    router.refresh()
  }
  async function skip(p: Person, on: boolean) {
    setBusy(p.id)
    const r = await skipRetailCampaignCustomer(campaign.id, p.id, on)
    setBusy(null)
    if (!r.ok) setMsg({ ok: false, text: r.error }); else router.refresh()
  }
  async function copyLink() {
    if (!link) return
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setMsg({ ok: false, text: 'Não consegui copiar. Selecione o link e copie.' }) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{campaign.name}</h1>
          <p className="text-sm text-gray-600">{AUDIENCES.find(a => a.id === campaign.audience)?.label}{closed ? ' · encerrada' : ''}</p>
        </div>
        {!readOnly && (
          <div className="flex gap-2 text-sm">
            <button type="button" className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700" onClick={() => save({ status: closed ? 'ativa' : 'encerrada' })}>{closed ? 'Reabrir' : 'Encerrar'}</button>
            <button type="button" className="px-2 text-negative-700" onClick={async () => { if (confirm('Excluir esta campanha? Os pedidos continuam, só perdem a marca da campanha.')) { const r = await deleteRetailCampaign(campaign.id); if (r.ok) router.push('/varejo/campanhas'); else setMsg({ ok: false, text: r.error }) } }}>Excluir</button>
          </div>
        )}
      </div>

      {/* Resultado com a conta aberta */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Vendido (pago, sem frete)" value={fmtBRL(result.sold)} />
        <Stat label="Pedidos pagos" value={`${result.paid} de ${result.orders}`} />
        <Stat label="Retorno" value={result.roas !== null ? `${fmtNum1(result.roas)} vezes` : '—'} sub={result.roas !== null ? `${fmtBRL(result.sold)} ÷ ${fmtBRL(campaign.investment)}` : 'lance o investimento'} />
        <Stat label="Custo por venda" value={result.costPerSale !== null ? fmtBRL(result.costPerSale) : '—'} sub={result.costPerSale !== null ? `${fmtBRL(campaign.investment)} ÷ ${result.paid}` : ''} />
      </section>
      {result.grossMargin !== null && result.paid > 0 && <p className="text-xs text-gray-600">Vendido − custo das peças = <strong>{fmtBRL(result.grossMargin)}</strong> (antes de impostos e taxas).</p>}
      <p className="text-[11px] text-gray-500">Conta: pedido feito pelo link da campanha, ou por cliente que recebeu a mensagem nos 7 dias antes do pedido. Pedido cancelado não entra.</p>

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Link da campanha</h2>
        {link ? (
          <div className="flex flex-wrap items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-800">{link}</code>
            <button type="button" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700" onClick={copyLink}>{copied ? 'Copiado' : 'Copiar'}</button></div>
        ) : <p className="text-sm text-warn-700">Configure a vitrine (Configurar loja → Vitrine) para ter o link.</p>}
        <p className="text-xs text-gray-500">Use no Instagram, no anúncio, no QR Code da loja ou mande para quem quiser: a venda por ele conta para a campanha.</p>
      </section>

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Mensagem</h2>
          <span className="text-[11px] text-gray-500">{'{nome}'} = primeiro nome · {'{link}'} = link da campanha · {'{loja}'} = nome da loja</span>
        </div>
        <textarea className={inp} rows={3} value={message} onChange={e => setMessage(e.target.value)} disabled={readOnly} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48"><label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="inv">Investimento (R$)</label><input id="inv" className={inp} inputMode="decimal" value={investment} onChange={e => setInvestment(e.target.value)} disabled={readOnly} placeholder="0,00" /></div>
          {!readOnly && <button type="button" disabled={busy === 'save'} onClick={() => save()} className="rounded-lg border border-brand-700 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">Salvar mensagem e investimento</button>}
        </div>
      </section>

      {campaign.audience !== 'nenhum' && (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Quem vai receber ({people.length}) · {sentCount} enviada(s) · {pending.length} a enviar</h2>
            {instances.length > 0 && !readOnly && !closed && (
              <div className="flex items-center gap-2 text-sm">
                <select className="rounded-lg border border-gray-300 px-2 py-1" value={via} onChange={e => setVia(e.target.value as 'drone' | 'manual')} aria-label="Como enviar">
                  <option value="drone">Enviar pelo WhatsApp do Drone</option><option value="manual">Abrir no meu WhatsApp</option>
                </select>
                {via === 'drone' && instances.length > 1 && <select className="rounded-lg border border-gray-300 px-2 py-1" value={instance} onChange={e => setInstance(e.target.value)} aria-label="WhatsApp de envio">{instances.map(i => <option key={i.name} value={i.name}>{i.label}</option>)}</select>}
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500">Só aparece quem autorizou receber WhatsApp da loja.{optinMissing > 0 ? ` ${optinMissing} cliente(s) não autorizaram e ficam de fora.` : ''} Envie uma a uma, com calma: mandar muitas mensagens seguidas pode bloquear o número.</p>
          {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}</p>}
          {people.length === 0 ? <p className="text-sm text-gray-500">Nenhuma cliente neste público agora.</p> : (
            <ul className="divide-y divide-gray-100">
              {people.map(p => {
                const s = sends[p.id]
                return (
                  <li key={p.id} className="space-y-1 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm"><strong>{p.name}</strong> <span className="text-xs text-gray-500">{p.birth_date ? `· aniversário ${day(p.birth_date + 'T12:00:00')}` : ''}{p.last_purchase ? ` · última compra ${day(p.last_purchase)}` : ''}</span></span>
                      {s?.status === 'enviada' ? <span className="rounded-full bg-positive-100 px-2 py-0.5 text-xs text-positive-700">enviada em {day(s.sent_at)}</span>
                        : s?.status === 'descartada' ? <button type="button" disabled={readOnly || busy === p.id} className="text-xs text-gray-500 underline" onClick={() => skip(p, false)}>pulada · desfazer</button>
                        : !readOnly && !closed ? (
                          <span className="flex gap-2">
                            <button type="button" disabled={busy === p.id} onClick={() => send(p)} className="rounded-lg bg-brand-700 px-3 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy === p.id ? 'Enviando…' : via === 'drone' ? 'Enviar' : 'Abrir e marcar enviada'}</button>
                            <button type="button" disabled={busy === p.id} onClick={() => skip(p, true)} className="text-xs text-gray-500 underline">Pular</button>
                          </span>
                        ) : null}
                    </div>
                    {!s && <p className="whitespace-pre-wrap rounded bg-gray-50 px-2 py-1 text-xs text-gray-700">{textFor(p)}</p>}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900">{value}</p>
      {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
    </div>
  )
}
