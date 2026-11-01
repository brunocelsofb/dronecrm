import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized, forEachActiveTenant } from '@/lib/tenant/cron'
import { runCustomTasksForTenant } from '@/lib/agent/agent-tasks-server'
import { runRulesForTenant } from '@/lib/agent/rules-engine'

export const maxDuration = 300

// Vercel Cron (vercel.json): todo dia 07h30 de Brasília. Empresa por empresa, roda as regras
// dos agentes (tela Regras automáticas) e as
// tarefas escritas pelo admin (tela IA da empresa) marcadas para o dia, com a IA do Théo
// da própria empresa. ?force=1 roda todas as ligadas (teste manual, exige CRON_SECRET).
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const force = new URL(req.url).searchParams.get('force') === '1'
  // Regras dos agentes (tela Regras automáticas) e tarefas escritas pelo admin (tela IA da empresa)
  const results = await forEachActiveTenant(async tenantId => ({
    rules: await runRulesForTenant(tenantId, { force }),
    tasks: await runCustomTasksForTenant(tenantId, { force }),
  }))
  return NextResponse.json({ ok: true, checked_at: new Date().toISOString(), results })
}
