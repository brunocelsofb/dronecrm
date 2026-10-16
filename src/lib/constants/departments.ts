export const DEPARTMENTS = [
  { value: 'comercial', label: 'Comercial' },
  { value: 'tecnico', label: 'Técnico / Operação' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'qualidade', label: 'Qualidade' },
  { value: 'gente_gestao', label: 'Gente e Gestão' },
  { value: 'departamento_pessoal', label: 'Departamento Pessoal' },
] as const

export function departmentLabel(value: string | null): string {
  return DEPARTMENTS.find((d) => d.value === value)?.label ?? (value || 'Sem departamento')
}
