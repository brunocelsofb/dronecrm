// Só os dados técnicos (dimensionamento) da precificação do Price — lista fechada.
// Usado para o aprovador técnico: nada de receita, preço, custo, margem ou estado completo do Price.
type Raw = Record<string, unknown> & {
  professionals?: { role?: string; quantity?: number; contractType?: string; hoursPerMonth?: number; workload?: string }[]
}

const TECH_SECTIONS = ['objeto', 'escopo', 'equipe', 'sla', 'intervencoes', 'diretrizes']

export function technicalSnapshot(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Raw
  const ap = (s.apresentacao as { secoes?: { chave: string }[] } | undefined)
  return {
    clientName: s.clientName ?? '', projectName: s.projectName ?? '', tipoEngenharia: s.tipoEngenharia ?? '',
    hospitalBeds: Number(s.hospitalBeds) || 0, objetoContrato: s.objetoContrato ?? '',
    contractDuration: Number(s.contractDuration) || 0,
    escopoServicos: s.escopoServicos ?? [], escopoSanitizado: s.escopoSanitizado ?? undefined,
    professionals: (s.professionals ?? []).map(p => ({ role: p.role, quantity: p.quantity, contractType: p.contractType, hoursPerMonth: p.hoursPerMonth, workload: p.workload })),
    totalFTE: Number(s.totalFTE) || 0, cltCount: Number(s.cltCount) || 0, pjCount: Number(s.pjCount) || 0,
    equipamentos: s.equipamentos ?? undefined, dimensionamento: s.dimensionamento ?? undefined, sentAt: s.sentAt ?? '',
    apresentacao: ap?.secoes ? { versao: 1, secoes: ap.secoes.filter(x => TECH_SECTIONS.includes(x.chave)) } : undefined,
  }
}

export const isTechnicalApprover = (role: unknown) => String(role ?? '') === 'aprovador_tecnico'
