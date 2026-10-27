import Link from 'next/link'
import { suggestGroups } from '@/lib/retail/merge'
import { needsSplit } from '@/lib/retail/split'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { requireTenantId } from '@/lib/tenant/context'
import { RetailSetupGuide } from '@/components/retail/setup-guide'
import { fmtBRL } from '@/lib/format'
import { PRODUCT_STATUSES, effectivePrice, retailPhotoUrl, totalStock } from '@/lib/retail/products'
import { ProductImport } from '@/components/retail/product-import'
import { fmtPct } from '@/lib/format'
import { loadPricingConfig } from '@/lib/retail/loyalty-server'
import { analyzePrice, pricingAt, readPricing, requiredMarginPct } from '@/lib/retail/margin'

// Mesmas cores de Custos e preço: verde = margem ok, laranja = abaixo da margem, vermelho = prejuízo
const MARGIN_TONE = {
  ok: { card: 'border-l-4 border-l-positive-600', text: 'text-positive-700', bg: 'bg-positive-100' },
  abaixo: { card: 'border-l-4 border-l-warn-600', text: 'text-warn-700', bg: 'bg-warn-100' },
  prejuizo: { card: 'border-l-4 border-l-negative-600', text: 'text-negative-700', bg: 'bg-negative-100' },
  sem: { card: 'border-l-4 border-l-gray-300', text: 'text-gray-500', bg: 'bg-gray-100' },
} as const

export const dynamic = 'force-dynamic'

type Row = {
  id: string; code: string; name: string; category: string | null; price: number | null; promo_price: number | null; cost_price: number | null
  status: string; photos: string[] | null
  retail_product_variants: { stock: number; active: boolean; color?: string | null; size?: string | null }[] | null
}

const STATUS_STYLE: Record<string, string> = {
  publicado: 'bg-positive-100 text-positive-700',
  rascunho: 'bg-warn-100 text-warn-700',
  arquivado: 'bg-gray-100 text-gray-500',
}

