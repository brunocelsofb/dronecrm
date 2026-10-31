import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

// Apaga um modelo do ZapSign da empresa de quem está logado (antes não conferia login nem empresa)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { id } = await params
  const db = await createScopedAdmin()
  await db.from('zapsign_templates').delete().eq('id', id)
  // Destino fixo do próprio sistema (só a origem vem da requisição): não é redirecionamento aberto
  // nosemgrep: rules.ajinabraham.njsscan.redirect.open_redirect.express_open_redirect
  return NextResponse.redirect(new URL('/zapsign', request.url), 303)
}
