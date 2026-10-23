// Primeiros passos do Varejo (servidor): mostra a ordem certa enquanto a loja não terminou.
// 1) Custos e preço (regime e custos) → 2) Peças → 3) Recebimento → 4) Clientes (opcional)
import Link from 'next/link'
import type { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { readTaxRegimes, readPricing } from '@/lib/retail/margin'
import { readPaymentSetup } from '@/lib/retail/payments'

type Db = Awaited<ReturnType<typeof createScopedAdmin>>

export async function RetailSetupGuide({ db, tenantId, only }: { db: Db; tenantId: string; only?: 'produtos' }) {
  const [{ data: org }, { count: products }, { count: customers }] = await Promise.all([
    db.from('organization_settings').select('retail_settings').eq('tenant_id', tenantId).maybeSingle(),
    db.from('retail_products').select('id', { count: 'exact', head: true }).neq('status', 'arquivado'),
    db.from('retail_customers').select('id', { count: 'exact', head: true }),
  ])
  const raw = ((org as { retail_settings?: Record<string, unknown> } | null)?.retail_settings ?? {}) as Record<string, unknown>
  const p = readPricing(raw.pricing)
  const costsDone = readTaxRegimes(raw.tax_regimes).length > 0 && (p.fixed_monthly > 0 || p.card_pct > 0 || p.per_piece > 0 || p.other_pct > 0)
  const pay = readPaymentSetup(raw.payments)
  const steps = [
    { n: 1, done: costsDone, title: 'Custos e preço', text: 'Regime de impostos, taxas, custos fixos do mês e a margem que você quer.', href: '/varejo/precificacao' },
    { n: 2, done: (products ?? 0) > 0, title: 'Cadastrar as peças', text: 'Comece pelo custo: o preço sugerido já sai das suas regras.', href: '/varejo/produtos/nova' },
    { n: 3, done: pay.pix_provider !== 'manual' || pay.card_provider !== 'manual', title: 'Recebimento', text: 'InfinitePay ou Mercado Pago para o link de pagamento (no fim de Custos e preço).', href: '/varejo/precificacao#recebimento' },
    { n: 4, done: (customers ?? 0) > 0, title: 'Clientes (opcional)', text: 'Importe a planilha de clientes ou deixe entrar pelos pedidos.', href: '/varejo/clientes' },
  ]
  if (only === 'produtos') {
    if (costsDone) return null
    return (
      <p className="rounded-xl border border-warn-600/40 bg-warn-100 px-4 py-3 text-sm text-warn-700">
        Antes das peças, faça o passo 1: <Link href="/varejo/precificacao" className="font-medium underline">Custos e preço</Link> (regime de impostos e custos da loja). Assim o preço sugerido de cada peça já sai certo.
      </p>
    )
  }
  if (steps[0].done && steps[1].done && steps[2].done) return null
  const next = steps.find(s => !s.done)
  return (
    <section className="rounded-xl border border-brand-700/30 bg-brand-100/40 p-4">
      <h2 className="text-base font-semibold text-gray-900">Primeiros passos da loja</h2>
      <p className="text-sm text-gray-600">Faça nesta ordem. Cada passo usa o anterior.</p>
      <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {steps.map(s => (
          <li key={s.n}>
            <Link href={s.href} className={`flex gap-3 rounded-lg border bg-white p-3 no-underline hover:border-brand-700 ${next?.n === s.n ? 'border-brand-700' : 'border-gray-200'}`}>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${s.done ? 'bg-positive-100 text-positive-700' : 'bg-brand-700 text-white'}`}>{s.done ? '✓' : s.n}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900">{s.title}{next?.n === s.n ? ' · próximo passo' : ''}</span>
                <span className="block text-xs text-gray-600">{s.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
