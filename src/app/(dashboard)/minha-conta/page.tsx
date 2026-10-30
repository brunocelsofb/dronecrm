import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EmailConnectionSettings } from '@/components/settings/email-connection-settings'
import { EmailSignatureForm } from '@/components/email/email-signature-form'
import { getConnectedEmailAccount, getEmailSignature } from '@/lib/actions/email'
import { JobTitleForm } from '@/components/settings/job-title-form'
import { ChangePasswordForm } from '@/components/account/change-password-form'

export default async function MyAccountPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const forced = user.app_metadata?.must_change_password === true

  const { data: profile } = await supabase.from('profiles').select('full_name, email, job_title').eq('id', user.id).maybeSingle()
  const connectedAccount = await getConnectedEmailAccount()
  const signature = await getEmailSignature()

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Minha Conta</h1>
        <p className="mt-0.5 text-sm text-gray-500">{profile?.full_name} · {profile?.email}</p>
      </div>

      {forced && <ChangePasswordForm forced />}

      <JobTitleForm currentJobTitle={(profile as any)?.job_title ?? null} userId={user.id} />

      <Suspense fallback={null}>
        <EmailConnectionSettings
          connectedEmail={connectedAccount?.email ?? null}
          connectedAt={connectedAccount?.connectedAt ?? null}
          connectionType={connectedAccount?.connectionType ?? null}
        />
      </Suspense>

      <EmailSignatureForm currentSignature={signature} />

      {!forced && <ChangePasswordForm forced={false} />}
    </div>
  )
}
