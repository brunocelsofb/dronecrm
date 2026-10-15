// Modelo de importação de empresas (CSV) — usado no navegador e no servidor.

export type ImportColumn = {
  key: string            // nome da coluna no arquivo
  label: string
  required?: boolean
  hint: string
  example: string
  aliases?: string[]     // outros nomes aceitos (sem acento, minúsculo)
}

export const STATUS_VALUES: Record<string, string> = {
  lead: 'lead', prospect: 'prospect',
  'cliente ativo': 'cliente_ativo', cliente_ativo: 'cliente_ativo', ativo: 'cliente_ativo',
  'cliente inativo': 'cliente_inativo', cliente_inativo: 'cliente_inativo', inativo: 'cliente_inativo',
  'nao qualificado': 'nao_qualificado', nao_qualificado: 'nao_qualificado',
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'razao_social', label: 'Razão social', required: true, hint: 'Nome oficial da empresa', example: 'Hospital Exemplo Ltda', aliases: ['razao social', 'nome', 'name', 'empresa'] },
  { key: 'nome_fantasia', label: 'Nome fantasia', hint: 'Como a empresa é conhecida', example: 'Hospital Exemplo', aliases: ['nome fantasia', 'fantasia', 'trade_name'] },
  { key: 'cnpj', label: 'CNPJ', hint: 'Com ou sem pontuação. Evita duplicar: CNPJ já cadastrado é pulado', example: '12.345.678/0001-90' },
  { key: 'status', label: 'Status', hint: 'lead, prospect, cliente ativo, cliente inativo ou nao qualificado (vazio = lead)', example: 'cliente ativo' },
  { key: 'segmento', label: 'Segmento', hint: 'Texto livre', example: 'Grupo Hospitalar (Geral e especializado)', aliases: ['segment'] },
  { key: 'telefone', label: 'Telefone', hint: 'Telefone da empresa', example: '(62) 3333-4444', aliases: ['phone', 'fone'] },
  { key: 'email', label: 'E-mail', hint: 'E-mail geral da empresa', example: 'contato@hospitalexemplo.com.br', aliases: ['e-mail'] },
  { key: 'cep', label: 'CEP', hint: 'Somente o CEP', example: '74000-000', aliases: ['zip_code'] },
  { key: 'logradouro', label: 'Logradouro', hint: 'Rua, avenida...', example: 'Av. Central', aliases: ['rua', 'endereco', 'street'] },
  { key: 'numero', label: 'Número', hint: 'Número do endereço', example: '1000', aliases: ['street_number'] },
  { key: 'bairro', label: 'Bairro', hint: '', example: 'Setor Central', aliases: ['neighborhood'] },
  { key: 'cidade', label: 'Cidade', hint: '', example: 'Goiânia', aliases: ['city', 'municipio'] },
  { key: 'uf', label: 'UF', hint: 'Sigla do estado', example: 'GO', aliases: ['estado', 'state'] },
  { key: 'observacoes', label: 'Observações', hint: 'Anotações livres', example: '', aliases: ['notes', 'obs'] },
  { key: 'contato_nome', label: 'Contato — nome', hint: 'Se preencher, cria o contato principal da empresa', example: 'Maria Souza', aliases: ['contato'] },
  { key: 'contato_cargo', label: 'Contato — cargo', hint: '', example: 'Gerente de Engenharia Clínica' },
  { key: 'contato_email', label: 'Contato — e-mail', hint: 'Usado nos avisos de renovação', example: 'maria@hospitalexemplo.com.br' },
  { key: 'contato_telefone', label: 'Contato — WhatsApp', hint: 'Com DDD (o 55 é colocado sozinho). Usado nos avisos', example: '(62) 99999-0000', aliases: ['contato_whatsapp'] },
]

export const EXAMPLE_MARK = 'EXEMPLO'

// CSV com ";" (o Excel em português abre certo) e BOM (acentos)
export function buildTemplateCsv(withExample = true): string {
  const head = IMPORT_COLUMNS.map(c => c.key).join(';')
  const example = IMPORT_COLUMNS.map(c => (c.key === 'razao_social' ? `${EXAMPLE_MARK} - ${c.example} (apague esta linha)` : c.example))
    .map(v => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(';')
  return '﻿' + head + (withExample ? `\r\n${example}` : '') + '\r\n'
}

export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
}

// Mapa "nome da coluna no arquivo" → chave do modelo
export function headerToKey(h: string): string | null {
  const n = normalizeHeader(h)
  for (const c of IMPORT_COLUMNS) {
    if (n === c.key || n === normalizeHeader(c.label) || n.replace(/ /g, '_') === c.key || (c.aliases ?? []).some(a => normalizeHeader(a) === n)) return c.key
  }
  return null
}
