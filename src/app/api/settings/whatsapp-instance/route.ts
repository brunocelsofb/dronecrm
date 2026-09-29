// src/app/api/settings/whatsapp-instance/route.ts
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { instance, bot_enabled } = body

    if (typeof instance !== 'string' || instance.trim() === '') {
      return NextResponse.json({ ok: false, error: 'instance é obrigatório' }, { status: 400 })
    }
    if (typeof bot_enabled !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'bot_enabled deve ser boolean' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Garante que a instância existe antes de atualizar
    const { data: current } = await supabase
      .schema('contract_crm')
      .from('organization_settings')
      .select('evo_instance_aliases')
      .eq('id', 'default')
      .maybeSingle()

    if (!current) {
      return NextResponse.json({ ok: false, error: 'organization_settings não encontrado' }, { status: 404 })
    }

    const aliases = (current.evo_instance_aliases ?? {}) as Record<string, any>
    if (!(instance in aliases)) {
      return NextResponse.json({ ok: false, error: `Instância '${instance}' não encontrada` }, { status: 404 })
    }

    // jsonb_set com path em array — seguro para nomes com espaços e hífens
    const { error } = await supabase
      .schema('contract_crm')
      .from('organization_settings')
      .update({
        evo_instance_aliases: {
          ...aliases,
          [instance]: {
            ...aliases[instance],
            bot_enabled,
          },
        },
      })
      .eq('id', 'default')

    if (error) {
      console.error('[settings/whatsapp-instance] update error:', error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, instance, bot_enabled })
  } catch (err: any) {
    console.error('[settings/whatsapp-instance] erro:', err)
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro interno' }, { status: 500 })
  }
}
