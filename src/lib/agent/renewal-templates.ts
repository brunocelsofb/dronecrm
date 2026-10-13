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

// ─── E-mail ao cliente no formato "automático" (faixa + detalhes do contrato) ─

export type RenewalEmailData = {
  level: number                  // 60 | 30 | 15 | 0
  daysUntilExpiry: number
  messageText: string            // texto final (mesmo do WhatsApp)
  contractNumber: string | null
  clientName: string
  validUntil: string | null      // dd/mm/aaaa
  monthlyValue: string | null    // já formatado (R$ ...)
  consultorName: string | null
  consultorEmail: string | null
  commercialEmail?: string | null   // e-mail comercial da empresa, exibido junto ao do consultor
  companyName: string
}

// Paleta da marca por gravidade do aviso (Configurações → Copiloto IA)
export const RENEWAL_SEVERITY: Record<'60' | '30' | '15' | '0', { label: string; bg: string; fg: string; badgeBg: string; badgeFg: string }> = {
  '60': { label: 'INFORMATIVO', bg: '#1B556B', fg: '#FFFFFF', badgeBg: '#83D0F5', badgeFg: '#1B556B' },
  '30': { label: 'ATENÇÃO',     bg: '#00AFD1', fg: '#0B3A49', badgeBg: '#0B3A49', badgeFg: '#FFFFFF' },
  '15': { label: 'URGENTE',     bg: '#E98C5F', fg: '#1B2A33', badgeBg: '#1B2A33', badgeFg: '#FFFFFF' },
  '0':  { label: 'CRÍTICO',     bg: '#AF5B65', fg: '#FFFFFF', badgeBg: '#FFFFFF', badgeFg: '#AF5B65' },
}

export const DEFAULT_COMMERCIAL_EMAIL = 'comercial@orbisengenharia.com.br'

export function resolveCommercialEmail(saved: unknown): string {
  return typeof saved === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(saved.trim()) ? saved.trim() : DEFAULT_COMMERCIAL_EMAIL
}

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildRenewalEmailHtml(d: RenewalEmailData): string {
  const expired = d.level === 0 || d.daysUntilExpiry < 0
  const sev = RENEWAL_SEVERITY[expired ? '0' : d.level <= 15 ? '15' : d.level <= 30 ? '30' : '60']
  const header = expired
    ? 'Contrato vencido — regularização e renovação'
    : d.level <= 15 ? `Aviso urgente: ${d.daysUntilExpiry} dias para o vencimento`
    : d.level <= 30 ? `Aviso de vencimento: ${d.daysUntilExpiry} dias`
    : `Renovação do contrato: ${d.daysUntilExpiry} dias para o vencimento`

  const detail = (label: string, value: string | null) =>
    value ? `<p style="margin:0 0 4px;color:#333;font-size:14px;">${label}: <strong>${esc(value)}</strong></p>` : ''

  const contact = [
    d.consultorName ? `👤 ${esc(d.consultorName)}` : '',
    d.consultorEmail ? `📧 <a href="mailto:${esc(d.consultorEmail)}" style="color:#1B556B;">${esc(d.consultorEmail)}</a>` : '',
    d.commercialEmail && d.commercialEmail !== d.consultorEmail
      ? `📧 <a href="mailto:${esc(d.commercialEmail)}" style="color:#1B556B;">${esc(d.commercialEmail)}</a> (Comercial)`
      : '',
    `🏢 ${esc(d.companyName)}`,
  ].filter(Boolean).join('<br>')

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
      <tr><td style="background:${sev.bg};padding:22px 32px;">
        <span style="display:inline-block;background:${sev.badgeBg};color:${sev.badgeFg};font-size:11px;font-weight:bold;letter-spacing:1px;padding:3px 10px;border-radius:20px;">${sev.label}</span>
        <p style="margin:10px 0 0;color:${sev.fg};font-size:18px;font-weight:bold;">${esc(header)}</p>
      </td></tr>
      <tr><td style="padding:32px;color:#1a1a1a;font-size:15px;line-height:1.6;">
        ${whatsappTextToEmailHtml(d.messageText)}
        <table cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;width:100%;margin:24px 0;">
          <tr><td style="padding:16px;">
            <p style="margin:0 0 8px;color:#555;font-size:13px;"><strong>📄 Detalhes do contrato</strong></p>
            ${detail('Cliente', d.clientName)}
            ${detail('Número', d.contractNumber)}
            ${detail('Vencimento', d.validUntil)}
            ${detail('Valor de referência', d.monthlyValue)}
          </td></tr>
        </table>
        <p style="margin:0 0 6px;color:#444;font-size:14px;">Em caso de dúvidas, fale com:</p>
        <p style="margin:0;color:#444;font-size:14px;line-height:1.7;">${contact}</p>
      </td></tr>
      <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;color:#888;font-size:12px;">Mensagem enviada pelo sistema de gestão de contratos da ${esc(d.companyName)}. Responda este e-mail para falar com o consultor.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}
