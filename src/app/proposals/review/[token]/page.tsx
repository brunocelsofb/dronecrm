import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { TechnicalDocument } from '@/components/proposals/technical-document'
import { ReviewForm } from '@/components/proposals/review-form'
import { redirect } from 'next/navigation'

export default async function ProposalReviewPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const admin = createAdminClient()

  // Busca a proposta pelo token
  const { data: proposal } = await admin
    .from('proposal_status')
    .select('*, contracts(id, client_name, title, process_number)')
    .eq('review_token', token)
    .maybeSingle()

  if (!proposal) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f7f7' }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: 32, textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <p style={{ fontSize: 18, color: '#1a1f36', marginBottom: 8 }}>Link inválido ou expirado</p>
          <p style={{ fontSize: 13, color: '#8892a4' }}>Este link de revisão não existe ou foi revogado.</p>
        </div>
      </div>
    )
  }

  // Verifica se o usuário está logado
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()

  if (!user) {
    redirect(`/login?redirect=/proposals/review/${token}`)
  }

  // Busca o perfil do usuário logado
  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', user.id)
    .maybeSingle()

  const canApprove = profile?.role === 'aprovador_tecnico' || profile?.role === 'admin'
  const snapshot = proposal.technical_snapshot as any
  const contract = (proposal as any).contracts
  const tipoEngenharia = snapshot?.tipoEngenharia ?? ''
  const isHospitalar = tipoEngenharia?.toLowerCase().includes('hospitalar')
  const isAlreadyReviewed = proposal.status !== 'em_aprovacao_tecnica'

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7f7', fontFamily: 'system-ui,-apple-system,sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '0.5px solid #e8edf5', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#1b556b,#32af9d)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#fff', fontSize: 14 }}>O</span>
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Revisão Técnica</p>
            <p style={{ fontSize: 11, color: '#8892a4', margin: 0 }}>{contract?.client_name} · {contract?.process_number}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#8892a4' }}>Logado como</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#1a1f36' }}>{profile?.full_name}</span>
          <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, background: canApprove ? '#e3f5f1' : '#f1f3f8', color: canApprove ? '#1f8c7d' : '#52514e' }}>
            {profile?.role === 'aprovador_tecnico' ? 'Aprovador Técnico' : profile?.role === 'admin' ? 'Admin' : 'Membro'}
          </span>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px' }}>

        {/* Aviso se já revisado */}
        {isAlreadyReviewed && (
          <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, background: '#fbeee5', border: '0.5px solid #ffe596', fontSize: 13, color: '#c2683d' }}>
            ⚠ Esta proposta já foi revisada — status: <strong>{proposal.status}</strong>. Esta página está em modo somente leitura.
          </div>
        )}

        {/* Aviso modo somente leitura */}
        <div style={{ marginBottom: 16, padding: '10px 16px', borderRadius: 10, background: '#e8e7f4', border: '0.5px solid #c5d3f8', fontSize: 12, color: '#524e9c', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🔒</span>
          <span>Modo somente leitura — nenhuma alteração pode ser feita na proposta por este link.</span>
        </div>

        {/* Documento técnico */}
        {snapshot ? (
          <TechnicalDocument
            snapshot={snapshot}
            showFinancials={false}
            isHospitalar={isHospitalar}

          />
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 32, textAlign: 'center' }}>
            <p style={{ color: '#8892a4' }}>Documento técnico não disponível.</p>
          </div>
        )}

        {/* Formulário de revisão */}
        {!isAlreadyReviewed && (
          <ReviewForm
            token={token}
            contractId={contract?.id}
            reviewerName={profile?.full_name ?? ''}
            reviewerRole={profile?.role ?? ''}
            canApprove={canApprove}
          />
        )}

        {/* Resultado se já revisado */}
        {isAlreadyReviewed && proposal.technical_comment && (
          <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20, marginTop: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', marginBottom: 12 }}>Parecer Técnico Registrado</p>
            <p style={{ fontSize: 13, color: '#52514e', lineHeight: 1.6 }}>{proposal.technical_comment}</p>
            {proposal.technical_restrictions && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: '#fbeee5', border: '0.5px solid #ffe596' }}>
                <p style={{ fontSize: 11, color: '#c2683d', fontWeight: 500, margin: '0 0 4px' }}>Restrições apontadas:</p>
                <p style={{ fontSize: 12, color: '#c2683d', margin: 0 }}>{proposal.technical_restrictions}</p>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
