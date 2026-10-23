'use client'

// Pedido do Varejo: quanto a venda deixa, até onde dá para negociar e a fidelidade
// da cliente. Contas em margin.ts (testadas); o valor final é sempre gravado pelo servidor.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { fmtBRL, fmtPct } from '@/lib/format'
import { analyzeLines, analyzeOrder, loyaltyMessage, loyaltyUnitText, type LoyaltySettings, type OrderLine, type PricingSettings } from '@/lib/retail/margin'
import { whatsappLink } from '@/lib/retail/customers'
import { parseMoney } from '@/lib/retail/products'
import { updateRetailOrderPayment } from '@/lib/actions/retail-orders'
import { applyOrderLoyalty, removeOrderLoyalty } from '@/lib/actions/retail-pricing'
import type { CustomerLoyalty } from '@/lib/retail/loyalty-server'

type Payment = { discount: number; shipping: number; payment_method: string | null; payment_condition: string | null; payment_link: string | null; notes: string | null }

const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')

export function NegotiationPanel({ orderId, lines, labels, customer, storeName, payment, loyaltyDiscount, loyaltyKind, pricing, loyalty, customerLoyalty, editable, hasCustomer }: {
  orderId: string; lines: OrderLine[]; labels: string[]; customer: { name: string; phone: string | null } | null; storeName: string; payment: Payment; loyaltyDiscount: number; loyaltyKind: string | null
  pricing: PricingSettings; loyalty: LoyaltySettings; customerLoyalty: CustomerLoyalty; editable: boolean; hasCustomer: boolean
}) {
  const router = useRouter()
  const [sim, setSim] = useState('')
  const [simMode, setSimMode] = useState<'brl' | 'pct'>('brl')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0)
  const now = analyzeOrder(lines, payment.discount + loyaltyDiscount, pricing, loyalty)
  const perLine = analyzeLines(lines, pricing, loyalty)
  const lMsg = customer && customerLoyalty.mode !== 'off' ? loyaltyMessage(customer.name.split(' ')[0], storeName, loyalty, customerLoyalty, fmtBRL) : null
  const lWa = lMsg ? whatsappLink(customer?.phone, lMsg) : null
  const raw = parseMoney(sim) ?? 0
  const extra = simMode === 'pct' ? (now.revenue * Math.min(raw, 100)) / 100 : raw
  const simA = raw > 0 ? analyzeOrder(lines, payment.discount + loyaltyDiscount + extra, pricing, loyalty) : null
  const tone = (contribution: number, marginPct: number) =>
    contribution < 0 ? 'text-negative-700' : marginPct + 1e-9 < pricing.target_margin_pct ? 'text-warn-700' : 'text-positive-700'

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(true); setMsg(null)
    const r = await fn()
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'Não foi possível.' }); return }
    setMsg({ ok: true, text: okText }); setSim(''); router.refresh()
  }

  const applyDiscount = () => run(async () => {
    const r = await updateRetailOrderPayment(orderId, { ...payment, discount: Math.round((payment.discount + extra) * 100) / 100 })
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }, 'Desconto aplicado. A mensagem para a cliente já está atualizada.')

  return (
    <section className="space-y-4 rounded-xl border border-brand-700/30 bg-white p-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Negociação</h2>
        <p className="text-xs text-gray-500">Só a equipe vê. Considera o custo das peças, impostos e taxas{loyalty.enabled && loyalty.mode === 'cashback' ? ', e o cashback que a cliente vai ganhar' : ''}. Frete fica de fora.</p>
      </div>

      {now.missingCost > 0 && (
        <p className="rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">
          {now.missingCost} peça(s) sem custo cadastrado: a conta considera custo zero e o ganho real é menor. Cadastre o custo em Produtos.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-xs text-gray-500">Mantendo o preço</p>
          <p className={`mt-1 text-lg font-semibold ${tone(now.contribution, now.marginPct)}`}>{fmtBRL(now.contribution)}</p>
          <p className="text-xs text-gray-600">de ganho · margem {fmtPct(now.marginPct)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-xs text-gray-500">Mínimo mantendo sua margem ({fmtPct(pricing.target_margin_pct)})</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{fmtBRL(now.minRevenueTarget)}</p>
          <p className="text-xs text-gray-600">{now.minRevenueTarget !== null && now.revenue > now.minRevenueTarget ? `dá para dar até ${fmtBRL(now.revenue - now.minRevenueTarget)} de desconto` : 'já está no limite da margem'}</p>
        </div>
        <div className="rounded-lg border border-negative-600/30 p-3">
          <p className="text-xs text-gray-500">Preço mínimo (sem prejuízo)</p>
          <p className="mt-1 text-lg font-semibold text-negative-700">{fmtBRL(now.minRevenue)}</p>
          <p className="text-xs text-gray-600">desconto máximo: {fmtBRL(now.maxDiscount)}</p>
        </div>
      </div>
      {lines.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium text-gray-900">Ganho por peça</p>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm">
            {lines.map((l, i) => {
              const r = perLine[i]
              return (
                <li key={i} className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{labels[i] ?? 'Peça'}</span>
                    <span className="block text-xs text-gray-500">{l.qty} × {fmtBRL(l.unit_price)}{l.unit_cost !== null ? ` · custo ${fmtBRL(l.unit_cost)} cada` : ' · sem custo cadastrado'}</span>
                  </span>
                  <span className="text-right">
                    {r.contribution === null ? <span className="text-xs text-gray-400">—</span> : (
                      <>
                        <span className={`block font-medium ${tone(r.contribution, r.marginPct ?? 0)}`}>{fmtBRL(r.contribution)}</span>
                        <span className="block text-xs text-gray-500">{fmtPct(r.marginPct)}{l.qty > 1 ? ` · ${fmtBRL(r.unitContribution)} cada` : ''}</span>
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="mt-1 text-xs text-gray-500">Por peça, no preço de tabela. O desconto do pedido entra no total acima.</p>
        </div>
      )}
      <p className="text-xs text-gray-500">Valores das peças, sem frete. Hoje: {fmtBRL(subtotal)} em peças{payment.discount + loyaltyDiscount > 0 ? ` − ${fmtBRL(payment.discount + loyaltyDiscount)} de desconto = ${fmtBRL(now.revenue)}` : ''}.</p>

      {editable && (
        <div className="space-y-2 rounded-lg bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-900">E se ela pedir desconto?</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-gray-300 text-sm">
              <button type="button" onClick={() => setSimMode('brl')} className={`px-3 py-2 ${simMode === 'brl' ? 'bg-brand-700 text-white' : 'bg-white text-gray-700'}`}>R$</button>
              <button type="button" onClick={() => setSimMode('pct')} className={`px-3 py-2 ${simMode === 'pct' ? 'bg-brand-700 text-white' : 'bg-white text-gray-700'}`}>%</button>
            </div>
            <input value={sim} onChange={e => setSim(e.target.value)} inputMode="decimal" placeholder={simMode === 'brl' ? 'ex.: 20,00' : 'ex.: 10'} className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none" />
          </div>
          {simA && (
            <div className="text-sm">
              <p>Com mais {fmtBRL(extra)} de desconto, as peças saem por {fmtBRL(simA.revenue)} e você ganha <strong className={tone(simA.contribution, simA.marginPct)}>{fmtBRL(simA.contribution)}</strong> (margem {fmtPct(simA.marginPct)}).</p>
              {simA.contribution < 0
                ? <p className="mt-1 font-medium text-negative-700">Prejuízo: abaixo do preço mínimo.</p>
                : simA.marginPct + 1e-9 < pricing.target_margin_pct ? <p className="mt-1 text-warn-700">Ainda tem ganho, mas abaixo da sua margem desejada.</p> : null}
              <button type="button" disabled={busy || simA.revenue <= 0} onClick={applyDiscount} className="mt-2 rounded-lg border border-brand-700 bg-white px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">Aplicar este desconto no pedido</button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 border-t border-gray-100 pt-3">
        <p className="text-sm font-medium text-gray-900">Fidelidade da cliente</p>
        {!loyalty.enabled ? (
          <p className="text-sm text-gray-500">Fidelidade desligada. Ligue em <Link href="/varejo/precificacao" className="text-brand-700 hover:underline">Preço e fidelidade</Link>.</p>
        ) : !hasCustomer ? (
          <p className="text-sm text-gray-500">Pedido sem cliente ligada.</p>
        ) : loyaltyDiscount > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>Benefício usado neste pedido ({loyaltyKind === 'cashback' ? 'cashback' : loyaltyKind === 'cada_x' ? 'a cada R$ X' : 'progressivo'}): <strong>{fmtBRL(loyaltyDiscount)}</strong></span>
            {editable && <button type="button" disabled={busy} onClick={() => run(() => removeOrderLoyalty(orderId), 'Benefício retirado.')} className="text-sm text-negative-700 hover:underline">Retirar</button>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {customerLoyalty.mode === 'cashback' && (customerLoyalty.balance > 0
                ? <>Crédito de cashback: <strong>{fmtBRL(customerLoyalty.balance)}</strong> · {fmtBRL(customerLoyalty.expiringAmount)} vence em {fmtDay(customerLoyalty.nextExpiry)}</>
                : 'Sem crédito de cashback válido.')}
              {customerLoyalty.mode === 'cada_x' && (customerLoyalty.available > 0
                ? <>Ganhou <strong>{fmtPct(customerLoyalty.pct)} de desconto</strong> neste pedido.</>
                : <>Já tem {loyaltyUnitText(customerLoyalty.progress, customerLoyalty.unit, fmtBRL)}; falta{customerLoyalty.missing === 1 && customerLoyalty.unit !== 'valor' ? '' : 'm'} {loyaltyUnitText(customerLoyalty.missing, customerLoyalty.unit, fmtBRL)} para ganhar {fmtPct(customerLoyalty.pct)}.</>)}
              {customerLoyalty.mode === 'progressivo' && (customerLoyalty.pct > 0
                ? <>Nível atual: <strong>{fmtPct(customerLoyalty.pct)} de desconto</strong> ({fmtBRL(customerLoyalty.spent12m)} em 12 meses).</>
                : <>Ainda sem desconto ({fmtBRL(customerLoyalty.spent12m)} em 12 meses).</>)}
              {customerLoyalty.mode === 'progressivo' && customerLoyalty.missing !== null && <span className="block text-xs text-gray-500">Faltam {fmtBRL(customerLoyalty.missing)} para {fmtPct(customerLoyalty.nextPct)}.</span>}
            </span>
            {editable && ((customerLoyalty.mode === 'cashback' && customerLoyalty.balance > 0) || (customerLoyalty.mode === 'cada_x' && customerLoyalty.available > 0) || (customerLoyalty.mode === 'progressivo' && customerLoyalty.pct > 0)) && (
              <button type="button" disabled={busy} onClick={() => run(() => applyOrderLoyalty(orderId), 'Benefício aplicado no pedido.')} className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">Usar no pedido</button>
            )}
          </div>
        )}
        {lMsg && (
          <div className="rounded-lg bg-gray-50 px-3 py-2">
            <p className="text-xs text-gray-500">Para avisar a cliente:</p>
            <p className="text-sm text-gray-800">{lMsg}</p>
            {lWa && <a href={lWa} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">Mandar no WhatsApp</a>}
          </div>
        )}
        {loyalty.enabled && loyalty.mode === 'cashback' && <p className="text-xs text-gray-500">Ao marcar Pago, a cliente ganha {fmtPct(loyalty.cashback_pct)} em crédito (válido por {loyalty.cashback_days} dias). Cancelar desfaz.</p>}
      </div>

      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}</p>}
    </section>
  )
}
