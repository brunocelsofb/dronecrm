// ─── Regras da proposta por empresa (Configurações → Propostas) ───────────────
// Price: recurso do plano ('price', liberado por empresa no Super Admin).
// Aprovação técnica: organization_settings.proposal_settings.techApproval (padrão: ligada).
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantFeatures } from '@/lib/config/tenant-features'

export type ProposalSettings = { techApproval: boolean }
export const DEFAULT_PROPOSAL_SETTINGS: ProposalSettings = { techApproval: true }

export function resolveProposalSettings(raw: unknown): ProposalSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { techApproval: typeof r.techApproval === 'boolean' ? r.techApproval : DEFAULT_PROPOSAL_SETTINGS.techApproval }
}

export type ProposalConfig = ProposalSettings & { priceEnabled: boolean }

export async function getProposalConfig(tenantId: string | null | undefined): Promise<ProposalConfig> {
  if (!tenantId) return { ...DEFAULT_PROPOSAL_SETTINGS, priceEnabled: false }
  const admin = createAdminClient()
  const [{ features }, { data }] = await Promise.all([
    getTenantFeatures(tenantId),
    admin.schema('contract_crm').from('organization_settings').select('proposal_settings').eq('tenant_id', tenantId).maybeSingle(),
  ])
  return { ...resolveProposalSettings(data?.proposal_settings), priceEnabled: features.includes('price') }
}
