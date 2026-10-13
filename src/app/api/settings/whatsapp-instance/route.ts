// src/app/api/settings/whatsapp-instance/route.ts
// PATCH { instance, bot_enabled?, private? } — altera as chaves de uma instância
// em organization_settings.evo_instance_aliases. Só administradores.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentUserAdmin } from '@/lib/auth/role'

const WEBHOOK_URL =
  `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm-gestaocontratos-pi.vercel.app'}/api/whatsapp-inbound/evolution`

// Liga ou desliga o webhook da instância na Evolution (melhor esforço)
async function setInstanceWebhook(
  serverUrl: string, apiKey: string, instance: string, enabled: boolean
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${serverUrl.replace(/\/$/, '')}/webhook/set/${encodeURIComponent(instance)}`, {
      method: 'POST',
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhook: enabled
          ? { enabled: true, url: WEBHOOK_URL, webhookByEvents: true, webhookBase64: false,
              events: ['MESSAGES_UPSERT', 'MESSAGES_DELETE', 'SEND_MESSAGE', 'CONNECTION_UPDATE'] }
          : { enabled: false, url: '', events: [] },
      }),
    })
    return res.ok ? { ok: true } : { ok: false, error: `Evolution HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function PATCH(request: Request) {
  try {
    if (!(await isCurrentUserAdmin())) {
      return NextResponse.json({ ok: false, error: 'Acesso negado' }, { status: 403 })
    }

    const body = await request.json()
    const { instance, bot_enabled } = body
    const isPrivate: unknown = body.private

    if (typeof instance !== 'string' || instance.trim() === '') {
      return NextResponse.json({ ok: false, error: 'instance é obrigatório' }, { status: 400 })
    }
    if (bot_enabled !== undefined && typeof bot_enabled !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'bot_enabled deve ser boolean' }, { status: 400 })
    }
    if (isPrivate !== undefined && typeof isPrivate !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'private deve ser boolean' }, { status: 400 })
    }
    if (bot_enabled === undefined && isPrivate === undefined) {
      return NextResponse.json({ ok: false, error: 'nada para alterar' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: current } = await supabase
      .from('organization_settings')
      .select('evo_instance_aliases, evo_server_url, evo_api_key, evo_instance_name')
      .eq('id', 'default')
      .maybeSingle()

    if (!current) {
      return NextResponse.json({ ok: false, error: 'organization_settings não encontrado' }, { status: 404 })
    }

    const aliases = (current.evo_instance_aliases ?? {}) as Record<string, any>
    if (!(instance in aliases)) {
      return NextResponse.json({ ok: false, error: `Instância '${instance}' não encontrada` }, { status: 404 })
    }

    // A instância principal do CRM não pode ser privada
    if (isPrivate === true && current.evo_instance_name?.trim().toLowerCase() === instance.trim().toLowerCase()) {
      return NextResponse.json(
        { ok: false, error: 'Esta é a instância principal do CRM e não pode ser privada.' },
        { status: 400 }
      )
    }

    const prev = typeof aliases[instance] === 'string' ? { label: aliases[instance] } : aliases[instance]
    const next = { ...prev }
    if (bot_enabled !== undefined) next.bot_enabled = bot_enabled
    if (isPrivate !== undefined) {
      next.private = isPrivate
      if (isPrivate) next.bot_enabled = false   // privada nunca responde clientes
    }

    const { error } = await supabase
      .from('organization_settings')
      .update({ evo_instance_aliases: { ...aliases, [instance]: next } })
      .eq('id', 'default')

    if (error) {
      console.error('[settings/whatsapp-instance] update error:', error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    // Privada → desliga webhook; pública → liga webhook (mensagens novas entram no CRM)
    let webhook: { ok: boolean; error?: string } | undefined
    if (isPrivate !== undefined && current.evo_server_url && current.evo_api_key) {
      webhook = await setInstanceWebhook(current.evo_server_url, current.evo_api_key, instance, !isPrivate)
      if (!webhook.ok) console.warn('[settings/whatsapp-instance] webhook:', instance, webhook.error)
    }

    return NextResponse.json({ ok: true, instance, ...next, webhook })
  } catch (err) {
    console.error('[settings/whatsapp-instance] erro:', err)
    const message = err instanceof Error ? err.message : 'erro interno'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
