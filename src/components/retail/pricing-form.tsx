'use client'

// Varejo → Custos e preço
// 1. Suas peças: toda peça cadastrada entra aqui sozinha, com a precificação completa (busca por código)
// 2. Impostos: regime da loja (vale para todas as peças), com histórico por data
// 3. Custos de cada venda · 4. Margem e custos fixos · 5. Fidelidade
// As contas ficam em margin.ts (testadas); a tela recalcula na hora enquanto ela edita.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { saveRetailPricing, setRetailProductPrice, lookupCnpj, type CnpjInfo } from '@/lib/actions/retail-pricing'
import { effectivePrice, parseMoney } from '@/lib/retail/products'
import { fmtBRL, fmtNum1, fmtPct } from '@/lib/format'
import {
  analyzePrice, breakEvenRevenue, loyaltyCostPct, referencePrice, readLoyalty, readPricing, regimeAt, regimeTax, simplesAnexoIRate,
  TAX_REGIMES, MEI_DAS_2026, MEI_ANNUAL_LIMIT, readPaymentConditions, type PaymentConditions, type LoyaltyMode, type LoyaltySettings, type LoyaltyUnit, type PricingSettings, type TaxRegime, type TaxRegimeId,
} from '@/lib/retail/margin'

export type PricedProduct = { id: string; code: string; name: string; cost: number | null; price: number; promo: number | null; status: string; stock: number }

const lbl = 'mb-1 block text-sm font-medium text-gray-800'
const hint = 'mt-1 text-xs text-gray-500'
const toStr = (n: number) => (n ? String(n).replace('.', ',') : '')
const toNum = (s: string) => parseMoney(s) ?? 0
const pctNum = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const todayBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const regimeLabel = (id: TaxRegimeId) => TAX_REGIMES.find(r => r.id === id)?.label ?? id

const MODES: { id: LoyaltyMode; title: string; text: string }[] = [
  { id: 'cashback', title: 'Cashback em roupas', text: 'Parte do que ela compra vira crédito para a próxima compra, com prazo. Nunca vira dinheiro.' },
  { id: 'cada_x', title: 'A cada X, ganha Y%', text: 'Juntou o valor, as peças ou as compras, ganha um desconto na compra seguinte.' },
  { id: 'progressivo', title: 'Desconto progressivo', text: 'Quanto mais ela compra nos últimos 12 meses, maior o desconto.' },
]
const UNITS: { id: LoyaltyUnit; label: string; amountLabel: string }[] = [
  { id: 'pecas', label: 'Peças compradas', amountLabel: 'A cada (peças)' },
  { id: 'compras', label: 'Número de compras', amountLabel: 'A cada (compras)' },
  { id: 'valor', label: 'Valor comprado', amountLabel: 'A cada (R$ em compras)' },
]

function Field({ label, value, onChange, suffix, prefix, help, disabled, type, placeholder, inputMode }: { label: string; value: string; onChange: (v: string) => void; suffix?: string; prefix?: string; help?: string; disabled?: boolean; type?: string; placeholder?: string; inputMode?: 'decimal' | 'numeric' }) {
  return (
    <div>
      <label className={lbl}>{label}</label>
      <div className="flex items-center rounded-lg border border-gray-300 bg-white focus-within:border-brand-700">
        {prefix && <span className="pl-3 text-sm text-gray-500">{prefix}</span>}
        <input type={type ?? 'text'} className="w-full rounded-lg px-2.5 py-2 text-sm focus:outline-none disabled:bg-gray-50" inputMode={inputMode ?? (type ? undefined : 'decimal')} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder={placeholder ?? '0'} />
        {suffix && <span className="whitespace-nowrap pr-3 text-sm text-gray-500">{suffix}</span>}
      </div>
      {help && <p className={hint}>{help}</p>}
    </div>
  )
}

type Filter = 'todas' | 'sem_custo' | 'abaixo' | 'prejuizo'

