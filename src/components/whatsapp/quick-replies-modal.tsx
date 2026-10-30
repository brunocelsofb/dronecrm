'use client'
// Respostas rápidas da empresa: digite "/" no campo de mensagem para usar.
import { useState } from 'react'
import { saveQuickReply, deleteQuickReply, type QuickReply } from '@/lib/actions/whatsapp-chat'

export function QuickRepliesModal({ replies, onChange, onClose }: {
  replies: QuickReply[]
  onChange: (list: QuickReply[]) => void
  onClose: () => void
}) {
  const [editing, setEditing] = useState<{ id: string | null; shortcut: string; body: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!editing) return
    setBusy(true); setError(null)
    const r = await saveQuickReply(editing)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    const reply = r.reply!
    const rest = replies.filter(x => x.id !== reply.id)
    onChange([...rest, reply].sort((a, b) => a.shortcut.localeCompare(b.shortcut)))
    setEditing(null)
  }

  async function remove(q: QuickReply) {
    if (!confirm(`Apagar a resposta rápida /${q.shortcut}?`)) return
    setBusy(true); setError(null)
    const r = await deleteQuickReply(q.id)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    onChange(replies.filter(x => x.id !== q.id))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="qr-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-4">
          <div>
            <h2 id="qr-title" className="text-sm font-semibold text-gray-900">⚡ Respostas rápidas</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              No campo de mensagem, digite <b>/</b> e o atalho. Valem para toda a equipe da empresa.
              Use <code className="rounded bg-gray-100 px-1">{'{nome}'}</code> para o primeiro nome do contato e{' '}
              <code className="rounded bg-gray-100 px-1">{'{atendente}'}</code> para o seu nome.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Fechar">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {editing ? (
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-700">Atalho</span>
                <div className="mt-1 flex items-center rounded-md border border-gray-300 focus-within:border-brand-700">
                  <span className="pl-2 text-sm text-gray-400">/</span>
                  <input autoFocus value={editing.shortcut} maxLength={30}
                    onChange={e => setEditing({ ...editing, shortcut: e.target.value })}
                    placeholder="boasvindas" className="w-full bg-transparent px-1 py-1.5 text-sm outline-none" />
                </div>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-700">Texto</span>
                <textarea value={editing.body} rows={5} maxLength={4000}
                  onChange={e => setEditing({ ...editing, body: e.target.value })}
                  placeholder="Olá {nome}! Aqui é {atendente}. Como posso ajudar?"
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
              </label>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setEditing(null); setError(null) }} disabled={busy}
                  className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50">Cancelar</button>
                <button onClick={save} disabled={busy}
                  className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
                  {busy ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {replies.length === 0 && (
                <p className="py-6 text-center text-xs text-gray-400">Nenhuma resposta rápida ainda.</p>
              )}
              <ul className="divide-y divide-gray-100">
                {replies.map(q => (
                  <li key={q.id} className="flex items-start gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-brand-700">/{q.shortcut}</p>
                      <p className="line-clamp-2 whitespace-pre-wrap text-xs text-gray-600">{q.body}</p>
                    </div>
                    <button onClick={() => setEditing({ id: q.id, shortcut: q.shortcut, body: q.body })}
                      className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100" title="Editar">✏️</button>
                    <button onClick={() => remove(q)} disabled={busy}
                      className="rounded px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50" title="Apagar">🗑</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>

        {!editing && (
          <div className="border-t border-gray-100 p-3 text-right">
            <button onClick={() => setEditing({ id: null, shortcut: '', body: '' })}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
              ＋ Nova resposta
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
