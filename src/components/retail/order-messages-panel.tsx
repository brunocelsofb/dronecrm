'use client'

// Mensagens do pedido: o Drone deixa o rascunho de cada etapa e a equipe revisa e envia
// (WhatsApp pelo Drone ou pelo celular, e-mail opcional). Mais: separado, rastreio,
// página do pedido para a cliente e a linha do tempo.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { discardRetailOrderMessage, markRetailOrderSeparated, redoRetailOrderMessage, saveRetailTracking, sendRetailOrderMessage } from '@/lib/actions/retail-order-messages'
import { MESSAGE_STAGES } from '@/lib/retail/order-messages'
import { whatsappLink } from '@/lib/retail/customers'

export type OrderMessage = {
  id: string; stage: string; status: string; wa_text: string; email_subject: string; email_body: string
  sent_channels: string[]; sent_at: string | null; sent_by_name: string | null; last_error: string | null; updated_at: string
}
export type OrderEvent = { id: string; kind: string; note: string | null; public: boolean; created_at: string; by: string | null }

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'
const lbl = 'mb-1 block text-xs font-medium text-gray-600'
const fmtDT = (d: string | null) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const stageLabel = (s: string) => MESSAGE_STAGES.find(x => x.id === s)?.label ?? s
const EVENT_LABEL: Record<string, string> = {
  recebido: 'Pedido recebido', link: 'Link de pagamento gerado', pago: 'Pagamento confirmado', separado: 'Pedido separado',
  enviado: 'Pedido enviado', entregue: 'Pedido entregue', cancelado: 'Pedido cancelado', mensagem: 'Mensagem', rastreio: 'Rastreio',
}
const channelText = (c: string[]) => c.map(x => (x === 'email' ? 'e-mail' : x === 'whatsapp_drone' ? 'WhatsApp pelo Drone' : 'WhatsApp do celular')).join(' + ') || 'sem canal'

