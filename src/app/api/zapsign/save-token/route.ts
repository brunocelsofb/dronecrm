import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantId } from '@/lib/tenant/context'

export async function POST(request: Request) {
  const supabase = await createClient()
  const formData = await request.formData()
  const token = (formData.get('zapsign_api_token') as string)?.trim()

  if (token) {
    await supabase.from('organization_settings').update({ zapsign_api_token: token }).eq('tenant_id', await resolveTenantId())
  }

  return NextResponse.redirect(new URL('/settings', request.url))
}
