// ─── Modelos dos avisos de renovação (Copiloto IA) ───────────────────────────
// Editáveis em Configurações → Copiloto IA → Avisos de renovação.
// Gravados em organization_settings.copilot_settings.renewal_templates.
// Sem 'use server': usado tanto no servidor (agente) quanto na tela.

export type RenewalLevelKey = '60' | '30' | '15' | '0'

export const RENEWAL_LEVELS: { key: RenewalLevelKey; label: string; hint: string }[] = [
  { key: '60', label: '60 dias antes',  hint: '1º aviso — abrir a conversa sobre renovação com antecedência' },
  { key: '30', label: '30 dias antes',  hint: '2º aviso — reforçar e marcar a reunião' },
  { key: '15', label: '15 dias antes',  hint: 'Aviso urgente — agendar o quanto antes' },
  { key: '0',  label: 'Após o vencimento', hint: 'Contrato vencido — regularizar e renovar' },
]

export const RENEWAL_VARIABLES: { key: string; description: string }[] = [
  { key: 'contato',    description: 'Primeiro nome do contato do contrato' },
  { key: 'cliente',    description: 'Nome do cliente (empresa)' },
  { key: 'contrato',   description: 'Número do contrato / processo' },
  { key: 'vencimento', description: 'Data de vencimento (dd/mm/aaaa)' },
  { key: 'dias',       description: 'Dias até o vencimento (ou dias vencido)' },
  { key: 'empresa',    description: 'Nome da sua empresa (Configurações Gerais)' },
  { key: 'consultor',  description: 'Nome do consultor que envia (WhatsApp escolhido no envio)' },
]

export const DEFAULT_RENEWAL_TEMPLATES: Record<RenewalLevelKey, string> = {
  '60':
    'Olá, {{contato}}! Tudo bem?\n\n' +
    'O contrato *{{contrato}}* ({{cliente}}) tem vigência até *{{vencimento}}* — faltam {{dias}} dias.\n\n' +
    'Gostaríamos de agendar uma reunião para conversarmos sobre a renovação. ' +
    'Qual dia e horário ficam melhores para você nas próximas semanas?\n\n' +
    '{{consultor}}\n{{empresa}}',
  '30':
    'Olá, {{contato}}! Tudo bem?\n\n' +
    'O contrato *{{contrato}}* ({{cliente}}) vence em *{{dias}} dias*, em *{{vencimento}}*.\n\n' +
    'Para garantirmos a continuidade dos serviços, gostaria de agendar uma reunião sobre a renovação. ' +
    'Pode me indicar um dia e horário nos próximos dias?\n\n' +
    '{{consultor}}\n{{empresa}}',
  '15':
    'Olá, {{contato}}!\n\n' +
    '⚠️ O contrato *{{contrato}}* ({{cliente}}) vence em *{{dias}} dias*, em *{{vencimento}}*.\n\n' +
    'Para não haver interrupção dos serviços, precisamos agendar a reunião de renovação com prioridade. ' +
    'Você tem disponibilidade ainda esta semana? Me indique o melhor dia e horário.\n\n' +
    '{{consultor}}\n{{empresa}}',
  '0':
    'Olá, {{contato}}!\n\n' +
    'O contrato *{{contrato}}* ({{cliente}}) venceu em *{{vencimento}}*.\n\n' +
    'Para regularizarmos a situação e seguirmos com a renovação, gostaria de agendar uma reunião com você. ' +
    'Qual o melhor dia e horário?\n\n' +
    '{{consultor}}\n{{empresa}}',
}

/** Mescla os textos salvos com os padrões (marco sem texto salvo usa o padrão). */
export function resolveRenewalTemplates(saved: unknown): Record<RenewalLevelKey, string> {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<RenewalLevelKey, unknown>>
  const out = { ...DEFAULT_RENEWAL_TEMPLATES }
  for (const { key } of RENEWAL_LEVELS) {
    const v = s[key]
    if (typeof v === 'string' && v.trim()) out[key] = v
  }
  return out
}

/** Troca {{variavel}} pelos valores informados; variáveis sem valor ficam como estão. */
export function renderRenewalTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const v = vars[key]
    return v === undefined || v === null ? match : v
  })
}

// ─── Assunto do e-mail (o corpo usa o mesmo texto do WhatsApp) ───────────────

export const DEFAULT_RENEWAL_EMAIL_SUBJECT = 'Renovação do contrato {{contrato}} — {{cliente}}'

export function resolveRenewalEmailSubject(saved: unknown): string {
  return typeof saved === 'string' && saved.trim() ? saved : DEFAULT_RENEWAL_EMAIL_SUBJECT
}

/** Converte o texto do WhatsApp em HTML de e-mail (*negrito* → <strong>, quebras de linha → <br>). */
export function whatsappTextToEmailHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/\r\n|\r|\n/g, '<br>')
}
