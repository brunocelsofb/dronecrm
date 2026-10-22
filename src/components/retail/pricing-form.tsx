'use client'

// Varejo → Preço e fidelidade: custos da loja, margem desejada, custos fixos do mês
// e o programa de fidelidade (3 formatos). Mostra na hora o efeito numa peça de exemplo.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveRetailPricing } from '@/lib/actions/retail-pricing'
import { parseMoney } from '@/lib/retail/products'
import { fmtBRL, fmtNum1, fmtPct } from '@/lib/format'
import {
  analyzePrice, breakEvenRevenue, loyaltyCostPct, referencePrice, variablePct, readLoyalty, readPricing,
  type LoyaltyMode, type LoyaltySettings, type PricingSettings,
} from '@/lib/retail/margin'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none disabled:bg-gray-50'
const lbl = 'mb-1 block text-sm font-medium text-gray-800'
const hint = 'mt-1 text-xs text-gray-500'
const toStr = (n: number) => (n ? String(n).replace('.', ',') : '')
const toNum = (s: string) => parseMoney(s) ?? 0
const pctNum = (s: string) => { const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? n : 0 }

const MODES: { id: LoyaltyMode; title: string; text: string }[] = [
  { id: 'cashback', title: 'Cashback em roupas', text: 'Parte do que ela compra vira crédito para a próxima compra, com prazo. Nunca vira dinheiro.' },
  { id: 'cada_x', title: 'A cada R$ X, ganha Y%', text: 'Juntou o valor em compras, ganha um desconto na compra seguinte.' },
  { id: 'progressivo', title: 'Desconto progressivo', text: 'Quanto mais ela compra nos últimos 12 meses, maior o desconto.' },
]

function Field({ label, value, onChange, suffix, prefix, help, disabled }: { label: string; value: string; onChange: (v: string) => void; suffix?: string; prefix?: string; help?: string; disabled?: boolean }) {
  return (
    <div>
      <label className={lbl}>{label}</label>
      <div className="flex items-center rounded-lg border border-gray-300 bg-white focus-within:border-brand-700">
        {prefix && <span className="pl-3 text-sm text-gray-500">{prefix}</span>}
        <input className="w-full rounded-lg px-2.5 py-2 text-sm focus:outline-none disabled:bg-gray-50" inputMode="decimal" value={value} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder="0" />
        {suffix && <span className="pr-3 text-sm text-gray-500">{suffix}</span>}
      </div>
      {help && <p className={hint}>{help}</p>}
    </div>
  )
}

