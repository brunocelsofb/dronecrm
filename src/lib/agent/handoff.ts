// ─── Tarefa encaminhada (handoff) ────────────────────────────────────────────
// Ciclo: aviso automático ao destino (sino + WhatsApp + e-mail) → tarefa em nome de
// quem recebeu, com o dono da oportunidade acompanhando → quem recebeu escreve o que
// fez e conclui → o agente avisa quem acompanha → (régua) abre o próximo passo.
// Só servidor. Filtra a empresa em tudo (rotinas também chamam daqui).

import { createAdminClient } from '@/lib/supabase/admin'
import { scopeAdminClient } from '@/lib/tenant/scoped-admin'
import { inPreview, record } from './agent-preview'

type Db = ReturnType<typeof createAdminClient>
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.comercialdrone.com.br').replace(/\/$/, '')
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export const HANDOFF_MIN_NOTE = 5

// Avisa uma pessoa da equipe: sino sempre; WhatsApp (telefone do cadastro) e e-mail (pelo
// responsável pelos envios) quando houver. Interno: sai sozinho.
export async function notifyPerson(tenantId: string, userId: string | null | undefined, msg: { text: string; subject?: string; contractId?: string | null },
  channels: { sino?: boolean; whatsapp?: boolean; email?: boolean } = {}): Promise<string[]> {
  const ch = { sino: channels.sino !== false, whatsapp: channels.whatsapp !== false, email: channels.email !== false }
  if (!userId) return []
  const db = scopeAdminClient(createAdminClient(), tenantId, null)
  const [{ data: p }, { data: org }] = await Promise.all([
    db.from('profiles').select('id, full_name, phone, email').eq('id', userId).maybeSingle(),
    db.from('organization_settings').select('auto_sender_id').maybeSingle(),
  ])
  if (!p) return []
  const done: string[] = []
  if (inPreview()) {
    record({ kind: 'aviso', to: userId, text: msg.text })
    if (p.phone) record({ kind: 'whatsapp', to: String(p.phone), text: msg.text })
    if (p.email && msg.subject) record({ kind: 'email', to: String(p.email), subject: msg.subject, html: esc(msg.text) })
    return ['prévia']
  }
  if (ch.sino) {
    await db.from('notifications').insert({ user_id: userId, contract_id: msg.contractId ?? null, message: msg.text.slice(0, 500), read: false })
    done.push('sino')
  }
  const phone = String(p.phone ?? '').replace(/\D/g, '')
  if (ch.whatsapp && phone.length >= 10) {
    try {
      const { sendWhatsApp } = await import('./briefing-core')
      const r = await sendWhatsApp(msg.text, tenantId, phone)
      if (r.sent) done.push('WhatsApp')
    } catch { /* segue sem WhatsApp */ }
  }
  const sender = (org as { auto_sender_id?: string | null } | null)?.auto_sender_id
  if (ch.email && p.email && msg.subject && sender) {
    try {
      const { sendEmailForUser } = await import('@/lib/email/send')
      await sendEmailForUser(sender, String(p.email), msg.subject, `<div style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">${esc(msg.text)}</div>`)
      done.push('e-mail')
    } catch { /* segue sem e-mail */ }
  }
  return done
}

export type HandoffInput = {
  tenantId: string; contractId: string | null; companyId?: string | null
  toUserId: string | null; watcherId: string | null; alsoNotify?: string[]
  title: string; content: string; dueIso: string; agent?: 'farmer' | 'hunter'
  rulerRunId?: string | null; stepId?: string | null
  areaId?: string | null; areaName?: string | null   // régua com várias áreas: uma tarefa por área
  // Ao concluir, quem recebeu revisa este texto e ele vai para estas pessoas (sino, WhatsApp, e-mail) e e-mails de fora
  send?: { userIds: string[]; emails: string[]; areaNames: string[]; draft: string } | null
}

export const SEND_MIN_TEXT = 10

