import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { phone, name } = await req.json()
    if (!phone) return NextResponse.json({ error: 'phone obrigatório' }, { status: 400 })

    const cleanPhone = String(phone).replace(/\D/g, '')

    // Verifica se já existe lead com esse telefone
    const { data: existing } = await supabase
      .from('leads')
      .select('id')
      .ilike('phone', `%${cleanPhone.slice(-10)}`)
      .limit(1)
      .maybeSingle()

    if (existing?.id) {
      console.log('[ensure-lead] lead já existe:', existing.id)
      return NextResponse.json({ leadId: existing.id })
    }

    // Cria novo lead com campos mínimos obrigatórios
    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        name: (name || phone).slice(0, 255),
        phone: cleanPhone,
        source: 'whatsapp',
        // Mensagem que chegou no WhatsApp da empresa: inbound, mas já está sendo atendido pelo comercial
        entry_type: 'inbound',
        handed_off_at: new Date().toISOString(),
        handed_off_by: user.id,
        assigned_to: user.id,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[ensure-lead] erro ao criar lead:', JSON.stringify(error))
      return NextResponse.json({ error: `Erro ao criar lead: ${error.message}` }, { status: 500 })
    }

    console.log('[ensure-lead] lead criado:', lead.id)
    return NextResponse.json({ leadId: lead.id })

  } catch (e: any) {
    console.error('[ensure-lead] erro inesperado:', e?.message)
    return NextResponse.json({ error: e?.message ?? 'Erro interno' }, { status: 500 })
  }
}
