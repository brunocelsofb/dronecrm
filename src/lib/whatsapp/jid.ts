// Telefone do CRM (sem 55) → endereços do WhatsApp a procurar

// Variações do número no WhatsApp: com 55 e com/sem o 9º dígito
export function jidCandidates(phone: string): string[] {
  let d = phone.replace(/\D/g, '')
  if (d.length === 10 || d.length === 11) d = `55${d}`
  const out = new Set<string>([d])
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') out.add(d.slice(0, 4) + d.slice(5))   // sem o 9
  if (d.startsWith('55') && d.length === 12) out.add(d.slice(0, 4) + '9' + d.slice(4))              // com o 9
  return [...out].map(n => `${n}@s.whatsapp.net`)
}
