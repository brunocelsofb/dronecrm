'use client'

// Contas de recebimento do Varejo: quem gera o link do Pix e do cartão (InfinitePay,
// Mercado Pago ou manual). Chaves vão criptografadas e a tela só mostra o final.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveRetailPaymentSetup } from '@/lib/actions/retail-payments'
import { PAY_PROVIDERS, type PaymentSetup } from '@/lib/retail/payments'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'
const lbl = 'mb-1 block text-xs font-medium text-gray-600'

export function PaymentSetupForm({ setup, mpLast4, ipTokenSet, readOnly }: { setup: PaymentSetup; mpLast4: string | null; ipTokenSet: boolean; readOnly: boolean }) {
  const router = useRouter()
  const [pix, setPix] = useState(setup.pix_provider)
  const [card, setCard] = useState(setup.card_provider)
  const [handle, setHandle] = useState(setup.infinitepay_handle ?? '')
  const [mp, setMp] = useState('')
  const [ip, setIp] = useState('')
  const [removeMp, setRemoveMp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const usesIp = pix === 'infinitepay' || card === 'infinitepay'
  const usesMp = pix === 'mercadopago' || card === 'mercadopago'

  async function save() {
    setBusy(true); setMsg(null)
    const r = await saveRetailPaymentSetup({
      pix_provider: pix, card_provider: card, infinitepay_handle: handle.trim() || null,
      mp_token: removeMp ? null : mp.trim() ? mp.trim() : undefined,
      ip_token: ip.trim() ? ip.trim() : undefined,
    })
    setBusy(false)
    setMsg(r.ok ? { ok: true, text: 'Salvo. Os próximos links já usam esta configuração.' } : { ok: false, text: r.error })
    if (r.ok) { setMp(''); setIp(''); setRemoveMp(false); router.refresh() }
  }

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Recebimento: link de pagamento</h2>
        <p className="text-xs text-gray-500">Quem gera o link quando a cliente escolhe Pix ou cartão em &quot;Finalizar compra&quot;. Com InfinitePay ou Mercado Pago, o Drone cria o link com o valor certo e, quando o pagamento é aprovado, o pedido vira Pago sozinho (o Drone confere no serviço antes).</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className={lbl}>Pix</span>
          <select value={pix} disabled={readOnly} onChange={e => setPix(e.target.value as typeof pix)} className={inp}>
            {PAY_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="block"><span className={lbl}>Cartão</span>
          <select value={card} disabled={readOnly} onChange={e => setCard(e.target.value as typeof card)} className={inp}>
            {PAY_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      </div>

      {(usesIp || setup.infinitepay_handle) && (
        <div className="space-y-2 rounded-lg bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-900">InfinitePay</p>
          <label className="block"><span className={lbl}>InfiniteTag da loja (o @ que aparece no app, sem o $)</span>
            <input value={handle} disabled={readOnly} onChange={e => setHandle(e.target.value)} placeholder="ex.: minhaloja" autoCapitalize="none" autoCorrect="off" className={inp} />
          </label>
          <label className="block"><span className={lbl}>Token (só se a InfinitePay pedir) {ipTokenSet ? '· já cadastrado' : ''}</span>
            <input value={ip} disabled={readOnly} onChange={e => setIp(e.target.value)} type="password" autoComplete="off" placeholder={ipTokenSet ? 'Deixe em branco para manter' : 'Opcional'} className={inp} />
          </label>
        </div>
      )}

      {(usesMp || mpLast4) && (
        <div className="space-y-2 rounded-lg bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-900">Mercado Pago</p>
          <p className="text-xs text-gray-500">No painel de desenvolvedores do Mercado Pago (&quot;Suas integrações&quot;), abra a aplicação da loja e copie o <strong>Access Token de produção</strong> (começa com APP_USR-).</p>
          <label className="block"><span className={lbl}>Access Token {mpLast4 ? `· cadastrado (final ${mpLast4})` : ''}</span>
            <input value={mp} disabled={readOnly || removeMp} onChange={e => setMp(e.target.value)} type="password" autoComplete="off" placeholder={mpLast4 ? 'Deixe em branco para manter' : 'APP_USR-…'} className={inp} />
          </label>
          {mpLast4 && !readOnly && (
            <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={removeMp} onChange={e => setRemoveMp(e.target.checked)} /> Remover a chave do Mercado Pago</label>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar recebimento'}</button>
          {msg && <p role="status" className={`text-xs ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.text}</p>}
        </div>
      )}
      <p className="text-xs text-gray-500">Dica: faça um pedido de teste de valor baixo para conferir que o link abre e que o pedido vira Pago sozinho.</p>
    </section>
  )
}
