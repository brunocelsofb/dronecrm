'use client'

// Formulários de Configurações → Privacidade e dados

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { acceptDpa } from '@/lib/actions/dpa'
import { grantSupportAccess, revokeSupportAccess } from '@/lib/actions/support-access'
import { savePrivacySettings } from '@/lib/actions/privacy'
import { RETENTION_OPTIONS } from '@/lib/privacy/settings'

const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const btn = 'rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-40'

export function DpaAcceptForm() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <div className="mt-3 space-y-2">
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} className="mt-0.5 accent-brand-700" />
        Li o contrato e aceito em nome da empresa, como administrador(a) com poderes para isso.
      </label>
      <button type="button" disabled={!ok || pending} className={btn}
        onClick={() => start(async () => { const r = await acceptDpa(ok); if (!r.ok) setErr(r.error); else { setErr(null); router.refresh() } })}>
        {pending ? 'Registrando…' : 'Aceitar contrato'}
      </button>
      {err && <p role="alert" className="text-xs text-negative-700">{err}</p>}
    </div>
  )
}

type Grant = { id: string; reason: string; expiresAt: string; createdAt: string; by: string; state: string }

export function SupportAccessPanel({ grants, readOnly }: { grants: Grant[]; readOnly: boolean }) {
  const router = useRouter()
  const [hours, setHours] = useState(4)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const active = grants.filter(g => g.state === 'ativa')
  return (
    <div className="mt-3 space-y-3">
      {active.length > 0 ? active.map(g => (
        <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-positive-100 px-3 py-2 text-sm text-positive-700">
          <span>Liberado até <b>{fmt(g.expiresAt)}</b> por {g.by} · motivo: {g.reason}</span>
          {!readOnly && (confirmId === g.id ? (
            <span className="flex items-center gap-2 text-xs">
              Tem certeza? O suporte sai na hora.
              <button type="button" disabled={pending} className="rounded bg-negative-600 px-2 py-1 font-medium text-white"
                onClick={() => start(async () => { const r = await revokeSupportAccess(g.id); if (!r.ok) setErr(r.error); setConfirmId(null); router.refresh() })}>Revogar</button>
              <button type="button" className="text-gray-600" onClick={() => setConfirmId(null)}>Cancelar</button>
            </span>
          ) : (
            <button type="button" className="text-xs font-medium text-negative-700 underline" onClick={() => setConfirmId(g.id)}>Revogar agora</button>
          ))}
        </div>
      )) : <p className="text-sm text-gray-500">Nenhum acesso de suporte liberado agora.</p>}

      {!readOnly && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 p-3">
          <label className="text-xs text-gray-600">Por quanto tempo
            <select value={hours} onChange={e => setHours(Number(e.target.value))} className="mt-1 block rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              <option value={1}>1 hora</option><option value={4}>4 horas</option><option value={24}>24 horas</option><option value={72}>3 dias</option>
            </select>
          </label>
          <label className="min-w-[16rem] flex-1 text-xs text-gray-600">Motivo (aparece para o suporte)
            <input value={reason} maxLength={300} onChange={e => setReason(e.target.value)} placeholder="Ex.: proposta não gera PDF" className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <button type="button" disabled={pending || reason.trim().length < 5} className={btn}
            onClick={() => start(async () => { const r = await grantSupportAccess({ hours, reason }); if (!r.ok) setErr(r.error); else { setErr(null); setReason(''); router.refresh() } })}>
            {pending ? 'Liberando…' : 'Liberar acesso (só leitura)'}
          </button>
        </div>
      )}
      {err && <p role="alert" className="text-xs text-negative-700">{err}</p>}
      {grants.some(g => g.state !== 'ativa') && (
        <p className="text-[11px] text-gray-400">Anteriores: {grants.filter(g => g.state !== 'ativa').slice(0, 8).map(g => `${fmt(g.createdAt)} (${g.state}) — ${g.reason}`).join(' · ')}</p>
      )}
    </div>
  )
}

export function RetentionForm({ initial, readOnly }: { initial: number | null; readOnly: boolean }) {
  const router = useRouter()
  const [days, setDays] = useState<number | null>(initial)
  const [confirm, setConfirm] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [pending, start] = useTransition()
  const shorter = days !== null && (initial === null || days < initial)
  const save = () => start(async () => {
    const r = await savePrivacySettings({ whatsapp_retention_days: days })
    setConfirm(false)
    setMsg(r.ok ? { ok: true, t: 'Salvo.' } : { ok: false, t: r.error })
    if (r.ok) router.refresh()
  })
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <select disabled={readOnly} value={days ?? ''} onChange={e => { setDays(e.target.value ? Number(e.target.value) : null); setMsg(null) }} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
        <option value="">Guardar enquanto durar o contrato</option>
        {RETENTION_OPTIONS.map(d => <option key={d} value={d}>Apagar depois de {d} dias</option>)}
      </select>
      {!readOnly && (confirm ? (
        <span className="flex items-center gap-2 text-xs text-warn-700">
          Tem certeza? Mensagens com mais de {days} dias serão apagadas na próxima rotina e não voltam.
          <button type="button" disabled={pending} onClick={save} className="rounded bg-negative-600 px-2 py-1 font-medium text-white">Confirmar</button>
          <button type="button" onClick={() => setConfirm(false)} className="text-gray-600">Cancelar</button>
        </span>
      ) : (
        <button type="button" disabled={pending || days === initial} className={btn} onClick={() => (shorter ? setConfirm(true) : save())}>Salvar</button>
      ))}
      {msg && <span className={`text-xs ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.t}</span>}
    </div>
  )
}
