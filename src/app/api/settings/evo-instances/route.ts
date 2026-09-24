import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getEvoCreds() {
  const admin = createAdminClient()
  const { data } = await admin.from('organization_settings')
    .select('evo_server_url, evo_api_key').eq('id', 'default').maybeSingle()
  return data?.evo_server_url && data?.evo_api_key ? data : null
}

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
  const instances = Array.isArray(data) ? data : []

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

  return NextResponse.json({ instances })
}

// POST — cria nova instância
export async function POST(req: Request) {
  if (!await guardAdmin()) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  const creds = await getEvoCreds()
  if (!creds) return NextResponse.json({ error: 'Credenciais não configuradas' }, { status: 400 })

  const { instanceName } = await req.json()
  if (!instanceName) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })

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

  return NextResponse.json({ ok: res.ok, data })
}

// PUT — reinicia instância (reconecta sessão travada)
export async function PUT(req: Request) {
  if (!await guardAdmin()) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  const creds = await getEvoCreds()
  if (!creds) return NextResponse.json({ error: 'Credenciais não configuradas' }, { status: 400 })

  const { instanceName } = await req.json()
  if (!instanceName) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })

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
  const res = await fetch(`${creds.evo_server_url}/instance/delete/${instanceName}`, {
    method: 'DELETE',
    headers: { apikey: creds.evo_api_key },
  })
  return NextResponse.json({ ok: res.ok })
}

// PATCH — conecta instância (QR Code)
export async function PATCH(req: Request) {
  if (!await guardAdmin()) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  const creds = await getEvoCreds()
  if (!creds) return NextResponse.json({ error: 'Credenciais não configuradas' }, { status: 400 })

  const { instanceName } = await req.json()
  const res = await fetch(`${creds.evo_server_url}/instance/connect/${instanceName}`, {
    headers: { apikey: creds.evo_api_key },
  })
  const data = await res.json().catch(() => ({}))
  const qrRaw = data?.qrcode?.base64 ?? data?.base64 ?? data?.code ?? null
  return NextResponse.json({ qr: qrRaw ? (qrRaw.startsWith('data:') ? qrRaw : `data:image/png;base64,${qrRaw}`) : null })
}
