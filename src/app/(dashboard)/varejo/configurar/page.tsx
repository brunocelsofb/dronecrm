import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { ResetStore } from '@/components/retail/reset-store'

export const dynamic = 'force-dynamic'

// Configurar loja: o que se ajusta uma vez (vitrine, custos e preço, mensagens) e o "zerar a loja"
export default async function RetailConfigPage() {
  const access = await hasFeature('varejo')
  if (!access) redirect('/')
  const support = await getSupportSession()
  const db = await createScopedAdmin()
  const [{ count: pecas }, { count: pedidos }, { count: ia }] = await Promise.all([
    db.from('retail_products').select('id', { count: 'exact', head: true }),
    db.from('retail_orders').select('id', { count: 'exact', head: true }),
    db.from('retail_ai_images').select('id', { count: 'exact', head: true }),
  ])
  const cards = [
    { href: '/varejo/vitrine', title: 'Vitrine', text: 'Aparência do site: capa, cores, textos, ocasiões, looks e políticas.' },
    { href: '/varejo/precificacao', title: 'Custos e preço', text: 'Impostos, taxas, custos fixos, margem e fidelidade. O preço de referência das peças sai daqui.' },
    { href: '/varejo/mensagens', title: 'Mensagens do pedido', text: 'Textos que o Drone prepara em cada etapa do pedido (WhatsApp e e-mail).' },
  ]
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Configurar loja</h1>
        <p className="text-sm text-gray-600">O que se ajusta uma vez e quase não muda.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map(c => (
          <Link key={c.href} href={c.href} className="rounded-xl border border-gray-200 bg-white p-4 hover:border-brand-700">
            <p className="text-sm font-semibold text-gray-900">{c.title}</p>
            <p className="mt-1 text-xs text-gray-600">{c.text}</p>
          </Link>
        ))}
      </div>
      {access.isAdmin && !support && <ResetStore pecas={pecas ?? 0} pedidos={pedidos ?? 0} ia={ia ?? 0} />}
    </div>
  )
}
