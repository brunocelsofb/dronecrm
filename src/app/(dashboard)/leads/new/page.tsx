import Link from 'next/link'
import { LeadCaptureForm } from '@/components/leads/lead-capture-form'

export default function NewLeadPage() {
  return (
    <div className="max-w-md space-y-4">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-700">
        ← Voltar
      </Link>
      <h1 className="text-[17px] font-medium text-foreground">Novo lead (prospecção)</h1>
      <p className="text-xs text-gray-500">Lead que o comercial encontrou (outbound). Já entra com você como responsável. Leads de formulário, site e anúncios chegam pelo Marketing.</p>
      <LeadCaptureForm internal redirectBase="/leads/" />
    </div>
  )
}
