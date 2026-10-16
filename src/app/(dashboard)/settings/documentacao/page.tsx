/**
 * Configurações → Documentação do sistema (Admin).
 * As 6 peças: Produto (PRD), Técnico (TRD), Fluxos, Design System, Banco de
 * dados e Plano de implementação. Textos neutros (valem para qualquer empresa).
 * Funcionalidades vêm das explicações de tela (page-help) e o banco é lido ao
 * vivo (função schema_overview, só Admin) — não ficam desatualizados.
 */

import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { listPageHelp } from '@/lib/help/page-help'
import { DocsView, type SchemaTable } from '@/components/settings/docs-view'
import pkg from '../../../../../package.json'

export const dynamic = 'force-dynamic'

export default async function DocumentacaoPage() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('schema_overview')
  const deps = (pkg as { dependencies?: Record<string, string> }).dependencies ?? {}
  return (
    <DocsView
      features={listPageHelp()}
      schema={(Array.isArray(data) ? data : []) as SchemaTable[]}
      schemaError={error?.message ?? null}
      versions={{
        next: deps.next ?? '', react: deps.react ?? '', supabase: deps['@supabase/supabase-js'] ?? '',
        anthropic: deps['@anthropic-ai/sdk'] ?? '', recharts: deps.recharts ?? '', zod: deps.zod ?? '',
      }}
    />
  )
}
