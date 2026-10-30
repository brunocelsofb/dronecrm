import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized, forEachActiveTenant } from '@/lib/tenant/cron'
import { applyRetention, encryptBacklog } from '@/lib/privacy/routines'
import { purgeOldExports } from '@/lib/tenant/export-files'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 60

// Vercel Cron (vercel.json), todo dia: retenção das mensagens de WhatsApp e
// criptografia do conteúdo antigo e limpeza das exportações, empresa por empresa.
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const results = await forEachActiveTenant(async tenantId => ({
    retention: await applyRetention(tenantId),
    encryption: await encryptBacklog(tenantId),
    // arquivos de exportação (dados pessoais) não ficam guardados: some depois de 2 horas
    exports_removed: await purgeOldExports(tenantId, 2 * 3_600_000).catch(() => 0),
    // estatísticas de página: guarda 13 meses (dá para comparar o mesmo mês do ano anterior)
    visits_removed: await purgeOldVisits(tenantId),
  }))
  return NextResponse.json({ ok: true, checked_at: new Date().toISOString(), results })
}

async function purgeOldVisits(tenantId: string): Promise<number> {
  const cut = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10)
  const { count } = await createAdminClient().from('page_visits').delete({ count: 'exact' }).eq('tenant_id', tenantId).lt('visited_on', cut)
  return count ?? 0
}
