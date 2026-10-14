import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { contract_id, proposal_id, texto_objetivos, texto_atividades, texto_estrutura_apoio } = await req.json()

  const admin = (await createScopedAdmin())

  if (proposal_id) {
    // Novo modelo: salva direto em proposals
    await admin.from('proposals').update({
      texto_objetivos,
      texto_atividades,
      texto_estrutura_apoio,
      updated_at: new Date().toISOString(),
    }).eq('id', proposal_id)
  } else if (contract_id) {
    // Fallback legado: proposal_status
    await admin.from('proposal_status').upsert({
      contract_id,
      texto_objetivos,
      texto_atividades,
      texto_estrutura_apoio,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'contract_id' })
  }

  return NextResponse.json({ ok: true })
}
