// Mantém o webhook das instâncias da empresa com os eventos atuais (EVO_WEBHOOK_EVENTS).
// Quando a lista de eventos muda (ex.: MESSAGES_UPDATE para os tiques), sobe EVO_WEBHOOK_VERSION:
// na próxima abertura da Central de cada empresa, as instâncias dela são registradas de novo.
// Só mexe na configuração do webhook no servidor Evolution; pula instâncias privadas.
import { createAdminClient } from '@/lib/supabase/admin'
import { setEvoWebhook } from '@/lib/whatsapp/evolution'
import { getTenantEvoCreds, getTenantInstanceNames } from '@/lib/whatsapp/tenant-evo'
import { isPrivateInstance } from '@/lib/whatsapp/private-instances'

export const EVO_WEBHOOK_VERSION = 2

export async function ensureEvoWebhookEvents(tenantId: string | null): Promise<void> {
  if (!tenantId) return
  const admin = createAdminClient()
  const { data } = await admin.from('organization_settings')
    .select('evo_webhook_version, evo_instance_name').eq('tenant_id', tenantId).maybeSingle()
  const before = Number((data as { evo_webhook_version?: number } | null)?.evo_webhook_version ?? 0)
  if (!data || before >= EVO_WEBHOOK_VERSION) return
  // Marca antes, para duas abas abertas ao mesmo tempo não repetirem o registro
  await admin.from('organization_settings').update({ evo_webhook_version: EVO_WEBHOOK_VERSION }).eq('tenant_id', tenantId)

  const creds = await getTenantEvoCreds(tenantId)
  const names = [...new Set([...(await getTenantInstanceNames(tenantId)), (data as { evo_instance_name?: string | null }).evo_instance_name ?? ''].filter(Boolean))]
  if (!creds || !names.length) return

  let ok = 0, tried = 0
  for (const instanceName of names) {
    if (await isPrivateInstance(instanceName, tenantId)) continue
    tried++
    const r = await setEvoWebhook({ ...creds, instanceName })
    if (r.ok) ok++
    else console.warn('[webhook-sync]', tenantId, instanceName, r.error)
  }
  // Nenhuma deu certo (servidor fora do ar?): tenta de novo na próxima abertura
  if (tried && !ok) await admin.from('organization_settings').update({ evo_webhook_version: before }).eq('tenant_id', tenantId)
}
