import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPrivateInstances, isPrivateInstance, PRIVATE_INSTANCE_ERROR } from '@/lib/whatsapp/private-instances'
import { resolveTenantId } from '@/lib/tenant/context'
import {
  getTenantEvoCreds, filterInstancesForTenant, canTenantUseInstance, getWhatsAppLimit,
  getTenantInstanceNames, instanceNameForTenant, registerInstanceForTenant, unregisterInstanceForTenant,
} from '@/lib/whatsapp/tenant-evo'

// Servidor da empresa: próprio (exceção) ou o da plataforma
async function getEvoCreds() {
  const c = await getTenantEvoCreds(await resolveTenantId())
  return c ? { evo_server_url: c.serverUrl, evo_api_key: c.apiKey } : null
}

const nameOf = (inst: any): string | undefined => inst?.instance?.instanceName ?? inst?.name ?? inst?.instanceName

async function guardAdmin() {
  const s = await createClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return false
  const { data: p } = await s.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return p?.role === 'admin'
}

// GET — lista instâncias; GET?action=sync-webhooks reaplica webhook em todas
export async function GET(req: Request) {
  if (!await guardAdmin()) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  const creds = await getEvoCreds()
  if (!creds) return NextResponse.json({ error: 'Credenciais não configuradas' }, { status: 400 })

  const { searchParams } = new URL(req.url)
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm-gestaocontratos-pi.vercel.app'}/api/whatsapp-inbound/evolution`
  const webhookBody = JSON.stringify({ webhook: { enabled: true, url: webhookUrl, webhookByEvents: true, webhookBase64: false, events: ['MESSAGES_UPSERT', 'MESSAGES_DELETE', 'SEND_MESSAGE', 'CONNECTION_UPDATE'] } })

  const res = await fetch(`${creds.evo_server_url}/instance/fetchInstances`, {
    headers: { apikey: creds.evo_api_key },
  })
  const data = await res.json().catch(() => [])
  // Instâncias privadas não aparecem no CRM nem recebem webhook
  type EvoInstance = { instance?: { instanceName?: string }; name?: string; instanceName?: string }
  const privateSet = await getPrivateInstances()
  const visible = (Array.isArray(data) ? data : []).filter((inst: EvoInstance) => {
    const name = inst.instance?.instanceName ?? inst.name ?? inst.instanceName
    return !name || !privateSet.has(name.trim().toLowerCase())
  })
  // Servidor compartilhado: só as instâncias desta empresa
  const tenantId = await resolveTenantId()
  const instances = await filterInstancesForTenant(tenantId, visible, nameOf)
  const limit = await getWhatsAppLimit(tenantId)

  if (searchParams.get('action') === 'sync-webhooks') {
    const results = await Promise.all(instances.map(async (inst: any) => {
      const name = inst.instance?.instanceName ?? inst.name ?? inst.instanceName
      if (!name) return { name, ok: false }
      const r = await fetch(`${creds.evo_server_url}/webhook/set/${name}`, {
        method: 'POST', headers: { apikey: creds.evo_api_key, 'Content-Type': 'application/json' }, body: webhookBody,
      })
      console.log('[sync-webhooks]', name, r.status)
      return { name, ok: r.ok }
    }))
    return NextResponse.json({ synced: results })
  }

  return NextResponse.json({ instances, limit })
}