// Abre a tarefa em nome de quem recebe e avisa o destino (e quem mais for da área)
export async function createHandoff(h: HandoffInput): Promise<{ id: string | null }> {
  const db = scopeAdminClient(createAdminClient(), h.tenantId, null)
  const link = h.contractId ? `${appUrl()}/contracts/${h.contractId}` : appUrl()
  if (inPreview()) record({ kind: 'atividade', title: h.title, content: h.content, assignedTo: h.toUserId, due: h.dueIso })
  let id: string | null = null
  if (!inPreview()) {
    const { data } = await db.from('activities').insert({
      contract_id: h.contractId, company_id: h.companyId ?? null, user_id: null, assigned_to: h.toUserId,
      type: 'task', activity_type: 'task', status: 'planned', completed: false,
      title: h.title, content: h.content, activity_date: h.dueIso,
      metadata: { source: 'copiloto_ia', kind: 'handoff', agent: h.agent ?? 'farmer', watcher_id: h.watcherId, needs_note: true, ruler_run_id: h.rulerRunId ?? null, step_id: h.stepId ?? null, area_id: h.areaId ?? null, area_name: h.areaName ?? null, also_notify: h.alsoNotify ?? [], send: h.send ?? null },
    }).select('id').single()
    id = (data?.id as string) ?? null
  }
  const due = h.dueIso.split('-').reverse().join('/')
  const text = `📌 *${h.title}*\n${h.content}\n\nPrazo: ${due}\nAo terminar, escreva no CRM o que foi feito e conclua a tarefa: ${link}`
  for (const u of [...new Set([h.toUserId, ...(h.alsoNotify ?? [])].filter(Boolean) as string[])]) {
    await notifyPerson(h.tenantId, u, { text, subject: h.title, contractId: h.contractId })
  }
  return { id }
}

