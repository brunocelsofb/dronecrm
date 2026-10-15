import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { WhatsAppCharts } from '@/components/whatsapp/whatsapp-charts'
import Link from 'next/link'

export default async function WhatsAppRelatoriosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [
    { count: totalEntradas },
    { count: totalLeadsWpp },
    { count: totalOptOut },
    { data: vinculadosData },
    { count: totalConvertidos },
  ] = await Promise.all([
    supabase.from('whatsapp_capture_prompts').select('phone', { count: 'exact', head: true }),
    supabase.from('whatsapp_capture_prompts').select('phone', { count: 'exact', head: true }).not('lead_id', 'is', null),
    supabase.from('whatsapp_opt_outs').select('phone', { count: 'exact', head: true }),
    supabase.from('contract_whatsapp_messages').select('phone').not('contract_id', 'is', null).is('lead_id', null),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'convertido'),
  ])

  const totalVinculados = new Set((vinculadosData ?? []).map((m: any) => m.phone)).size

  const historyData: { day: string; entradas: number; leads: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dayStr = d.toISOString().slice(0, 10)
    const [{ count: entradas }, { count: leads }] = await Promise.all([
      supabase.from('contract_whatsapp_messages').select('phone', { count: 'exact', head: true }).eq('direction', 'recebido').gte('created_at', `${dayStr}T00:00:00`).lte('created_at', `${dayStr}T23:59:59`).is('contract_id', null),
      supabase.from('whatsapp_capture_prompts').select('phone', { count: 'exact', head: true }).gte('sent_at', `${dayStr}T00:00:00`).lte('sent_at', `${dayStr}T23:59:59`),
    ])
    historyData.push({ day: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), entradas: entradas ?? 0, leads: leads ?? 0 })
  }

  const funnelData = [
    { label: 'Entradas', value: totalEntradas ?? 0, color: '#1b556b' },
    { label: 'Leads gerados', value: totalLeadsWpp ?? 0, color: '#6366f1' },
    { label: 'Vinculados a conta', value: totalVinculados ?? 0, color: '#7c3aed' },
    { label: 'Convertidos', value: totalConvertidos ?? 0, color: '#1f8c7d' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Relatórios WhatsApp</h1>
          <p className="mt-0.5 text-sm text-gray-500">Métricas de captação, conversão e engajamento dos últimos 14 dias.</p>
        </div>
        <Link href="/whatsapp"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          💬 Ir para o Atendimento
        </Link>
      </div>

      <WhatsAppCharts
        totalEntradas={totalEntradas ?? 0}
        totalLeads={totalLeadsWpp ?? 0}
        totalConvertidos={totalConvertidos ?? 0}
        totalVinculados={totalVinculados ?? 0}
        totalOptOut={totalOptOut ?? 0}
        funnelData={funnelData}
        historyData={historyData}
      />
    </div>
  )
}
