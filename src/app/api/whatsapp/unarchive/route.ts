import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { unarchiveWhatsAppConversation } from '@/lib/actions/whatsapp'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  // Ler tenant ativo: cookie (Route Handlers) ou header (Server Actions)
  const tenantId = await getActiveTenantId()

  // Fail-fast: se o cookie de impersonation existe mas tenantId não foi resolvido, algo está errado
  const cookieStore = await cookies()
  const impCookie = cookieStore.get('orbis_imp_tid')?.value
  if (impCookie && !tenantId) {
    console.error('[unarchive] Cookie de impersonation presente mas tenantId não resolvido:', impCookie)
    return NextResponse.json({ error: 'Erro de sessão: tenant de impersonation não pôde ser determinado. Tente sair e entrar novamente.' }, { status: 400 })
  }

  const { phone, instanceName } = await req.json()
  await unarchiveWhatsAppConversation(phone, instanceName ?? null, tenantId)
  return NextResponse.json({ ok: true })
}
