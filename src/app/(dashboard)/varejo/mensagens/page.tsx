import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { readTemplates } from '@/lib/retail/order-messages'
import { MessageTemplatesForm } from '@/components/retail/message-templates-form'

export const dynamic = 'force-dynamic'

export default async function RetailMessagesPage() {
  const access = await hasFeature('varejo')
  if (!access) redirect('/')
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data: org } = await db.from('organization_settings').select('retail_settings').eq('tenant_id', tenantId).maybeSingle()
  const templates = readTemplates((org?.retail_settings as Record<string, unknown> | null)?.messages)
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href="/varejo/configurar" className="block text-sm text-brand-700 hover:underline">← Configurar loja</Link>
        <h1 className="text-xl font-semibold text-gray-900">Mensagens do pedido</h1>
        <p className="text-sm text-gray-600">Os textos que o Drone prepara em cada etapa do pedido. Ninguém recebe nada sozinho: no pedido, a equipe revisa, ajusta se quiser e envia pelo WhatsApp (e por e-mail, se escolher).</p>
      </div>
      <MessageTemplatesForm initial={templates} canEdit={access.isAdmin} />
    </div>
  )
}
