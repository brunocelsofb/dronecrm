// Fontes das listas de marketing (empresa atual) e cálculo dos membros.
// Cliente = empresa com contrato aberto no funil de gestão de contratos.

import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { fetchAll } from '@/lib/revenue/dashboard-data'
import { buildMembers, readFilters, type ListAudience, type SegClient, type SegContact, type SegLead } from './segments'

export async function loadListMembers(tenantId: string, list: { audience: string; filters: unknown }) {
  const db = await createScopedAdmin(tenantId)
  const audience = (['leads', 'clientes', 'ambos'].includes(list.audience) ? list.audience : 'leads') as ListAudience
  const filters = readFilters(list.filters)

  const [leads, optoutRows] = await Promise.all([
    audience === 'clientes' ? Promise.resolve([] as SegLead[]) : fetchAll<SegLead>((a, b) => db.from('leads')
      .select('id, name, email, phone, company_name, status, score, campaign_id, created_at, source, utm_source, utm_medium, gclid, fbclid').order('id').range(a, b)),
    fetchAll<{ email: string }>((a, b) => db.from('marketing_optouts').select('email').order('id').range(a, b)),
  ])

  const contacts: SegContact[] = []
  let clients: SegClient[] = []
  if (audience !== 'leads') {
    const [pipelines, runs, contracts, companies, tags] = await Promise.all([
      fetchAll<{ id: string; type: string }>((a, b) => db.from('pipelines').select('id, type').order('id').range(a, b)),
      fetchAll<{ contract_id: string; pipeline_id: string }>((a, b) => db.from('pipeline_runs').select('contract_id, pipeline_id').eq('status', 'open').order('id').range(a, b)),
      fetchAll<{ id: string; company_id: string | null; segment: string | null; uf: string | null; state: string | null }>((a, b) => db.from('contracts').select('id, company_id, segment, uf, state').order('id').range(a, b)),
      fetchAll<{ id: string; name: string }>((a, b) => db.from('companies').select('id, name').order('id').range(a, b)),
      fetchAll<{ company_id: string; tag_id: string }>((a, b) => db.from('company_tags').select('company_id, tag_id').order('id').range(a, b)),
    ])
    const mgmt = new Set(pipelines.filter(p => p.type === 'gestao_contratos').map(p => p.id))
    const activeContracts = new Set(runs.filter(r => mgmt.has(r.pipeline_id)).map(r => r.contract_id))
    const nameOf = new Map(companies.map(c => [c.id, c.name]))
    const byCompany = new Map<string, SegClient>()
    for (const c of contracts) {
      if (!c.company_id || !activeContracts.has(c.id)) continue
      const e = byCompany.get(c.company_id) ?? { company_id: c.company_id, company_name: nameOf.get(c.company_id) ?? '', segments: [], ufs: [], tag_ids: [] }
      if (c.segment && !e.segments.includes(c.segment)) e.segments.push(c.segment)
      const uf = (c.uf ?? c.state ?? '').toUpperCase()
      if (uf && !e.ufs.includes(uf)) e.ufs.push(uf)
      byCompany.set(c.company_id, e)
    }
    for (const t of tags) { const e = byCompany.get(t.company_id); if (e && !e.tag_ids.includes(t.tag_id)) e.tag_ids.push(t.tag_id) }
    clients = [...byCompany.values()]
    const ids = clients.map(c => c.company_id)
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from('contacts').select('id, name, email, phone, company_id, is_primary').in('company_id', ids.slice(i, i + 200))
      if (error) throw new Error(error.message)
      contacts.push(...((data ?? []) as SegContact[]))
    }
  }

  const optouts = new Set(optoutRows.map(o => o.email.toLowerCase()))
  return { audience, filters, ...buildMembers({ audience, filters, leads, contacts, clients, optouts }), clientCount: clients.length }
}

// Opções dos filtros (segmentos, UFs e etiquetas usados nos contratos/empresas)
export async function loadListFilterOptions(tenantId: string) {
  const db = await createScopedAdmin(tenantId)
  const [contracts, tags] = await Promise.all([
    fetchAll<{ segment: string | null; uf: string | null; state: string | null }>((a, b) => db.from('contracts').select('segment, uf, state').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => db.from('tags').select('id, name').order('name').range(a, b)),
  ])
  const segments = [...new Set(contracts.map(c => c.segment).filter((s): s is string => !!s))].sort()
  const ufs = [...new Set(contracts.map(c => (c.uf ?? c.state ?? '').toUpperCase()).filter(Boolean))].sort()
  return { segments, ufs, tags }
}
