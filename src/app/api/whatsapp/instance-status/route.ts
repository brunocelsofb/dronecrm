// GET /api/whatsapp/instance-status?instance=<nome> → { status: 'open' | 'close' | 'connecting' | 'error' }
// Usado pela lista de instâncias em Configurações → Conexões. Só administradores.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { getEvoInstanceStatus } from '@/lib/whatsapp/evolution'

export async function GET(request: Request) {
  if (!(await isCurrentUserAdmin())) return NextResponse.json({ status: 'error', error: 'Acesso negado' }, { status: 403 })

  const instance = new URL(request.url).searchParams.get('instance')
  if (!instance) return NextResponse.json({ status: 'error', error: 'instance obrigatório' }, { status: 400 })

  const { data: org } = await createAdminClient()
    .from('organization_settings')
    .select('evo_server_url, evo_api_key')
    .eq('id', 'default')
    .maybeSingle()
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
