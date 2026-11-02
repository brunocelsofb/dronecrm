// ─── Processo de renovação no funil (regras puras) ───────────────────────────
// O cartão vai para a etapa de renovação junto com o "preparar a renovação" do agente
// (Central de regras → Renovação; padrão 90 dias antes do vencimento). Mover o cartão
// fora desse processo pede confirmação (digitar "mudar"; motivo opcional) e fica registrado quem mudou.

export const OVERRIDE_WORD = 'mudar'

export type ProcessCheck = { ok: true } | { ok: false; message: string }

// targetStage = etapa de destino; renewalStage = etapa de renovação do funil; daysLeft = dias até o vencimento
export function renewalMoveCheck(o: {
  renewalStageId: string | null; fromStageId: string; toStageId: string
  daysLeft: number | null; prepDays: number; renewalStageName?: string
}): ProcessCheck {
  if (!o.renewalStageId || o.daysLeft === null) return { ok: true }
  const name = o.renewalStageName ?? 'renovação'
  if (o.toStageId === o.renewalStageId && o.fromStageId !== o.renewalStageId && o.daysLeft > o.prepDays) {
    return { ok: false, message: `Fora do processo: o contrato vence em ${o.daysLeft} dias. Pela regra, ele entra em "${name}" sozinho a ${o.prepDays} dias do vencimento, junto com o "preparar a renovação".` }
  }
  if (o.fromStageId === o.renewalStageId && o.toStageId !== o.renewalStageId && o.daysLeft <= o.prepDays) {
    return { ok: false, message: `Fora do processo: o contrato vence em ${o.daysLeft} dias e está no período de renovação (a partir de ${o.prepDays} dias). Tirar da etapa "${name}" agora sai do processo; o sistema não vai trazer de volta sozinho.` }
  }
  return { ok: true }
}

// Confirmação simples: digitar "mudar" (maiúsculas ou minúsculas). O motivo é opcional.
export function overrideProblem(o: { word?: string; reason?: string } | null | undefined): string | null {
  if (!o) return `Para confirmar, digite ${OVERRIDE_WORD}.`
  if (String(o.word ?? '').trim().toLowerCase() !== OVERRIDE_WORD) return `Para confirmar, digite ${OVERRIDE_WORD}.`
  return null
}
export const reasonText = (r: string | null | undefined) => String(r ?? '').trim() || 'sem motivo informado'
