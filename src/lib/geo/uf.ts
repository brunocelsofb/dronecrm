// Estados do Brasil: sigla, nome e região. Sem 'use server': usado no servidor e na tela.

export const UFS: { uf: string; name: string; region: 'Norte' | 'Nordeste' | 'Centro-Oeste' | 'Sudeste' | 'Sul' }[] = [
  { uf: 'AC', name: 'Acre', region: 'Norte' }, { uf: 'AL', name: 'Alagoas', region: 'Nordeste' },
  { uf: 'AP', name: 'Amapá', region: 'Norte' }, { uf: 'AM', name: 'Amazonas', region: 'Norte' },
  { uf: 'BA', name: 'Bahia', region: 'Nordeste' }, { uf: 'CE', name: 'Ceará', region: 'Nordeste' },
  { uf: 'DF', name: 'Distrito Federal', region: 'Centro-Oeste' }, { uf: 'ES', name: 'Espírito Santo', region: 'Sudeste' },
  { uf: 'GO', name: 'Goiás', region: 'Centro-Oeste' }, { uf: 'MA', name: 'Maranhão', region: 'Nordeste' },
  { uf: 'MT', name: 'Mato Grosso', region: 'Centro-Oeste' }, { uf: 'MS', name: 'Mato Grosso do Sul', region: 'Centro-Oeste' },
  { uf: 'MG', name: 'Minas Gerais', region: 'Sudeste' }, { uf: 'PA', name: 'Pará', region: 'Norte' },
  { uf: 'PB', name: 'Paraíba', region: 'Nordeste' }, { uf: 'PR', name: 'Paraná', region: 'Sul' },
  { uf: 'PE', name: 'Pernambuco', region: 'Nordeste' }, { uf: 'PI', name: 'Piauí', region: 'Nordeste' },
  { uf: 'RJ', name: 'Rio de Janeiro', region: 'Sudeste' }, { uf: 'RN', name: 'Rio Grande do Norte', region: 'Nordeste' },
  { uf: 'RS', name: 'Rio Grande do Sul', region: 'Sul' }, { uf: 'RO', name: 'Rondônia', region: 'Norte' },
  { uf: 'RR', name: 'Roraima', region: 'Norte' }, { uf: 'SC', name: 'Santa Catarina', region: 'Sul' },
  { uf: 'SP', name: 'São Paulo', region: 'Sudeste' }, { uf: 'SE', name: 'Sergipe', region: 'Nordeste' },
  { uf: 'TO', name: 'Tocantins', region: 'Norte' },
]

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const BY_UF = new Map(UFS.map(u => [u.uf, u]))
const BY_NAME = new Map(UFS.map(u => [plain(u.name), u.uf]))

// "sp", "SP", "São Paulo", "sao paulo", "São Paulo - SP" → "SP"; desconhecido → null
export function normalizeUf(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  const up = t.toUpperCase()
  if (BY_UF.has(up)) return up
  const tail = up.match(/(?:^|[\s\-/(,])([A-Z]{2})\)?$/)
  if (tail && BY_UF.has(tail[1])) return tail[1]
  return BY_NAME.get(plain(t)) ?? null
}

export const ufName = (uf: string) => BY_UF.get(uf)?.name ?? uf
