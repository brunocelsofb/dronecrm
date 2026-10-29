'use client'

// Zerar a loja: recomeçar com um estoque novo. O Estúdio IA fica intacto.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { resetRetailStore } from '@/lib/actions/retail-products'

export function ResetStore({ pecas, pedidos, ia }: { pecas: number; pedidos: number; ia: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function go() {
    setBusy(true); setMsg(null)
    const r = await resetRetailStore(text)
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    const s = r.summary
    setMsg({ ok: true, text: `Loja zerada: ${s.pecas ?? 0} peça(s), ${s.variacoes ?? 0} cor/tamanho, ${s.looks ?? 0} look(s) e ${s.pedidos ?? 0} pedido(s) apagados. O Estúdio IA continua com tudo. Agora suba o estoque novo em Produtos.` })
    setOpen(false); setText(''); router.refresh()
  }
  return (
    <section className="space-y-3 rounded-xl border border-negative-600/30 bg-white p-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Zerar a loja</h2>
        <p className="mt-1 text-sm text-gray-700">Para recomeçar do zero com um estoque novo e testar de ponta a ponta.</p>
      </div>
      <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg bg-negative-100/60 p-3 text-negative-700"><p className="font-medium">Apaga</p><p className="text-xs">Peças ({pecas}), cores, tamanhos, estoque e o histórico, fotos das peças, looks e pedidos ({pedidos}).</p></div>
        <div className="rounded-lg bg-positive-100/60 p-3 text-positive-700"><p className="font-medium">Fica intacto</p><p className="text-xs">Estúdio IA ({ia} imagens: modelos, cenários e fotos geradas) e a sua conta de IA, aparência da vitrine, Custos e preço, Mensagens e Clientes.</p></div>
      </div>
      {!open ? (
        <button type="button" className="rounded-lg border border-negative-600 px-4 py-2 text-sm font-medium text-negative-700 hover:bg-negative-100" onClick={() => { setOpen(true); setMsg(null) }}>Zerar a loja…</button>
      ) : (
        <div className="space-y-2 rounded-lg border border-negative-600/40 p-3">
          <p className="text-sm text-gray-800"><strong>Não tem como desfazer.</strong> Se quiser guardar uma cópia, baixe antes a <a href="/api/varejo/planilha" className="text-brand-700 underline">planilha preenchida</a>. Para confirmar, digite <strong>ZERAR</strong>.</p>
          <input className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm" value={text} onChange={e => setText(e.target.value)} placeholder="ZERAR" aria-label="Digite ZERAR" />
          <div className="flex gap-2">
            <button type="button" disabled={busy || text.trim().toUpperCase() !== 'ZERAR'} onClick={go} className="rounded-lg bg-negative-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Zerando…' : 'Zerar agora'}</button>
            <button type="button" disabled={busy} onClick={() => { setOpen(false); setText('') }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">Cancelar</button>
          </div>
        </div>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}</p>}
    </section>
  )
}
