'use client'
// Tarefa encaminhada: para concluir, quem recebeu escreve o que foi feito (vai para quem acompanha)
import { useState } from 'react'
import { updateActivityStatus } from '@/lib/actions/activities'

export function useHandoffDone(onDone: (id: string) => void) {
  const [askId, setAskId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Tenta concluir; se for tarefa encaminhada, abre a janela pedindo o que foi feito
  async function toggle(id: string, next: 'planned' | 'done'): Promise<boolean> {
    const r = await updateActivityStatus(id, next)
    if (r.needsNote) { setAskId(id); setNote(''); setErr(null); return false }
    if (r.error) { setErr(r.error); return false }
    return true
  }

  const modal = askId ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Concluir tarefa encaminhada">
      <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl">
        <p className="text-sm font-semibold text-gray-900">O que foi feito?</p>
        <p className="text-xs text-gray-500">Esta tarefa foi encaminhada. O texto vai para quem acompanha (o responsável pela oportunidade) e fica no histórico.</p>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} maxLength={2000} autoFocus
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" placeholder="Ex.: análise feita; reajuste de 4,5%; escopo mantido; enviei a planilha no e-mail." />
        {err && <p className="text-xs text-negative-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setAskId(null)} className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">Cancelar</button>
          <button type="button" disabled={busy || note.trim().length < 5} onClick={async () => {
            setBusy(true); setErr(null)
            const r = await updateActivityStatus(askId, 'done', note)
            setBusy(false)
            if (r.error || r.needsNote) { setErr(r.error ?? 'Escreva o que foi feito.'); return }
            const id = askId; setAskId(null); onDone(id)
          }} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Concluindo…' : 'Concluir e avisar'}</button>
        </div>
      </div>
    </div>
  ) : null
  return { toggle, modal, error: askId ? null : err }
}
