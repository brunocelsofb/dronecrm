// GET /api/whatsapp/instance-status?instance=<nome> → { status: 'open' | 'close' | 'connecting' | 'error' }
// Usado pela lista de instâncias em Configurações → Conexões. Só administradores.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { getEvoInstanceStatus } from '@/lib/whatsapp/evolution'
import { resolveTenantId } from '@/lib/tenant/context'
import { withPlatformEvo } from '@/lib/whatsapp/tenant-evo'
import { canTenantUseInstance } from '@/lib/whatsapp/tenant-evo'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function GET(request: Request) {
  if (!(await isCurrentUserAdmin())) return NextResponse.json({ status: 'error', error: 'Acesso negado' }, { status: 403 })

  const instance = new URL(request.url).searchParams.get('instance')
  if (!instance) return NextResponse.json({ status: 'error', error: 'instance obrigatório' }, { status: 400 })
  if (!(await canTenantUseInstance(await resolveTenantId(), instance))) return NextResponse.json({ status: 'error', error: 'instância não encontrada' }, { status: 404 })

  const { data: org__raw } = await (await createScopedAdmin())
    .from('organization_settings')
    .select('evo_server_url, evo_api_key')
    .eq('tenant_id', await resolveTenantId())
    .maybeSingle()
  const org = withPlatformEvo(org__raw)
  if (!org?.evo_server_url || !org?.evo_api_key) {
    return NextResponse.json({ status: 'error', error: 'Evolution API não configurada' })
  }

  const { state } = await getEvoInstanceStatus({
    serverUrl: org.evo_server_url.replace(/\/$/, ''),
    apiKey: org.evo_api_key,
    instanceName: encodeURIComponent(instance),
  })
  return NextResponse.json({ status: state ?? 'error' })
}