export default async function RetailProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; categoria?: string; situacao?: string }> }) {
  if (!(await hasFeature('varejo'))) redirect('/')
  const { q = '', categoria = '', situacao = '' } = await searchParams
  const db = await createScopedAdmin()
  const { data } = await db.from('retail_products')
    .select('id, code, name, category, price, promo_price, cost_price, status, photos, retail_product_variants(stock, active, color, size)')
    .order('name')
  const all = (data ?? []) as unknown as Row[]
  const cfg = await loadPricingConfig(db, await requireTenantId())
  const P = pricingAt(readPricing(cfg.raw.pricing), cfg.regimes, new Date(), cfg.rbt12)
  const minMargin = requiredMarginPct(P)
  const marginOf = (p: Row) => {
    if (p.price === null) return { key: 'sem' as const, label: 'sem preço', sub: 'defina o preço' }
    const selling = effectivePrice({ price: Number(p.price), promo_price: p.promo_price === null ? null : Number(p.promo_price) })
    if (p.cost_price === null || !(Number(p.cost_price) > 0)) return { key: 'sem' as const, label: 'sem custo', sub: 'informe o custo' }
    const a = analyzePrice(selling, Number(p.cost_price), P, cfg.loyalty)
    const key = a.contribution < 0 ? 'prejuizo' as const : a.marginPct + 1e-9 < minMargin ? 'abaixo' as const : 'ok' as const
    return { key, label: `margem ${fmtPct(a.marginPct)}`, sub: key === 'prejuizo' ? `perde ${fmtBRL(-a.contribution)}` : `ganha ${fmtBRL(a.contribution)}` }
  }
  const categories = [...new Set(all.map(p => p.category).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const term = q.trim().toLowerCase()
  const list = all.filter(p =>
    (!term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term)) &&
    (!categoria || p.category === categoria) &&
    (!situacao || p.status === situacao))
  const noPrice = all.filter(p => p.price === null && p.status !== 'arquivado')
  const sameName = suggestGroups(all)
  const combined = all.filter(p => p.status !== 'arquivado' && (p.retail_product_variants ?? []).some(v => needsSplit(v.color ?? null, v.size ?? null)))
  const withoutStock = all.filter(p => p.status === 'publicado' && totalStock(p.retail_product_variants ?? []) === 0).length

  return (
    <div className="space-y-5">
      <RetailSetupGuide db={db} tenantId={await requireTenantId()} only="produtos" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Produtos</h1>
          <p className="mt-1 text-sm text-gray-500">Peças da vitrine, com preço, fotos e estoque por cor e tamanho.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/varejo/estoque" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Histórico do estoque</Link>
          <Link href="/varejo/produtos/juntar" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Juntar cores</Link>
          <a href="/api/varejo/modelo" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Baixar planilha-modelo</a>
          <ProductImport mode="cadastro" />
          <ProductImport mode="entrada" />
          <Link href="/varejo/produtos/nova" className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">Nova peça</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Peças" value={String(all.length)} />
        <Stat label="Publicadas" value={String(all.filter(p => p.status === 'publicado').length)} />
        <Stat label="Unidades em estoque" value={String(all.filter(p => p.status !== 'arquivado').reduce((s, p) => s + totalStock(p.retail_product_variants ?? []), 0))} />
        <Stat label="Publicadas sem estoque" value={String(withoutStock)} tone={withoutStock ? 'warn' : undefined} />
      </div>
      {combined.length > 0 && (
        <p className="rounded-lg border border-warn-700/30 bg-warn-100 px-3 py-2 text-sm text-warn-700">
          {combined.length === 1 ? '1 peça tem' : `${combined.length} peças têm`} várias cores ou tamanhos na mesma linha da planilha (ex.: &quot;Dark Blue / Mocha Mousse&quot;): na vitrine viram uma cor só e o estoque fica errado. <Link href="/varejo/produtos/separar" className="font-medium underline">Separar cores e tamanhos</Link>
        </p>
      )}
      {sameName.length > 0 && (
        <p className="rounded-lg border border-brand-700/30 bg-brand-100/50 px-3 py-2 text-sm text-gray-800">
          {sameName.length === 1 ? '1 peça aparece' : `${sameName.length} peças aparecem`} em mais de um cadastro com o mesmo nome (uma cor por código): {sameName.slice(0, 4).map(g => g[0].name).join(', ')}{sameName.length > 4 ? '…' : ''}. <Link href="/varejo/produtos/juntar" className="font-medium text-brand-700 underline">Juntar cores</Link> deixa cada uma numa linha só, com as cores na vitrine.
        </p>
      )}
      {noPrice.length > 0 && (
        <p className="rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">
          {noPrice.length === 1 ? '1 peça está sem preço' : `${noPrice.length} peças estão sem preço`} (vieram da planilha assim). Ficam em rascunho e não vendem nem aparecem na vitrine até ter preço: {noPrice.slice(0, 6).map(p => p.code).join(', ')}{noPrice.length > 6 ? '…' : ''}.
        </p>
      )}

      <form className="flex flex-wrap gap-2" method="get">
        <input name="q" defaultValue={q} placeholder="Buscar por nome ou código" className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select name="categoria" defaultValue={categoria} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Todas as categorias</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select name="situacao" defaultValue={situacao} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Todas as situações</option>
          {PRODUCT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Filtrar</button>
      </form>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
          {all.length === 0 ? (
            <div className="mx-auto max-w-md text-left">
              <p className="text-base font-medium text-gray-900">Comece pela primeira peça</p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-gray-600">
                <li>Toque em <strong>Nova peça</strong> e preencha nome, código e preço.</li>
                <li>Diga as cores e os tamanhos e quantas unidades tem de cada.</li>
                <li>Adicione as fotos.</li>
                <li>Escolha <strong>Publicada</strong> para aparecer na vitrine.</li>
              </ol>
              <p className="mt-3 text-xs text-gray-500">Muitas peças? Baixe a planilha-modelo, preencha e importe tudo de uma vez.</p>
              <Link href="/varejo/produtos/nova" className="mt-4 inline-block rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">Nova peça</Link>
            </div>
          ) : 'Nenhuma peça encontrada com esses filtros.'}
        </div>
      ) : (
        <>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
          <span>Margem pelas regras de <Link href="/varejo/precificacao" className="text-brand-700 hover:underline">Custos e preço</Link> (mínimo {fmtPct(minMargin)}):</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-positive-600" />ok</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-warn-600" />abaixo da margem</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-negative-600" />prejuízo</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-gray-300" />sem custo ou sem preço</span>
        </p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(p => {
            const stock = totalStock(p.retail_product_variants ?? [])
            const price = p.price === null ? null : effectivePrice({ price: Number(p.price), promo_price: p.promo_price === null ? null : Number(p.promo_price) })
            const cover = (p.photos ?? [])[0]
            const m = marginOf(p)
            const tone = MARGIN_TONE[m.key]
            return (
              <li key={p.id}>
                <Link href={`/varejo/produtos/${p.id}`} className={`flex gap-3 rounded-xl border border-gray-200 bg-white p-3 hover:border-brand-700/40 ${tone.card}`}>
                  <div className="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {cover ? <img src={retailPhotoUrl(cover)} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-[10px] text-gray-400">sem foto</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{p.name}</p>
                    <p className="text-xs text-gray-500">{p.code}{p.category ? ` · ${p.category}` : ''}</p>
                    <p className="mt-1 text-sm text-gray-900">
                      {price === null ? <span className="rounded bg-warn-100 px-1.5 py-0.5 text-xs font-medium text-warn-700">Sem preço: defina antes de vender</span> : <>
                        {fmtBRL(price)}
                        {p.price !== null && price < Number(p.price) && <span className="ml-1 text-xs text-gray-400 line-through">{fmtBRL(Number(p.price))}</span>}
                      </>}
                    </p>
                    <p className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${tone.bg} ${tone.text}`}>{m.label} · {m.sub}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLE[p.status] ?? ''}`}>{PRODUCT_STATUSES.find(s => s.id === p.status)?.label ?? p.status}</span>
                      <span className={`text-xs ${stock === 0 ? 'text-warn-700' : 'text-gray-500'}`}>{stock === 0 ? 'Estoque zerado · toque para informar' : `${stock} un.`}</span>
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === 'warn' ? 'border-warn-600/40 bg-warn-100' : 'border-gray-200 bg-white'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone === 'warn' ? 'text-warn-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}