// Conclusão com "o que foi feito": registra, avisa quem acompanha e avança a régua
export async function completeHandoff(tenantId: string, activityId: string, userId: string, note: string, sendText?: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = String(note ?? '').trim()
  if (text.length < HANDOFF_MIN_NOTE) return { ok: false, error: 'Escreva o que foi feito para concluir.' }
  const db: Db = scopeAdminClient(createAdminClient(), tenantId, userId)
  const { data: a } = await db.from('activities').select('id, contract_id, title, metadata, status').eq('id', activityId).maybeSingle()
  if (!a) return { ok: false, error: 'Tarefa não encontrada.' }
  if (a.status === 'done') return { ok: true }
  const meta = (a.metadata ?? {}) as Record<string, unknown>
  const send = meta.send as { userIds: string[]; emails: string[]; areaNames: string[] } | null | undefined
  const outText = String(sendText ?? '').trim()
  if (send && outText.length < SEND_MIN_TEXT) return { ok: false, error: 'Revise o texto que vai para o time antes de concluir.' }
  // Passo da régua que pede anexo: confere antes de fechar a tarefa
  if (meta.ruler_run_id && meta.step_id) {
    const { rulerStepBlock } = await import('./renewal-ruler-engine')
    const block = await rulerStepBlock(tenantId, String(meta.ruler_run_id), String(meta.step_id), meta.area_id ? userId : null)
    if (block) return { ok: false, error: block }
  }
  const { data: me } = await db.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  const who = (me?.full_name as string) ?? 'Alguém'
  const now = new Date().toISOString()
  const { error } = await db.from('activities').update({
    status: 'done', completed: true,
    metadata: { ...meta, done_note: text.slice(0, 2000), done_by: userId, done_by_name: who, done_at: now },
  }).eq('id', activityId)
  if (error) return { ok: false, error: error.message }
  if (a.contract_id) {
    await db.from('activities').insert({ contract_id: a.contract_id, user_id: userId, type: 'system', content: `✅ ${who} concluiu "${a.title}". O que foi feito: ${text.slice(0, 1500)}`, metadata: { kind: 'handoff_done', handoff_id: activityId } })
  }
  // Texto revisado para o time (comunicação interna etc.)
  if (send && outText) {
    const subject = String(a.title).replace(/^Renovação · /, '')
    const sentTo: string[] = []
    for (const u of [...new Set(send.userIds)].filter(u => u !== userId)) {
      const ch = await notifyPerson(tenantId, u, { text: `📣 ${outText.slice(0, 3500)}\n\n— ${who}`, subject, contractId: (a.contract_id as string | null) ?? null })
      if (ch.length) sentTo.push(u)
    }
    let ext = 0
    const { data: org } = await db.from('organization_settings').select('auto_sender_id').maybeSingle()
    const sender = (org as { auto_sender_id?: string | null } | null)?.auto_sender_id
    if (sender && send.emails.length) {
      try {
        const { sendEmailForUser } = await import('@/lib/email/send')
        await sendEmailForUser(sender, send.emails.join(', '), subject, `<div style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">${esc(outText)}\n\n— ${esc(who)}</div>`)
        ext = send.emails.length
      } catch { /* segue */ }
    }
    if (a.contract_id) {
      await db.from('activities').insert({ contract_id: a.contract_id, user_id: userId, type: 'system',
        content: `📣 ${who} enviou "${subject}" para ${send.areaNames.join(', ')} (${sentTo.length} pessoa(s)${ext ? ` + ${ext} e-mail(s) de fora` : ''}). Texto: ${outText.slice(0, 1500)}`,
        metadata: { kind: 'handoff_sent', handoff_id: activityId } })
    }
  }
  // Régua: concluir a tarefa conclui o passo e abre o próximo. Passo com várias áreas: só quando todas concluírem.
  let next = ''
  if (meta.ruler_run_id && meta.step_id && a.contract_id) {
    try {
      const { data: same } = await db.from('activities').select('id, status, metadata')
        .eq('metadata->>kind', 'handoff').eq('metadata->>ruler_run_id', String(meta.ruler_run_id)).eq('metadata->>step_id', String(meta.step_id))
      const rows = ((same ?? []) as { id: string; status: string; metadata: Record<string, unknown> | null }[]).filter(x => x.id !== activityId)
      const pending = rows.filter(x => x.status !== 'done').map(x => String(x.metadata?.area_name ?? 'outra área'))
      const { completeRulerStep, openRun } = await import('./renewal-ruler-engine')
      // Nota do passo: o que cada área fez
      const parts = [
        ...rows.filter(x => x.status === 'done' && x.metadata?.area_name).map(x => `${x.metadata!.area_name}: ${String(x.metadata!.done_note ?? 'concluído')}`),
        ...(meta.area_name ? [`${meta.area_name}: ${text}`] : []),
      ]
      const stepNote = meta.area_id && parts.length > 1 ? parts.join(' · ') : text
      const r = pending.length
        ? { ok: false as const, error: '' }
        : await completeRulerStep(tenantId, String(meta.ruler_run_id), String(meta.step_id), userId, stepNote)
      if (pending.length) next = `\nO passo segue aberto até concluírem: ${pending.join(', ')}.`
      if (r.ok) {
        const run = await openRun(tenantId, a.contract_id as string)
        const { openStepIndexes } = await import('./renewal-ruler')
        const open = run ? openStepIndexes(run.steps).map(i => run.steps[i]) : []
        if (open.length) next = `\n${open.length > 1 ? 'Em andamento' : 'Próximo passo'}: ${open.map(st => `*${st.label}*${st.due_date ? ` (prazo ${st.due_date.split('-').reverse().join('/')})` : ''}`).join(', ')}.`
        else next = '\nTodos os passos da régua concluídos.'
      }
    } catch (e) { console.error('[handoff] régua:', e) }
  }
  const watcher = meta.watcher_id as string | null
  if (watcher && watcher !== userId) {
    const link = a.contract_id ? `${appUrl()}/contracts/${a.contract_id}` : appUrl()
    await notifyPerson(tenantId, watcher, {
      text: `🤖 Farmer: ✅ ${who} concluiu *${a.title}*.\nO que foi feito: ${text.slice(0, 800)}${next}\n${link}`,
      subject: `Concluído: ${a.title}`, contractId: (a.contract_id as string | null) ?? null,
    })
  }
  return { ok: true }
}
