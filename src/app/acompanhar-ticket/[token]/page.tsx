import { createAdminClient } from '@/lib/supabase/admin'
import { PublicTicketReplyForm } from '@/components/tickets/public-ticket-reply-form'
import { TicketSatisfactionForm } from '@/components/tickets/ticket-satisfaction-form'
import { resolveTenantId } from '@/lib/tenant/context'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const STATUS_LABELS: Record<string, string> = {
  aberto: 'Aberto',
  em_andamento: 'Em andamento',
  aguardando_cliente: 'Aguardando sua resposta',
  resolvido: 'Resolvido',
  fechado: 'Fechado',
}

export default async function PublicTicketTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createAdminClient()

  const { data: ticket } = await supabase.from('tickets')
    .select('id, ticket_number, subject, status, priority, created_at, satisfaction_responded_at, satisfaction_rating, satisfaction_comment, tenant_id')
    .eq('public_token', token).maybeSingle()
  const { data: orgSettings } = await supabase.from('organization_settings')
    .select('support_bg_url, logo_storage_path, company_name')
    .eq('tenant_id', ticket?.tenant_id ?? await resolveTenantId()).maybeSingle()

  const rawBg   = orgSettings?.support_bg_url
  const rawLogo = orgSettings?.logo_storage_path
  const supportBgUrl = (rawBg && rawBg.startsWith('https://')) ? rawBg : null
  const logoUrl = (rawLogo && rawLogo.trim() && rawLogo !== 'null')
    ? supabase.storage.from('public-assets').getPublicUrl(rawLogo).data.publicUrl
    : null

  if (!ticket) {
    return (
      <div className="relative min-h-screen w-full">
        <div className="fixed inset-0 pointer-events-none -z-10" style={{ backgroundImage: supportBgUrl ? `url('${supportBgUrl}')` : undefined, backgroundColor: '#1B556B', backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }} />
        <main className="min-h-screen flex items-center justify-center px-4">
          <div className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-xl">Link inválido ou expirado.</div>
        </main>
      </div>
    )
  }

  const { data: messages } = await supabase.from('ticket_messages')
    .select('author_type, author_name, message, is_internal_note, created_at')
    .eq('ticket_id', ticket.id).eq('is_internal_note', false)
    .order('created_at', { ascending: true })

  const isFinalized = ticket.status === 'fechado'

  return (
    <div className="relative min-h-screen w-full">
      {/* Fundo fixo — mesmo padrão das pesquisas */}
      <div className="fixed inset-0 pointer-events-none -z-10" style={{ backgroundImage: supportBgUrl ? `url('${supportBgUrl}')` : undefined, backgroundColor: '#1B556B', backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }} />

      <main className="min-h-screen w-full flex flex-col items-center justify-start py-10 px-4">
        <div style={{ width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Logo */}
          {logoUrl && (
            <div style={{ width: 160, height: 48, backgroundImage: `url('${logoUrl}')`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', margin: '0 auto 8px' }} />
          )}

          {/* Header do ticket — padrão NPS */}
          <div className="rounded-xl bg-white/95 shadow-xl p-6">
            <div className="w-full border-b-4 border-[#E98C5F] pb-4 mb-2">
              <p className="text-xs font-semibold text-gray-400 mb-1">{ticket.ticket_number}</p>
              <h1 className="text-2xl font-bold text-[#1B556B]">{ticket.subject}</h1>
              <div className="mt-3">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  ticket.status === 'fechado' ? 'bg-gray-100 text-gray-800' :
                  ticket.status === 'aberto' ? 'bg-green-100 text-green-800' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {STATUS_LABELS[ticket.status]}
                </span>
              </div>
            </div>
          </div>

          {/* Mensagens */}
          <div className="space-y-2">
            {messages?.map((m, i) => (
              <div key={i} className={`flex ${m.author_type === 'cliente' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.author_type === 'cliente' ? 'bg-[#1B556B] text-white' : 'bg-white border border-gray-200 text-gray-800 shadow-sm'}`}>
                  <p>{m.message}</p>
                  <p className={`mt-1 text-[10px] ${m.author_type === 'cliente' ? 'text-white/70' : 'text-gray-400'}`}>
                    {m.author_name} · {new Date(m.created_at).toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Avaliação / Reply */}
          {isFinalized ? (
            ticket.satisfaction_responded_at ? (
              <div className="bg-white/95 backdrop-blur p-6 rounded-xl shadow-lg border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="bg-[#32AF9D] text-white p-2 rounded-full flex-shrink-0">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                  </div>
                  <h3 className="text-lg font-bold text-[#1B556B]">Avaliação enviada</h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-500">Sua nota para o atendimento:</p>
                    <p className="text-base font-medium text-gray-800 mt-1">
                      {ticket.satisfaction_rating === 1 && '😞 Muito insatisfeito'}
                      {ticket.satisfaction_rating === 2 && '😐 Insatisfeito'}
                      {ticket.satisfaction_rating === 3 && '😶 Nem satisfeito, nem insatisfeito'}
                      {ticket.satisfaction_rating === 4 && '😊 Satisfeito'}
                      {ticket.satisfaction_rating === 5 && '🤩 Muito satisfeito'}
                    </p>
                  </div>
                  {(ticket as any).satisfaction_comment && (
                    <div>
                      <p className="text-sm font-semibold text-gray-500">Seu comentário:</p>
                      <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-md mt-1 border border-gray-100">
                        {(ticket as any).satisfaction_comment}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white/95 rounded-xl shadow-xl p-4">
                <TicketSatisfactionForm token={token} />
              </div>
            )
          ) : (
            <div className="bg-white/95 rounded-xl shadow-xl p-4">
              <PublicTicketReplyForm token={token} />
            </div>
          )}

          <p className="text-center text-xs text-white/40 mt-2">
            {orgSettings?.company_name ?? 'ORBIS Engenharia'} © {new Date().getFullYear()}
          </p>
        </div>
      </main>
    </div>
  )
}