// POST — cria nova instância
export async function POST(req: Request) {
  if (!await guardAdmin()) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  const creds = await getEvoCreds()
  if (!creds) return NextResponse.json({ error: 'Credenciais não configuradas' }, { status: 400 })

  const body = await req.json()
  if (!body?.instanceName) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })
  const tenantId = await resolveTenantId()
  const instanceName = await instanceNameForTenant(tenantId, String(body.instanceName))
  if (await isPrivateInstance(instanceName)) return NextResponse.json({ error: PRIVATE_INSTANCE_ERROR }, { status: 403 })
  if (!(await canTenantUseInstance(tenantId, instanceName))) {
    return NextResponse.json({ error: 'Esse nome já está em uso. Escolha outro.' }, { status: 409 })
  }
  // Limite de números do plano
  const [limit, owned] = await Promise.all([getWhatsAppLimit(tenantId), getTenantInstanceNames(tenantId)])
  if (!owned.includes(instanceName) && owned.length >= limit) {
    return NextResponse.json({ error: `Seu plano permite ${limit} WhatsApp(s). Fale com o administrador da licença para ampliar.` }, { status: 403 })
  }

  const res = await fetch(`${creds.evo_server_url}/instance/create`, {
    method: 'POST',
    headers: { apikey: creds.evo_api_key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
  })
  const data = await res.json().catch(() => ({}))

  // Registra webhook
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm-gestaocontratos-pi.vercel.app'}/api/whatsapp-inbound/evolution`
  await fetch(`${creds.evo_server_url}/webhook/set/${instanceName}`, {
    method: 'POST',
    headers: { apikey: creds.evo_api_key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhook: { enabled: true, url: webhookUrl, webhookByEvents: true, webhookBase64: false, events: ['MESSAGES_UPSERT', 'MESSAGES_DELETE', 'SEND_MESSAGE', 'CONNECTION_UPDATE'] } }),
  })

  if (res.ok) await registerInstanceForTenant(tenantId, instanceName, String(body.instanceName))
  return NextResponse.json({ ok: res.ok, data, instanceName })
}

// PUT — reinicia instância (reconecta sessão travada)
export async function PUT(req: Request) {
  if (!await guardAdmin()) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  const creds = await getEvoCreds()
  if (!creds) return NextResponse.json({ error: 'Credenciais não configuradas' }, { status: 400 })

  const { instanceName } = await req.json()
  if (!instanceName) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })
  if (await isPrivateInstance(instanceName)) return NextResponse.json({ error: PRIVATE_INSTANCE_ERROR }, { status: 403 })
  if (!(await canTenantUseInstance(await resolveTenantId(), instanceName))) return NextResponse.json({ error: 'Instância não encontrada' }, { status: 404 })

  const res = await fetch(`${creds.evo_server_url}/instance/restart/${instanceName}`, {
    method: 'PUT',
    headers: { apikey: creds.evo_api_key },
  })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json({ ok: res.ok, data })
}

// DELETE — deleta instância
export async function DELETE(req: Request) {
  if (!await guardAdmin()) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  const creds = await getEvoCreds()
  if (!creds) return NextResponse.json({ error: 'Credenciais não configuradas' }, { status: 400 })

  const { instanceName } = await req.json()
  if (await isPrivateInstance(instanceName)) return NextResponse.json({ error: PRIVATE_INSTANCE_ERROR }, { status: 403 })
  const tenantId = await resolveTenantId()
  if (!(await canTenantUseInstance(tenantId, instanceName))) return NextResponse.json({ error: 'Instância não encontrada' }, { status: 404 })
  const res = await fetch(`${creds.evo_server_url}/instance/delete/${instanceName}`, {
    method: 'DELETE',
    headers: { apikey: creds.evo_api_key },
  })
  if (res.ok) await unregisterInstanceForTenant(tenantId, instanceName)
  return NextResponse.json({ ok: res.ok })
}

// PATCH — conecta instância (QR Code)
export async function PATCH(req: Request) {
  if (!await guardAdmin()) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  const creds = await getEvoCreds()
  if (!creds) return NextResponse.json({ error: 'Credenciais não configuradas' }, { status: 400 })

  const { instanceName } = await req.json()
  if (await isPrivateInstance(instanceName)) return NextResponse.json({ error: PRIVATE_INSTANCE_ERROR }, { status: 403 })
  if (!(await canTenantUseInstance(await resolveTenantId(), instanceName))) return NextResponse.json({ error: 'Instância não encontrada' }, { status: 404 })
  const res = await fetch(`${creds.evo_server_url}/instance/connect/${instanceName}`, {
    headers: { apikey: creds.evo_api_key },
  })
  const data = await res.json().catch(() => ({}))
  const qrRaw = data?.qrcode?.base64 ?? data?.base64 ?? data?.code ?? null
  return NextResponse.json({ qr: qrRaw ? (qrRaw.startsWith('data:') ? qrRaw : `data:image/png;base64,${qrRaw}`) : null })
}
