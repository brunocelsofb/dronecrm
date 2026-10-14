// src/app/api/settings/whatsapp-instance/route.ts
// PATCH { instance, bot_enabled?, private? } — altera as chaves de uma instância
// em organization_settings.evo_instance_aliases. Só administradores.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'
import { withPlatformEvo } from '@/lib/whatsapp/tenant-evo'
import { canTenantUseInstance } from '@/lib/whatsapp/tenant-evo'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

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
    const hasUserId = Object.prototype.hasOwnProperty.call(body, 'user_id')
    const userId: unknown = body.user_id

    if (typeof instance !== 'string' || instance.trim() === '') {
      return NextResponse.json({ ok: false, error: 'instance é obrigatório' }, { status: 400 })
    }
    if (!(await canTenantUseInstance(await resolveTenantId(), instance))) {
      return NextResponse.json({ ok: false, error: 'Instância não encontrada' }, { status: 404 })
    }
    if (bot_enabled !== undefined && typeof bot_enabled !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'bot_enabled deve ser boolean' }, { status: 400 })
    }
    if (isPrivate !== undefined && typeof isPrivate !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'private deve ser boolean' }, { status: 400 })
    }
    if (hasUserId && userId !== null && typeof userId !== 'string') {
      return NextResponse.json({ ok: false, error: 'user_id deve ser texto ou null' }, { status: 400 })
    }
    if (bot_enabled === undefined && isPrivate === undefined && !hasUserId) {
      return NextResponse.json({ ok: false, error: 'nada para alterar' }, { status: 400 })
    }

    const supabase = (await createScopedAdmin())

    const { data: current__raw } = await supabase
      .from('organization_settings')
      .select('evo_instance_aliases, evo_server_url, evo_api_key, evo_instance_name')
      .eq('tenant_id', await resolveTenantId())
      .maybeSingle()
    const current = withPlatformEvo(current__raw)

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
    // Consultor dono deste WhatsApp: assina os avisos e é o remetente do e-mail
    if (hasUserId) {
      if (userId) {
        const { data: prof } = await supabase.from('profiles').select('id').eq('id', userId as string).maybeSingle()
        if (!prof) return NextResponse.json({ ok: false, error: 'Usuário não encontrado' }, { status: 400 })
        next.user_id = userId
      } else {
        delete next.user_id
      }
    }
    if (bot_enabled !== undefined) next.bot_enabled = bot_enabled
    if (isPrivate !== undefined) {
      next.private = isPrivate
      if (isPrivate) next.bot_enabled = false   // privada nunca responde clientes
    }

    const { error } = await supabase
      .from('organization_settings')
      .update({ evo_instance_aliases: { ...aliases, [instance]: next } })
      .eq('tenant_id', await resolveTenantId())

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

// DELETE { instance } — remove a instância da lista do CRM e da Evolution.
// Só administradores. Recusa a instância principal e instâncias conectadas.
// Histórico de mensagens já gravado no CRM não é apagado.
export async function DELETE(request: Request) {
  try {
    if (!(await isCurrentUserAdmin())) {
      return NextResponse.json({ ok: false, error: 'Acesso negado' }, { status: 403 })
    }
    const { instance } = await request.json().catch(() => ({}))
    if (typeof instance !== 'string' || instance.trim() === '') {
      return NextResponse.json({ ok: false, error: 'instance é obrigatório' }, { status: 400 })
    }
    if (!(await canTenantUseInstance(await resolveTenantId(), instance))) {
      return NextResponse.json({ ok: false, error: 'Instância não encontrada' }, { status: 404 })
    }

    const supabase = (await createScopedAdmin())
    const { data: current__raw } = await supabase
      .from('organization_settings')
      .select('evo_instance_aliases, evo_server_url, evo_api_key, evo_instance_name')
      .eq('tenant_id', await resolveTenantId())
      .maybeSingle()
    const current = withPlatformEvo(current__raw)
    if (!current) {
      return NextResponse.json({ ok: false, error: 'organization_settings não encontrado' }, { status: 404 })
    }

    if (current.evo_instance_name?.trim().toLowerCase() === instance.trim().toLowerCase()) {
      return NextResponse.json(
        { ok: false, error: 'Esta é a instância principal do CRM e não pode ser excluída.' },
        { status: 400 }
      )
    }

    const base = current.evo_server_url?.replace(/\/$/, '')
    const apiKey = current.evo_api_key
    const name = encodeURIComponent(instance)

    // Confere na Evolution que NÃO está conectada (o status da tela pode estar desatualizado)
    if (base && apiKey) {
      try {
        const st = await fetch(`${base}/instance/connectionState/${name}`, { headers: { apikey: apiKey } })
        if (st.ok) {
          const d = await st.json().catch(() => ({}))
          const state = d?.instance?.state ?? d?.state
          if (state === 'open') {
            return NextResponse.json(
              { ok: false, error: 'A instância está conectada. Desconecte o aparelho antes de excluir.' },
              { status: 409 }
            )
          }
        }
      } catch { /* servidor fora do ar: segue e remove só do CRM */ }
    }

    // Remove da Evolution (melhor esforço; 404 = já não existe lá)
    let evolution: 'deleted' | 'not_found' | 'failed' | 'skipped' = 'skipped'
    if (base && apiKey) {
      try {
        const r = await fetch(`${base}/instance/delete/${name}`, { method: 'DELETE', headers: { apikey: apiKey } })
        evolution = r.ok ? 'deleted' : r.status === 404 ? 'not_found' : 'failed'
      } catch {
        evolution = 'failed'
      }
    }

    // Remove da lista do CRM
    const aliases = { ...((current.evo_instance_aliases ?? {}) as Record<string, unknown>) }
    delete aliases[instance]
    const { error } = await supabase
      .from('organization_settings')
      .update({ evo_instance_aliases: aliases })
      .eq('tenant_id', await resolveTenantId())
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, instance, evolution })
  } catch (err) {
    console.error('[settings/whatsapp-instance] erro no DELETE:', err)
    const message = err instanceof Error ? err.message : 'erro interno'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