export function PricingForm({ pricing, loyalty, avgTicket, avgCount, readOnly }: { pricing: PricingSettings; loyalty: LoyaltySettings; avgTicket: number; avgCount: number; readOnly: boolean }) {
  const router = useRouter()
  const [p, setP] = useState({
    tax_pct: toStr(pricing.tax_pct), card_pct: toStr(pricing.card_pct), other_pct: toStr(pricing.other_pct), per_piece: toStr(pricing.per_piece),
    target_margin_pct: toStr(pricing.target_margin_pct), fixed_monthly: toStr(pricing.fixed_monthly), avg_ticket: toStr(pricing.avg_ticket),
  })
  const [l, setL] = useState({
    enabled: loyalty.enabled, mode: loyalty.mode, cashback_pct: toStr(loyalty.cashback_pct), cashback_days: String(loyalty.cashback_days),
    every_amount: toStr(loyalty.every_amount), every_pct: toStr(loyalty.every_pct),
    tiers: loyalty.tiers.map(t => ({ min: toStr(t.min), pct: toStr(t.pct) })),
  })
  const [sampleCost, setSampleCost] = useState('100')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const setPf = (k: keyof typeof p) => (v: string) => setP(prev => ({ ...prev, [k]: v }))

  const P: PricingSettings = useMemo(() => readPricing({
    tax_pct: pctNum(p.tax_pct), card_pct: pctNum(p.card_pct), other_pct: pctNum(p.other_pct), per_piece: toNum(p.per_piece),
    target_margin_pct: pctNum(p.target_margin_pct), fixed_monthly: toNum(p.fixed_monthly), avg_ticket: toNum(p.avg_ticket),
  }), [p])
  const L: LoyaltySettings = useMemo(() => readLoyalty({
    enabled: l.enabled, mode: l.mode, cashback_pct: pctNum(l.cashback_pct), cashback_days: Number(l.cashback_days),
    every_amount: toNum(l.every_amount), every_pct: pctNum(l.every_pct), tiers: l.tiers.map(t => ({ min: toNum(t.min), pct: pctNum(t.pct) })),
  }), [l])

  const cost = toNum(sampleCost)
  const ref = referencePrice(cost, P, L)
  const refA = ref.ok ? analyzePrice(ref.price, cost, P, L) : null
  const dbl = cost > 0 ? analyzePrice(cost * 2, cost, P, L) : null
  const loyaltyPct = loyaltyCostPct(L, P.avg_ticket)
  const monthRevenue = breakEvenRevenue(P.fixed_monthly, P.target_margin_pct)

  async function save() {
    setBusy(true); setMsg(null)
    const r = await saveRetailPricing({ pricing: P, loyalty: L })
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    setMsg({ ok: true, text: 'Salvo. As peças e os pedidos já usam estes valores.' }); router.refresh()
  }

  return (
    <div className="space-y-4">
      {readOnly && <p className="rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">Só o administrador da empresa altera estes valores.</p>}

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">1. O que sai de cada venda</h2>
          <p className="text-sm text-gray-600">Custos que acontecem toda vez que uma peça é vendida. Em dúvida, pergunte ao seu contador e à sua maquininha.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Imposto sobre a venda" suffix="%" value={p.tax_pct} onChange={setPf('tax_pct')} disabled={readOnly} help="Ex.: alíquota do Simples Nacional da loja." />
          <Field label="Taxa do cartão / link de pagamento" suffix="%" value={p.card_pct} onChange={setPf('card_pct')} disabled={readOnly} help="Média do que a maquininha ou o link cobra." />
          <Field label="Outros custos por venda" suffix="%" value={p.other_pct} onChange={setPf('other_pct')} disabled={readOnly} help="Comissão de vendedora, anúncio por venda…" />
          <Field label="Custo fixo por peça" prefix="R$" value={p.per_piece} onChange={setPf('per_piece')} disabled={readOnly} help="Embalagem, sacola, etiqueta, brinde." />
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">2. Quanto você quer ganhar</h2>
          <p className="text-sm text-gray-600"><strong>Margem</strong> é quanto sobra do <strong>preço de venda</strong> depois de pagar a peça e os custos da venda. Não é a mesma coisa que <strong>markup</strong>, que é quanto você multiplica o <strong>custo</strong>.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Margem desejada" suffix="%" value={p.target_margin_pct} onChange={setPf('target_margin_pct')} disabled={readOnly} help="O que sobra para pagar as contas do mês e dar lucro." />
          <Field label="Custos fixos do mês" prefix="R$" value={p.fixed_monthly} onChange={setPf('fixed_monthly')} disabled={readOnly} help="Aluguel, salários, contador, sistemas, internet." />
        </div>
        {monthRevenue !== null && (
          <p className="rounded-lg bg-brand-100/60 px-3 py-2 text-sm text-brand-800">
            Para pagar {fmtBRL(P.fixed_monthly)} de custos fixos com margem de {fmtPct(P.target_margin_pct)}, a loja precisa vender <strong>{fmtBRL(monthRevenue)} por mês</strong>. Acima disso, é lucro.
          </p>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">3. Fidelidade</h2>
            <p className="text-sm text-gray-600">Escolha um formato. Dá para desligar num mês e religar depois: enquanto estiver desligada, ninguém ganha nem usa benefício.</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-gray-300 px-3 py-1.5 text-sm">
            <input type="checkbox" checked={l.enabled} disabled={readOnly} onChange={e => setL(prev => ({ ...prev, enabled: e.target.checked }))} />
            {l.enabled ? 'Ligada' : 'Desligada'}
          </label>
        </div>
        <div className={`space-y-4 ${l.enabled ? '' : 'opacity-60'}`}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {MODES.map(m => (
              <label key={m.id} className={`cursor-pointer rounded-lg border p-3 ${l.mode === m.id ? 'border-brand-700 bg-brand-100/50' : 'border-gray-200 hover:border-gray-300'}`}>
                <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                  <input type="radio" name="loyalty-mode" checked={l.mode === m.id} disabled={readOnly} onChange={() => setL(prev => ({ ...prev, mode: m.id }))} />{m.title}
                </span>
                <span className="mt-1 block text-xs text-gray-500">{m.text}</span>
              </label>
            ))}
          </div>

          {l.mode === 'cashback' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Cashback" suffix="% da compra" value={l.cashback_pct} onChange={v => setL(prev => ({ ...prev, cashback_pct: v }))} disabled={readOnly} help="Ex.: 5% de uma compra de R$ 200,00 = R$ 10,00 de crédito." />
              <Field label="Validade do crédito" suffix="dias" value={l.cashback_days} onChange={v => setL(prev => ({ ...prev, cashback_days: v.replace(/\D/g, '') }))} disabled={readOnly} help="Depois disso, o crédito não usado vence." />
            </div>
          )}
          {l.mode === 'cada_x' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="A cada (em compras)" prefix="R$" value={l.every_amount} onChange={v => setL(prev => ({ ...prev, every_amount: v }))} disabled={readOnly} />
              <Field label="Ganha de desconto na próxima" suffix="%" value={l.every_pct} onChange={v => setL(prev => ({ ...prev, every_pct: v }))} disabled={readOnly} />
              <div className="sm:col-span-2">
                <Field label="Valor médio de uma compra (para a conta)" prefix="R$" value={p.avg_ticket} onChange={setPf('avg_ticket')} disabled={readOnly}
                  help={avgCount ? `A média dos seus ${avgCount} pedidos pagos é ${fmtBRL(avgTicket)}.` : 'Ainda não há pedidos pagos. Em branco, a conta considera uma compra igual ao valor X.'} />
                {avgCount > 0 && !readOnly && <button type="button" onClick={() => setPf('avg_ticket')(toStr(avgTicket))} className="mt-1 text-xs text-brand-700 hover:underline">Usar a média dos pedidos</button>}
              </div>
            </div>
          )}
          {l.mode === 'progressivo' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-700">Degraus (compras pagas nos últimos 12 meses → desconto):</p>
              {l.tiers.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <Field label={i === 0 ? 'A partir de' : ' '} prefix="R$" value={t.min} disabled={readOnly} onChange={v => setL(prev => ({ ...prev, tiers: prev.tiers.map((x, j) => (j === i ? { ...x, min: v } : x)) }))} />
                  <Field label={i === 0 ? 'Desconto' : ' '} suffix="%" value={t.pct} disabled={readOnly} onChange={v => setL(prev => ({ ...prev, tiers: prev.tiers.map((x, j) => (j === i ? { ...x, pct: v } : x)) }))} />
                  {!readOnly && <button type="button" onClick={() => setL(prev => ({ ...prev, tiers: prev.tiers.filter((_, j) => j !== i) }))} className="mb-2 text-xs text-negative-700">Tirar</button>}
                </div>
              ))}
              {!readOnly && l.tiers.length < 6 && <button type="button" onClick={() => setL(prev => ({ ...prev, tiers: [...prev.tiers, { min: '', pct: '' }] }))} className="text-sm text-brand-700 hover:underline">+ Degrau</button>}
            </div>
          )}
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            {l.enabled
              ? <>A fidelidade custa até <strong>{fmtPct(loyaltyPct)}</strong> do preço, e isso já entra no preço de referência. {L.mode === 'cashback' ? 'Considera que toda cliente usa o crédito (o cenário mais caro).' : L.mode === 'progressivo' ? 'Considera o maior desconto da escada (o cenário mais caro).' : 'Conta: desconto × compra média ÷ (valor X + compra média).'}</>
              : 'Desligada: não entra no preço e ninguém ganha benefício.'}
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-brand-700/30 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Veja numa peça</h2>
        <div className="max-w-xs"><Field label="Custo da peça" prefix="R$" value={sampleCost} onChange={setSampleCost} /></div>
        {!ref.ok ? <p className="rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">{ref.reason}</p> : refA && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-positive-600/40 bg-positive-100/50 p-3 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-positive-700">Preço de referência</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{fmtBRL(ref.price)}</p>
              <ul className="mt-2 space-y-0.5 text-gray-700">
                <li>Markup: {fmtNum1(refA.markup)} ({fmtPct(refA.markupPct)} sobre o custo)</li>
                <li>Margem: {fmtPct(refA.marginPct)} · sobra {fmtBRL(refA.contribution)} por peça</li>
                <li>Mínimo sem prejuízo: {fmtBRL(refA.minPrice)}</li>
                {refA.breakEvenUnits !== null && <li>{refA.breakEvenUnits} peças como esta pagam os custos fixos do mês</li>}
              </ul>
            </div>
            {dbl && (
              <div className="rounded-lg border border-gray-200 p-3 text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Comparação: custo × 2</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{fmtBRL(dbl.price)}</p>
                <ul className="mt-2 space-y-0.5 text-gray-700">
                  <li>Margem: <span className={dbl.marginPct < P.target_margin_pct ? 'text-warn-700' : ''}>{fmtPct(dbl.marginPct)}</span> · sobra {fmtBRL(dbl.contribution)}</li>
                  <li>Custos da venda: {fmtPct(variablePct(P, L))} do preço</li>
                </ul>
              </div>
            )}
          </div>
        )}
        <p className={hint}>Preço de referência = (custo + custo por peça) ÷ (1 − custos da venda − fidelidade − margem), arredondado para cima no centavo.</p>
      </section>

      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}</p>}
      {!readOnly && (
        <div className="sticky bottom-0 flex justify-end border-t border-gray-200 bg-white/95 py-3">
          <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      )}
    </div>
  )
}
