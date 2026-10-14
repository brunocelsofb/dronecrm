import { createAdminClient } from '@/lib/supabase/admin'
import { NpsForm } from '@/components/nps/nps-form'
import { LogoBadge } from '@/components/ui/logo-badge'
import { resolveTenantId } from '@/lib/tenant/context'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function NpsPublicPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const adminClient = createAdminClient()

  const { data: survey } = await adminClient
    .from('nps_surveys')
    .select('id, status, contract_id')
    .eq('token', token)
    .maybeSingle()

  let clientDisplayName = ''
  // CORREÇÃO: a pergunta do NPS precisa citar o nome da ORGANIZAÇÃO que
  // presta o serviço (ex: "ORBIS"), não o nome do cliente que está
  // respondendo — antes estava invertido.
  const { data: orgSettings } = await adminClient
    .from('organization_settings')
    .select('company_name, logo_storage_path, nps_bg_url')
    .eq('tenant_id', await resolveTenantId({ contractId: survey?.contract_id ?? null }))
    .maybeSingle()
  const organizationName = orgSettings?.company_name || 'nossa empresa'
  const rawLogoPath = orgSettings?.logo_storage_path
  let finalLogoUrl: string | null = null
  if (rawLogoPath && rawLogoPath.trim() && rawLogoPath !== 'null') {
    if (rawLogoPath.startsWith('http')) {
      finalLogoUrl = rawLogoPath
    } else {
      const { data } = adminClient.storage.from('public-assets').getPublicUrl(rawLogoPath)
      finalLogoUrl = data.publicUrl
    }
  }


  if (survey) {
    const { data: contract } = await adminClient
      .from('contracts')
      .select('client_name, company_id')
      .eq('id', survey.contract_id)
      .maybeSingle()

    clientDisplayName = contract?.client_name ?? ''

    if (contract?.company_id) {
      const { data: company } = await adminClient
        .from('companies')
        .select('name')
        .eq('id', contract.company_id)
        .maybeSingle()
      if (company?.name) clientDisplayName = company.name
    }
  }

  const rawSurveyBg = (orgSettings as any)?.nps_bg_url
  const surveyBgUrl = (rawSurveyBg && rawSurveyBg.startsWith('https://')) ? rawSurveyBg : null

  return (
    <div className="relative min-h-screen w-full">
      <div className="fixed inset-0 pointer-events-none -z-10" style={{ backgroundImage: surveyBgUrl ? `url('${surveyBgUrl}')` : undefined, backgroundColor: '#1B556B', backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }} />
      <div className="fixed inset-0 pointer-events-none -z-10" style={{ background: 'rgba(0,0,0,0.1)' }} />
      <main className="min-h-screen w-full flex flex-col items-center justify-start py-10 px-4">
        <div className="w-full max-w-2xl flex flex-col gap-5">
          <div className="w-full bg-white/95 shadow-xl rounded-2xl p-6 md:p-8">
            {/* Cabeçalho padronizado ORBIS */}
            <div className="w-full border-b-4 border-[#E98C5F] pb-4 mb-6 flex flex-row items-center justify-between gap-4">
              <div className="flex-shrink-0">
                <LogoBadge src={finalLogoUrl ?? undefined} />
              </div>
              <div className="flex flex-col items-end text-right">
                <h1 className="text-xl md:text-2xl font-bold text-[#1B556B]">Pesquisa de Satisfação</h1>
                <p className="text-xs md:text-sm font-medium text-[#32AF9D] mt-1">Sua opinião é muito importante.</p>
              </div>
            </div>

            {!survey ? (
              <p className="text-center text-sm text-gray-500">Este link de pesquisa não é válido. Se você acredita que isso é um erro, entre em contato com quem enviou o link.</p>
            ) : survey.status === 'answered' ? (
              <div className="text-center">
                <p className="text-lg font-medium text-gray-900">Obrigado!</p>
                <p className="mt-1 text-sm text-gray-500">Sua resposta a esta pesquisa já foi registrada anteriormente.</p>
              </div>
            ) : (
              <>
                {clientDisplayName && <p className="mb-4 text-xs text-gray-400">Olá, {clientDisplayName}</p>}
                <NpsForm token={token} companyName={organizationName} />
              </>
            )}
          </div>
          <p className="text-center text-xs text-white/40">{organizationName} © {new Date().getFullYear()}</p>
        </div>
      </main>
    </div>
  )
}
