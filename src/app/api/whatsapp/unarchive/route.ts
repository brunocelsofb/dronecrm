import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/supabase/server'
import { unarchiveWhatsAppConversation } from '@/lib/actions/whatsapp'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  // Ler tenant ativo do header injetado pelo middleware (suporte a impersonation)
  const tenantId = await getActiveTenantId()

  const { phone, instanceName } = await req.json()
  await unarchiveWhatsAppConversation(phone, instanceName ?? null, tenantId)
  return NextResponse.json({ ok: true })
}