function PiecesPricing({ products, P, L, readOnly }: { products: PricedProduct[]; P: PricingSettings; L: LoyaltySettings; readOnly: boolean }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('todas')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [simCost, setSimCost] = useState('')

  const rows = useMemo(() => products.map(p => {
    const selling = effectivePrice({ price: p.price, promo_price: p.promo })
    const cost = p.cost ?? 0
    const a = p.cost !== null && p.cost > 0 ? analyzePrice(selling, cost, P, L) : null
    const ref = p.cost !== null && p.cost > 0 ? referencePrice(cost, P, L) : null
    const state: Filter = !a ? 'sem_custo' : a.contribution < 0 ? 'prejuizo' : a.marginPct + 1e-9 < P.target_margin_pct ? 'abaixo' : 'todas'
    return { p, selling, a, ref, state }
  }), [products, P, L])

  const term = q.trim().toLowerCase()
  const exact = term ? rows.find(r => r.p.code.toLowerCase() === term) : undefined
  const list = rows.filter(r => (filter === 'todas' || r.state === filter) && (!term || r.p.code.toLowerCase().includes(term) || r.p.name.toLowerCase().includes(term)))
  const count = (f: Filter) => rows.filter(r => r.state === f).length
  const shown = exact ? exact.p.id : open

  async function applyPrice(id: string, price: number) {
    setBusy(id); setMsg(null)
    const r = await setRetailProductPrice(id, price)
    setBusy(null)
    if (!r.ok) { setMsg(r.error); return }
    router.refresh()
  }

  const sim = toNum(simCost)
  const simRef = sim > 0 ? referencePrice(sim, P, L) : null

  return (
    <section className="space-y-3 rounded-xl border border-brand-700/30 bg-white p-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">6. Suas peças (confira o resultado)</h2>
        <p className="text-sm text-gray-600">Toda peça cadastrada aparece aqui com a conta completa. Digite o código para ver uma peça.</p>
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Código ou nome da peça (ex.: PC682)" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-700 focus:outline-none" />
      <div className="flex flex-wrap gap-2 text-sm">
        {([['todas', `Todas (${rows.length})`], ['sem_custo', `Sem custo (${count('sem_custo')})`], ['abaixo', `Abaixo da margem (${count('abaixo')})`], ['prejuizo', `Com prejuízo (${count('prejuizo')})`]] as [Filter, string][]).map(([f, label]) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 ${filter === f ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>{label}</button>
        ))}
      </div>
      {msg && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{msg}</p>}

      {products.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">Nenhuma peça cadastrada ainda. Cadastre em <Link href="/varejo/produtos/nova" className="text-brand-700 hover:underline">Produtos → Nova peça</Link>: ela aparece aqui sozinha.</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhuma peça neste filtro.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {list.slice(0, 200).map(({ p, selling, a, ref }) => {
            const isOpen = shown === p.id
            const tone = !a ? 'text-gray-400' : a.contribution < 0 ? 'text-negative-700' : a.marginPct + 1e-9 < P.target_margin_pct ? 'text-warn-700' : 'text-positive-700'
            return (
              <li key={p.id}>
                <button type="button" onClick={() => setOpen(isOpen ? null : p.id)} className="grid w-full grid-cols-[1fr_auto] items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900">{p.name}</span>
                    <span className="block text-xs text-gray-500">{p.code} · vende a {fmtBRL(selling)}{p.cost !== null ? ` · custo ${fmtBRL(p.cost)}` : ''}</span>
                  </span>
                  <span className="text-right">
                    <span className={`block text-sm font-semibold ${tone}`}>{a ? fmtPct(a.marginPct) : 'sem custo'}</span>
                    <span className="block text-xs text-gray-500">{a ? `ganha ${fmtBRL(a.contribution)}` : 'informe o custo'}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-2 bg-gray-50 px-3 pb-3 pt-1 text-sm">
                    {!a ? (
                      <p className="text-gray-600">Sem custo cadastrado, não dá para saber quanto esta peça deixa. <Link href={`/varejo/produtos/${p.id}`} className="text-brand-700 hover:underline">Informar o custo</Link></p>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <div><p className="text-xs text-gray-500">Preço de venda</p><p className="font-medium">{fmtBRL(selling)}{p.promo !== null && p.promo < p.price ? ' (promoção)' : ''}</p></div>
                          <div><p className="text-xs text-gray-500">Markup</p><p className="font-medium">{fmtNum1(a.markup)} ({fmtPct(a.markupPct)})</p></div>
                          <div><p className="text-xs text-gray-500">Impostos, taxas e fidelidade</p><p className="font-medium">{fmtBRL(a.variableCost)}</p></div>
                          <div><p className="text-xs text-gray-500">Mínimo sem prejuízo</p><p className="font-medium">{fmtBRL(a.minPrice)}</p></div>
                        </div>
                        {a.breakEvenUnits !== null && <p className="text-gray-700">{a.breakEvenUnits} peças como esta pagam os custos fixos do mês.</p>}
                        {ref?.ok && (
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
                            <span>Preço de referência para {fmtPct(P.target_margin_pct)} de margem: <strong>{fmtBRL(ref.price)}</strong></span>
                            {!readOnly && Math.abs(ref.price - p.price) >= 0.01 && (
                              <button type="button" disabled={busy === p.id} onClick={() => applyPrice(p.id, ref.price)} className="rounded-lg border border-brand-700 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">{busy === p.id ? 'Aplicando…' : 'Usar este preço na peça'}</button>
                            )}
                          </div>
                        )}
                        {ref && !ref.ok && <p className="text-warn-700">{ref.reason}</p>}
                      </>
                    )}
                    <p className="text-xs text-gray-500">{p.stock} unidade(s) em estoque · <Link href={`/varejo/produtos/${p.id}`} className="text-brand-700 hover:underline">Abrir a peça</Link></p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {list.length > 200 && <p className="text-xs text-gray-500">Mostrando 200 de {list.length}. Use a busca para achar a peça.</p>}

      <details className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-brand-700">Peça que ainda não cadastrou? Simule pelo custo</summary>
        <div className="mt-2 max-w-xs"><Field label="Custo da peça" prefix="R$" value={simCost} onChange={setSimCost} /></div>
        {simRef && (simRef.ok
          ? <p className="mt-2 text-sm">Preço de referência: <strong>{fmtBRL(simRef.price)}</strong> (markup {fmtNum1(simRef.markup)}).</p>
          : <p className="mt-2 text-sm text-warn-700">{simRef.reason}</p>)}
      </details>
    </section>
  )
}

export function PricingForm({ pricing, loyalty, regimes: initialRegimes, rbt12, conditions: initialConditions, products, avgTicket, avgCount, avgPieces, readOnly }: {
  pricing: PricingSettings; loyalty: LoyaltySettings; regimes: TaxRegime[]; rbt12: number; conditions: PaymentConditions; products: PricedProduct[]
  avgTicket: number; avgCount: number; avgPieces: number; readOnly: boolean
}) {
  const router = useRouter()
  const [p, setP] = useState({
    tax_pct: toStr(pricing.tax_pct), card_pct: toStr(pricing.card_pct), other_pct: toStr(pricing.other_pct), per_piece: toStr(pricing.per_piece),
    target_margin_pct: toStr(pricing.target_margin_pct), fixed_monthly: toStr(pricing.fixed_monthly), avg_ticket: toStr(pricing.avg_ticket), avg_pieces: toStr(pricing.avg_pieces),
  })
  const [l, setL] = useState({
    enabled: loyalty.enabled, mode: loyalty.mode, cashback_pct: toStr(loyalty.cashback_pct), cashback_days: String(loyalty.cashback_days),
    every_unit: loyalty.every_unit, every_amount: toStr(loyalty.every_amount), every_pct: toStr(loyalty.every_pct),
    tiers: loyalty.tiers.map(t => ({ min: toStr(t.min), pct: toStr(t.pct) })),
  })
  const [regimes, setRegimes] = useState<TaxRegime[]>(initialRegimes)
  const [cond, setCond] = useState({
    pixOn: initialConditions.pix.enabled, pixDisc: toStr(initialConditions.pix.discount_pct), pixFee: toStr(initialConditions.pix.fee_pct),
    cardOn: initialConditions.card.enabled, cardN: String(initialConditions.card.max_installments), cardFee: toStr(initialConditions.card.fee_pct),
  })
  const [newReg, setNewReg] = useState<{ regime: TaxRegimeId | ''; rate: string; since: string; das: string; outside: string } | null>(initialRegimes.length ? null : { regime: '', rate: '', since: todayBR(), das: toStr(MEI_DAS_2026.comercio), outside: '' })
  const [cnpjErr, setCnpjErr] = useState<string | null>(null)
  const [cnpj, setCnpj] = useState('')
  const [cnpjInfo, setCnpjInfo] = useState<CnpjInfo | null>(null)
  const [cnpjBusy, setCnpjBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const setPf = (k: keyof typeof p) => (v: string) => setP(prev => ({ ...prev, [k]: v }))

  const pending = pendingRegime()
  const allRegimes = pending.r ? [...regimes, pending.r].sort((a, b) => a.since.localeCompare(b.since)) : regimes
  const current = regimeAt(allRegimes, new Date())
  const curTax = current ? regimeTax(current, rbt12) : null
  const P: PricingSettings = useMemo(() => readPricing({
    tax_pct: curTax ? curTax.tax_pct : pctNum(p.tax_pct), card_pct: pctNum(p.card_pct), other_pct: pctNum(p.other_pct), per_piece: toNum(p.per_piece),
    target_margin_pct: pctNum(p.target_margin_pct), fixed_monthly: toNum(p.fixed_monthly) + (curTax?.fixed_extra ?? 0), avg_ticket: toNum(p.avg_ticket), avg_pieces: pctNum(p.avg_pieces),
  }), [p, curTax])
  const L: LoyaltySettings = useMemo(() => readLoyalty({
    enabled: l.enabled, mode: l.mode, cashback_pct: pctNum(l.cashback_pct), cashback_days: Number(l.cashback_days),
    every_unit: l.every_unit, every_amount: l.every_unit === 'valor' ? toNum(l.every_amount) : pctNum(l.every_amount), every_pct: pctNum(l.every_pct),
    tiers: l.tiers.map(t => ({ min: toNum(t.min), pct: pctNum(t.pct) })), changed_at: loyalty.changed_at,
  }), [l, loyalty.changed_at])

  const loyaltyPct = loyaltyCostPct(L, P.avg_ticket, P.avg_pieces)
  const monthRevenue = breakEvenRevenue(P.fixed_monthly, P.target_margin_pct)
  const unit = UNITS.find(u => u.id === l.every_unit)!

  // Regime escolhido e ainda não salvo: entra junto no "Salvar" (não precisa de outro botão)
  function pendingRegime(): { r: TaxRegime | null; error: string | null } {
    if (!newReg || !newReg.regime) return { r: null, error: null }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newReg.since)) return { r: null, error: 'Informe a data de início do regime.' }
    if (regimes.some(r => r.since === newReg.since)) return { r: null, error: 'Já existe um regime começando nessa data. Mude a data ou tire o outro.' }
    const r: TaxRegime = newReg.regime === 'mei' ? { regime: 'mei', rate_pct: 0, since: newReg.since, das_monthly: toNum(newReg.das) || MEI_DAS_2026.comercio }
      : newReg.regime === 'simples' ? { regime: 'simples', rate_pct: 0, since: newReg.since, outside_revenue_12m: toNum(newReg.outside) }
      : { regime: newReg.regime, rate_pct: pctNum(newReg.rate), since: newReg.since }
    if ((r.regime === 'presumido' || r.regime === 'outro') && !(r.rate_pct > 0)) return { r: null, error: 'Informe o percentual de impostos sobre a venda.' }
    return { r, error: null }
  }

  async function save() {
    setBusy(true); setMsg(null)
    const conditions = readPaymentConditions({ pix: { enabled: cond.pixOn, discount_pct: pctNum(cond.pixDisc), fee_pct: pctNum(cond.pixFee) }, card: { enabled: cond.cardOn, max_installments: Number(cond.cardN) || 1, fee_pct: pctNum(cond.cardFee) } })
    if (pending.error) { setBusy(false); setMsg({ ok: false, text: `Impostos: ${pending.error}` }); return }
    const r = await saveRetailPricing({ pricing: P, loyalty: L, regimes: allRegimes, conditions })
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    if (pending.r) { setRegimes(allRegimes); setNewReg(null) }
    setMsg({ ok: true, text: 'Salvo. Peças, pedidos e o painel já usam estes valores.' }); router.refresh()
  }

  return (
    <div className="space-y-4">
      {readOnly && <p className="rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">Só o administrador da empresa altera estes valores.</p>}


      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">1. Impostos da loja</h2>
          <p className="text-sm text-gray-600">MEI e Simples são calculados pelo faturado da loja, não por peça. Mudou de regime? Cadastre o novo com a data: as vendas antigas continuam com o regime da época.</p>
        </div>
        {current && curTax ? (
          <div className="space-y-1 rounded-lg bg-brand-100/60 px-3 py-2 text-sm text-brand-800">
            <p>Hoje: <strong>{regimeLabel(current.regime)}</strong>, desde {fmtDay(current.since)}.</p>
            {current.regime === 'mei' && <p>Imposto fixo (DAS) de <strong>{fmtBRL(curTax.fixed_extra)} por mês</strong>, já somado aos custos fixos. Nas vendas: 0%.</p>}
            {current.regime === 'simples' && <p>Faturamento dos últimos 12 meses: {fmtBRL(curTax.rbt12)} ({fmtBRL(rbt12)} vendido no Drone{current.outside_revenue_12m ? ` + ${fmtBRL(current.outside_revenue_12m)} fora` : ''}). Alíquota efetiva: <strong>{fmtPct(curTax.tax_pct)}</strong>, recalculada sozinha.</p>}
            {(current.regime === 'presumido' || current.regime === 'outro') && <p>{fmtPct(curTax.tax_pct)} sobre cada venda.</p>}
            {current.regime === 'mei' && curTax.overLimit && <p className="text-warn-700">As vendas dos últimos 12 meses passaram de {fmtBRL(MEI_ANNUAL_LIMIT)}, o limite do MEI. Fale com o contador.</p>}
            {current.regime === 'simples' && curTax.overLimit && <p className="text-warn-700">Faturamento acima de R$ 4.800.000,00: fora do Simples. Fale com o contador.</p>}
          </div>
        ) : (
          <p className="rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">
            Nenhum regime cadastrado.{pctNum(p.tax_pct) > 0 ? ` Por enquanto a conta usa ${fmtPct(pctNum(p.tax_pct))}, informado antes.` : ' Por enquanto a conta usa 0% de imposto.'}
          </p>
        )}
        {regimes.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm">
            {[...regimes].reverse().map(r => (
              <li key={r.since} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>{regimeLabel(r.regime)}{r.regime === 'mei' ? ` · DAS ${fmtBRL(r.das_monthly)}/mês` : r.regime === 'simples' ? ' · pelo faturamento' : ` · ${fmtPct(r.rate_pct)}`} · a partir de {fmtDay(r.since)}{current?.since === r.since ? <span className="ml-2 rounded bg-positive-100 px-1.5 py-0.5 text-[11px] text-positive-700">em vigor</span> : null}</span>
                {!readOnly && <button type="button" onClick={() => setRegimes(prev => prev.filter(x => x.since !== r.since))} className="text-xs text-negative-700 hover:underline">Tirar</button>}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (newReg ? (
          <div className="space-y-3 rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1"><Field label="CNPJ da loja (opcional)" value={cnpj} onChange={setCnpj} placeholder="00.000.000/0000-00" inputMode="numeric" help="Buscamos na Receita o CNAE e se a empresa é MEI ou Simples." /></div>
              <button type="button" disabled={cnpjBusy || cnpj.replace(/\D/g, '').length !== 14} onClick={async () => { setCnpjBusy(true); setCnpjErr(null); setCnpjInfo(null); const r = await lookupCnpj(cnpj); setCnpjBusy(false); if (!r.ok) { setCnpjErr(r.error); return } setCnpjInfo(r.info); if (r.info.suggested) setNewReg(prev => prev && { ...prev, regime: r.info.suggested! }) }}
                className="mb-5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 disabled:opacity-40">{cnpjBusy ? 'Buscando…' : 'Buscar'}</button>
            </div>
            {cnpjErr && <p role="alert" className="rounded-lg bg-warn-100 px-3 py-2 text-xs text-warn-700">{cnpjErr}</p>}
            {cnpjInfo && (
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700">
                <p><strong>{cnpjInfo.name}</strong>{cnpjInfo.uf ? ` · ${cnpjInfo.uf}` : ''}</p>
                {cnpjInfo.cnae && <p>CNAE {cnpjInfo.cnae}{cnpjInfo.cnaeText ? ` · ${cnpjInfo.cnaeText}` : ''}</p>}
                <p>{cnpjInfo.mei === true ? 'Optante pelo MEI.' : cnpjInfo.simples === true ? 'Optante pelo Simples Nacional.' : cnpjInfo.simples === false ? 'Não optante pelo Simples (provavelmente Lucro Presumido ou Real).' : 'A Receita não informou a opção pelo Simples/MEI.'}{cnpjInfo.retail ? ' Comércio varejista: no Simples, tabela do comércio (Anexo I).' : ''}</p>
                <p className="text-gray-500">O CNAE diz o tipo de atividade, não o valor do imposto: no Lucro Presumido o percentual depende do estado (ICMS) e de cada produto. Confirme com o contador.</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TAX_REGIMES.map(r => (
                <button key={r.id} type="button" onClick={() => setNewReg(prev => prev && { ...prev, regime: r.id })}
                  className={`rounded-lg border px-2 py-2 text-sm ${newReg.regime === r.id ? 'border-brand-700 bg-brand-100/50 font-medium' : 'border-gray-200'}`}>{r.label}</button>
              ))}
            </div>
            <p className={hint}>{newReg.regime ? TAX_REGIMES.find(r => r.id === newReg.regime)?.hint : 'Toque no regime da loja (o contador sabe; ou busque pelo CNPJ acima).'}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {newReg.regime === 'mei' && (
                <div>
                  <Field label="DAS do mês" prefix="R$" value={newReg.das} onChange={v => setNewReg(prev => prev && { ...prev, das: v })} />
                  <div className="mt-1 flex flex-wrap gap-1 text-xs">
                    {([['Comércio', MEI_DAS_2026.comercio], ['Serviços', MEI_DAS_2026.servicos], ['Comércio e serviços', MEI_DAS_2026.ambos]] as [string, number][]).map(([l, v]) => (
                      <button key={l} type="button" onClick={() => setNewReg(prev => prev && { ...prev, das: toStr(v) })} className="rounded-full border border-gray-300 px-2 py-0.5">{l}: {fmtBRL(v)}</button>
                    ))}
                  </div>
                  <p className={hint}>Valores de 2026 (5% do salário mínimo de R$ 1.621,00 + ICMS/ISS). Mudam todo ano com o salário mínimo.</p>
                </div>
              )}
              {newReg.regime === 'simples' && (
                <div>
                  <Field label="Vendas fora do Drone nos últimos 12 meses" prefix="R$" value={newReg.outside} onChange={v => setNewReg(prev => prev && { ...prev, outside: v })} />
                  <p className={hint}>Loja física, outro sistema ou antes de começar a usar o Drone. Junto com o que já foi vendido aqui ({fmtBRL(rbt12)}), dá o faturamento de 12 meses.</p>
                  {(() => { const r = simplesAnexoIRate(rbt12 + toNum(newReg.outside)); return r ? <p className="mt-1 text-sm text-gray-700">{r.faixa}ª faixa: alíquota efetiva de <strong>{fmtPct(r.effective)}</strong> (nominal {fmtPct(r.nominal)}, menos {fmtBRL(r.deduct)}).</p> : rbt12 + toNum(newReg.outside) > 0 ? <p className="mt-1 text-sm text-warn-700">Acima de R$ 4.800.000,00: fora do Simples.</p> : <p className="mt-1 text-sm text-gray-700">Sem faturamento ainda: começa na 1ª faixa (4,0%).</p> })()}
                </div>
              )}
              {(newReg.regime === 'presumido' || newReg.regime === 'outro') && <Field label="Imposto sobre a venda" suffix="%" value={newReg.rate} onChange={v => setNewReg(prev => prev && { ...prev, rate: v })} help="O total que o contador informar." />}
              <Field label="Vale a partir de" type="date" value={newReg.since} onChange={v => setNewReg(prev => prev && { ...prev, since: v })} />
            </div>
            {newReg.regime === 'simples' && <p className={hint}>Conta da LC 123/2006, Anexo I (comércio): (faturamento × alíquota nominal − parcela a deduzir) ÷ faturamento. Não considera ICMS por substituição tributária nem outras particularidades: confirme com o contador.</p>}
            <div className="flex flex-wrap items-center gap-2">
              {newReg.regime && <p className="text-xs text-brand-800">{pending.error ? <span className="text-warn-700">{pending.error}</span> : <>Pronto: o regime entra quando você tocar em <strong>Salvar</strong>, no fim da tela.</>}</p>}
              {regimes.length > 0 && <button type="button" onClick={() => setNewReg(null)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">Cancelar</button>}
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setNewReg({ regime: '', rate: '', since: todayBR(), das: toStr(MEI_DAS_2026.comercio), outside: '' })} className="text-sm text-brand-700 hover:underline">+ Mudei de regime</button>
        ))}
      </section>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">2. Outros custos de cada venda</h2>
          <p className="text-sm text-gray-600">Acontecem toda vez que uma peça é vendida.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Taxa do cartão / link" suffix="%" value={p.card_pct} onChange={setPf('card_pct')} disabled={readOnly} help="Média do que a maquininha ou o link cobra." />
          <Field label="Outros por venda" suffix="%" value={p.other_pct} onChange={setPf('other_pct')} disabled={readOnly} help="Comissão, anúncio por venda…" />
          <Field label="Custo por peça" prefix="R$" value={p.per_piece} onChange={setPf('per_piece')} disabled={readOnly} help="Embalagem, sacola, etiqueta." />
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">3. Formas de pagamento</h2>
          <p className="text-sm text-gray-600">Aparecem em "Finalizar compra" para a cliente escolher. A taxa de cada uma muda o seu ganho, e o pedido mostra o ganho em cada forma.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className={`space-y-3 rounded-lg border p-3 ${cond.pixOn ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-900"><input type="checkbox" checked={cond.pixOn} disabled={readOnly} onChange={e => setCond(c => ({ ...c, pixOn: e.target.checked }))} /> Pix à vista</label>
            <Field label="Desconto no Pix" suffix="%" value={cond.pixDisc} onChange={v => setCond(c => ({ ...c, pixDisc: v }))} disabled={readOnly} />
            <Field label="Taxa do Pix" suffix="%" value={cond.pixFee} onChange={v => setCond(c => ({ ...c, pixFee: v }))} disabled={readOnly} help="Se o banco ou o link cobrar. Em geral, 0%." />
          </div>
          <div className={`space-y-3 rounded-lg border p-3 ${cond.cardOn ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-900"><input type="checkbox" checked={cond.cardOn} disabled={readOnly} onChange={e => setCond(c => ({ ...c, cardOn: e.target.checked }))} /> Cartão</label>
            <Field label="Parcelas sem juros (até)" suffix="x" value={cond.cardN} onChange={v => setCond(c => ({ ...c, cardN: v.replace(/\D/g, '') }))} disabled={readOnly} />
            <Field label="Taxa do cartão nesse parcelamento" suffix="%" value={cond.cardFee} onChange={v => setCond(c => ({ ...c, cardFee: v }))} disabled={readOnly} help="O que a maquininha ou o link cobra para parcelar sem juros para a cliente." />
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">4. Quanto você quer ganhar</h2>
          <p className="text-sm text-gray-600"><strong>Margem</strong> é quanto sobra do <strong>preço de venda</strong> depois de pagar a peça e os custos da venda. <strong>Markup</strong> é quanto você multiplica o <strong>custo</strong>. Não são a mesma coisa.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Margem desejada" suffix="%" value={p.target_margin_pct} onChange={setPf('target_margin_pct')} disabled={readOnly} help="O que sobra para pagar as contas do mês e dar lucro." />
          <Field label="Custos fixos do mês" prefix="R$" value={p.fixed_monthly} onChange={setPf('fixed_monthly')} disabled={readOnly} help={`Aluguel, salários, contador, sistemas.${curTax?.fixed_extra ? ` O DAS do MEI (${fmtBRL(curTax.fixed_extra)}) já entra sozinho.` : ''}`} />
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
            <h2 className="text-base font-semibold text-gray-900">5. Fidelidade</h2>
            <p className="text-sm text-gray-600">Cada venda paga fica gravada na cliente. Dá para desligar num mês e religar depois: desligada, ninguém ganha nem usa benefício.</p>
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
            <div className="space-y-3">
              <div>
                <p className={lbl}>O que conta</p>
                <div className="flex flex-wrap gap-2">
                  {UNITS.map(u => (
                    <button key={u.id} type="button" disabled={readOnly} onClick={() => setL(prev => ({ ...prev, every_unit: u.id, every_amount: u.id === 'valor' ? '1000' : u.id === 'pecas' ? '5' : '4' }))}
                      className={`rounded-full px-3 py-1 text-sm ${l.every_unit === u.id ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>{u.label}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={unit.amountLabel} prefix={l.every_unit === 'valor' ? 'R$' : undefined} value={l.every_amount} onChange={v => setL(prev => ({ ...prev, every_amount: prev.every_unit === 'valor' ? v : v.replace(/\D/g, '') }))} disabled={readOnly} />
                <Field label="Ganha de desconto na próxima compra" suffix="%" value={l.every_pct} onChange={v => setL(prev => ({ ...prev, every_pct: v }))} disabled={readOnly} />
              </div>
              <p className="text-sm text-gray-700">
                Exemplo: {l.every_unit === 'pecas' ? `a cada ${L.every_amount} peças compradas` : l.every_unit === 'compras' ? `a cada ${L.every_amount} compras` : `a cada ${fmtBRL(L.every_amount)} em compras`}, ela ganha {fmtPct(L.every_pct)} de desconto na compra seguinte. A compra com desconto também conta.
              </p>
              {l.every_unit === 'valor' && (
                <Field label="Valor médio de uma compra (para a conta)" prefix="R$" value={p.avg_ticket} onChange={setPf('avg_ticket')} disabled={readOnly}
                  help={avgCount ? `A média dos seus ${avgCount} pedidos pagos é ${fmtBRL(avgTicket)}.` : 'Ainda não há pedidos pagos. Em branco, a conta considera uma compra igual ao valor X.'} />
              )}
              {l.every_unit === 'pecas' && (
                <Field label="Peças por compra, em média (para a conta)" value={p.avg_pieces} onChange={setPf('avg_pieces')} disabled={readOnly}
                  help={avgCount ? `Nos seus pedidos pagos, a média é ${fmtNum1(avgPieces)} peça(s) por compra.` : 'Ainda não há pedidos pagos. Em branco, a conta considera 1 peça por compra.'} />
              )}
              {loyalty.mode === 'cada_x' && (loyalty.every_unit !== L.every_unit || loyalty.every_amount !== L.every_amount) && (
                <p className="rounded-lg bg-warn-100 px-3 py-2 text-xs text-warn-700">Ao salvar a regra nova, a contagem das clientes recomeça do zero (compras antigas não viram prêmio na regra nova).</p>
              )}
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
              ? <>A fidelidade custa até <strong>{fmtPct(loyaltyPct)}</strong> do preço, e isso já entra no preço de referência das peças. {L.mode === 'cashback' ? 'Considera que toda cliente usa o crédito (o cenário mais caro).' : L.mode === 'progressivo' ? 'Considera o maior desconto da escada (o cenário mais caro).' : 'É uma média: desconto × quanto de cada prêmio sai por compra.'}</>
              : 'Desligada: não entra no preço e ninguém ganha benefício.'}
          </p>
        </div>
      </section>

      <PiecesPricing products={products} P={P} L={L} readOnly={readOnly} />

      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}</p>}
      {!readOnly && (
        <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-gray-200 bg-white/95 py-3">
          <span className="text-xs text-gray-500">Preencha de 1 a 5 e toque em Salvar. A lista de peças (6) já mostra o efeito antes.</span>
          <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      )}
    </div>
  )
}