export function OrderMessagesPanel({ orderId, status, separatedAt, tracking, messages, events, customer, instances, canEmail, publicUrl, editable }: {
  orderId: string; status: string; separatedAt: string | null
  tracking: { carrier: string | null; code: string | null; url: string | null }
  messages: OrderMessage[]; events: OrderEvent[]
  customer: { phone: string | null; email: string | null } | null
  instances: { name: string; label: string }[]; canEmail: boolean; publicUrl: string | null; editable: boolean
}) {
  const router = useRouter()
  const order = MESSAGE_STAGES.map(s => s.id as string)
  const pending = messages.filter(m => m.status === 'pendente').sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage))
  const done = messages.filter(m => m.status !== 'pendente').sort((a, b) => (b.sent_at ?? b.updated_at).localeCompare(a.sent_at ?? a.updated_at))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [tr, setTr] = useState({ carrier: tracking.carrier ?? '', code: tracking.code ?? '', url: tracking.url ?? '' })
  const [copied, setCopied] = useState(false)

  async function separate() {
    setBusy(true); setMsg(null)
    const r = await markRetailOrderSeparated(orderId)
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    setMsg({ ok: true, text: 'Marcado como separado. A mensagem para a cliente está pronta para revisar.' }); router.refresh()
  }
  async function saveTracking() {
    setBusy(true); setMsg(null)
    const r = await saveRetailTracking(orderId, tr)
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    setMsg({ ok: true, text: 'Rastreio salvo. Ele entra na mensagem de "Pedido enviado" e na página do pedido.' }); router.refresh()
  }
  async function copyLink() {
    if (!publicUrl) return
    try { await navigator.clipboard.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setMsg({ ok: false, text: 'Não foi possível copiar. Selecione o link e copie.' }) }
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Mensagens para a cliente</h2>
          {pending.length > 0 && <span className="rounded-full bg-warn-100 px-2 py-0.5 text-xs font-medium text-warn-700">{pending.length} para revisar</span>}
        </div>
        <p className="text-xs text-gray-500">O Drone prepara a mensagem de cada etapa. Nada vai para a cliente sem alguém da loja revisar e enviar.</p>
        {!customer?.phone && <p className="rounded-lg bg-warn-100 px-3 py-2 text-xs text-warn-700">A cliente está sem WhatsApp. Cadastre na ficha dela para poder enviar.</p>}
        {pending.length === 0 && <p className="text-sm text-gray-500">Nenhuma mensagem esperando. Quando o pedido mudar de etapa, o rascunho aparece aqui.</p>}
        {pending.map(m => (
          <MessageCard key={`${m.id}-${m.updated_at}`} m={m} customer={customer} instances={instances} canEmail={canEmail} editable={editable}
            onDone={(text, ok) => { setMsg({ ok, text }); router.refresh() }} />
        ))}
        {done.length > 0 && (
          <details className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
            <summary className="cursor-pointer text-sm text-gray-700">Já enviadas ou descartadas ({done.length})</summary>
            <ul className="mt-2 space-y-2">
              {done.map(m => (
                <li key={m.id} className="rounded-lg bg-white p-2 text-xs text-gray-600">
                  <p className="font-medium text-gray-800">{stageLabel(m.stage)} · {m.status === 'enviada' ? `enviada ${fmtDT(m.sent_at)}${m.sent_by_name ? ` por ${m.sent_by_name}` : ''} (${channelText(m.sent_channels)})` : 'não enviada'}</p>
                  {m.last_error && <p className="text-warn-700">{m.last_error}</p>}
                  {m.status === 'enviada' && <pre className="mt-1 whitespace-pre-wrap font-sans text-gray-600">{m.wa_text}</pre>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Separação e rastreio</h2>
        {status === 'pago' && !separatedAt && editable && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={separate} disabled={busy} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">Marcar como separado</button>
            <span className="text-xs text-gray-500">Peças separadas e embaladas. Gera a mensagem para a cliente.</span>
          </div>
        )}
        {separatedAt && <p className="text-sm text-gray-700">Separado em {fmtDT(separatedAt)}.</p>}
        {status !== 'pago' && !separatedAt && !['enviado', 'entregue'].includes(status) && <p className="text-xs text-gray-500">&quot;Separado&quot; libera depois que o pedido estiver Pago.</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><label className={lbl} htmlFor="tr-carrier">Transportadora ou forma</label>
            <input id="tr-carrier" className={inp} list="tr-carriers" value={tr.carrier} onChange={e => setTr(p => ({ ...p, carrier: e.target.value }))} placeholder="ex.: Correios" disabled={!editable} />
            <datalist id="tr-carriers"><option value="Correios" /><option value="Jadlog" /><option value="Motoboy da loja" /><option value="Retirada na loja" /></datalist></div>
          <div><label className={lbl} htmlFor="tr-code">Código de rastreio</label><input id="tr-code" className={inp} value={tr.code} onChange={e => setTr(p => ({ ...p, code: e.target.value }))} placeholder="ex.: AB123456789BR" disabled={!editable} /></div>
          <div><label className={lbl} htmlFor="tr-url">Link de rastreio (opcional)</label><input id="tr-url" className={inp} value={tr.url} onChange={e => setTr(p => ({ ...p, url: e.target.value }))} placeholder="https://…" disabled={!editable} /></div>
        </div>
        {editable && <div className="flex justify-end"><button type="button" onClick={saveTracking} disabled={busy} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Salvar rastreio</button></div>}
        <p className="text-xs text-gray-500">Para avisar que saiu, mude a situação para Enviado (abaixo): o rascunho já vem com o rastreio.</p>
      </section>

      {publicUrl && (
        <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Página do pedido para a cliente</h2>
          <p className="text-xs text-gray-500">A cliente acompanha as etapas, a conta e o rastreio, sem login. O link vai nas mensagens.</p>
          <p className="break-all rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700">{publicUrl}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copyLink} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">{copied ? 'Copiado' : 'Copiar link'}</button>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Ver como a cliente vê</a>
          </div>
        </section>
      )}

      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}</p>}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Linha do tempo</h2>
        {events.length === 0 ? <p className="mt-2 text-sm text-gray-500">Ainda sem registros.</p> : (
          <ol className="mt-2 space-y-1.5 text-sm">
            {events.map(e => (
              <li key={e.id} className="grid grid-cols-[92px_1fr] gap-2">
                <time className="text-xs tabular-nums text-gray-500">{fmtDT(e.created_at)}</time>
                <span className="text-gray-700">{EVENT_LABEL[e.kind] ?? e.kind}{e.note ? `: ${e.note}` : ''}{e.by ? <span className="text-gray-500"> · {e.by}</span> : null}{e.public && <span className="ml-1 text-xs text-gray-400">(a cliente vê)</span>}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function MessageCard({ m, customer, instances, canEmail, editable, onDone }: {
  m: OrderMessage; customer: { phone: string | null; email: string | null } | null
  instances: { name: string; label: string }[]; canEmail: boolean; editable: boolean
  onDone: (text: string, ok: boolean) => void
}) {
  const [wa, setWa] = useState(m.wa_text)
  const [subject, setSubject] = useState(m.email_subject)
  const [email, setEmail] = useState(m.email_body)
  const [via, setVia] = useState<'drone' | 'manual' | 'none'>(instances.length ? 'drone' : 'manual')
  const [instance, setInstance] = useState(instances[0]?.name ?? '')
  const emailOk = canEmail && !!customer?.email
  const [sendEmail, setSendEmail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(m.last_error)

  async function send() {
    setBusy(true); setErr(null)
    if (via === 'manual') {
      const url = whatsappLink(customer?.phone, wa)
      if (!url) { setBusy(false); setErr('A cliente está sem WhatsApp válido.'); return }
      window.open(url, '_blank', 'noopener')
    }
    const r = await sendRetailOrderMessage(m.id, { wa, subject, email, whatsapp: via, instance, sendEmail: sendEmail && emailOk })
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    onDone(r.warning ?? (via === 'manual' ? 'Marcada como enviada. Confira se a mensagem saiu no WhatsApp.' : 'Mensagem enviada.'), !r.warning)
  }
  async function redo() {
    setBusy(true); setErr(null)
    const r = await redoRetailOrderMessage(m.id)
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    setWa(r.wa); setSubject(r.subject); setEmail(r.email)
  }
  async function discard() {
    if (!confirm('Não enviar esta mensagem? A etapa continua registrada.')) return
    setBusy(true)
    const r = await discardRetailOrderMessage(m.id)
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    onDone('Mensagem descartada.', true)
  }

  const nothing = via === 'none' && !(sendEmail && emailOk)
  const label = via === 'manual' ? (sendEmail && emailOk ? 'Abrir WhatsApp, enviar e-mail e marcar enviada' : 'Abrir no WhatsApp e marcar enviada') : 'Enviar'
  return (
    <div className="space-y-3 rounded-lg border border-warn-600/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{stageLabel(m.stage)}</h3>
        <span className="rounded-full bg-warn-100 px-2 py-0.5 text-xs font-medium text-warn-700">Para revisar</span>
      </div>
      <div><label className={lbl} htmlFor={`wa-${m.id}`}>Mensagem de WhatsApp</label>
        <textarea id={`wa-${m.id}`} className={inp} rows={Math.min(14, Math.max(5, wa.split('\n').length + 1))} value={wa} onChange={e => setWa(e.target.value)} disabled={!editable} /></div>
      <fieldset className="space-y-1.5">
        <legend className={lbl}>Como enviar o WhatsApp</legend>
        {instances.length > 0 && (
          <label className="flex flex-wrap items-center gap-2 text-sm"><input type="radio" name={`via-${m.id}`} checked={via === 'drone'} onChange={() => setVia('drone')} disabled={!editable} /> Pelo WhatsApp conectado ao Drone
            {via === 'drone' && instances.length > 1 && <select className="rounded-lg border border-gray-300 px-2 py-1 text-sm" value={instance} onChange={e => setInstance(e.target.value)} aria-label="WhatsApp de envio">{instances.map(i => <option key={i.name} value={i.name}>{i.label}</option>)}</select>}
          </label>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="radio" name={`via-${m.id}`} checked={via === 'manual'} onChange={() => setVia('manual')} disabled={!editable} /> Pelo meu celular (abre o WhatsApp com o texto pronto)</label>
        <label className="flex items-center gap-2 text-sm"><input type="radio" name={`via-${m.id}`} checked={via === 'none'} onChange={() => setVia('none')} disabled={!editable} /> Não mandar WhatsApp</label>
      </fieldset>
      <div className="space-y-2 rounded-lg bg-gray-50 p-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sendEmail && emailOk} onChange={e => setSendEmail(e.target.checked)} disabled={!emailOk || !editable} /> Enviar também por e-mail{customer?.email ? ` para ${customer.email}` : ''}</label>
        {!customer?.email && <p className="text-xs text-gray-500">A cliente está sem e-mail na ficha.</p>}
        {customer?.email && !canEmail && <p className="text-xs text-gray-500">Para enviar e-mail, conecte seu e-mail em Minha Conta. É opcional.</p>}
        {sendEmail && emailOk && (
          <>
            <div><label className={lbl} htmlFor={`sub-${m.id}`}>Assunto</label><input id={`sub-${m.id}`} className={inp} value={subject} onChange={e => setSubject(e.target.value)} /></div>
            <div><label className={lbl} htmlFor={`em-${m.id}`}>E-mail</label><textarea id={`em-${m.id}`} className={inp} rows={8} value={email} onChange={e => setEmail(e.target.value)} /></div>
          </>
        )}
      </div>
      {err && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-xs text-negative-700">{err}</p>}
      {editable && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={send} disabled={busy || nothing} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Enviando…' : label}</button>
          <button type="button" onClick={redo} disabled={busy} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Refazer pelo modelo</button>
          <button type="button" onClick={discard} disabled={busy} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">Não enviar</button>
        </div>
      )}
    </div>
  )
}
