import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantId } from '@/lib/tenant/context'
import { isCurrentUserAdmin } from '@/lib/auth/role'

// Configurações → ZapSign: token da API e ambiente (produção ou teste). Só Admin.
export async function POST(request: Request) {
  if (!(await isCurrentUserAdmin())) return NextResponse.redirect(new URL('/settings?zapsign=sem-permissao', request.url), 303)
  const supabase = await createClient()
  const formData = await request.formData()
  const token = (formData.get('zapsign_api_token') as string | null)?.trim().replace(/^bearer\s+/i, '')
  const env = formData.get('zapsign_env') === 'sandbox' ? 'sandbox' : 'producao'

  const patch: Record<string, string> = { zapsign_env: env }
  if (token) patch.zapsign_api_token = token
  await supabase.from('organization_settings').update(patch).eq('tenant_id', await resolveTenantId())

  return NextResponse.redirect(new URL('/settings', request.url), 303)
}
