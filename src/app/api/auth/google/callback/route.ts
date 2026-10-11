import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exchangeCodeForTokens, getGoogleUserEmail } from '@/lib/email/gmail'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const userId = searchParams.get('state')
  const oauthError = searchParams.get('error')

  // Página onde o componente EmailConnectionSettings vive — todos os
  // redirects de sucesso/erro levam para cá, não para /settings.
  const accountPage = `${origin}/minha-conta`

  if (oauthError) {
    return NextResponse.redirect(`${accountPage}?email_error=${encodeURIComponent(oauthError)}`)
  }
  if (!code || !userId) {
    return NextResponse.redirect(`${accountPage}?email_error=parametros_ausentes`)
  }

  try {
    const redirectUri = new URL('/api/auth/google/callback', request.url).toString()
    const tokens = await exchangeCodeForTokens(code, redirectUri)

    // O Google só envia refresh_token quando prompt=consent + access_type=offline.
    // Se chegar sem ele, o utilizador provavelmente já tinha autorizado antes —
    // o fluxo /connect usa prompt=consent para forçar a reemissão, mas caso
    // algo falhe registamos um erro claro em vez de gravar uma conta inútil.
    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        `${accountPage}?email_error=${encodeURIComponent(
          'O Google não enviou o refresh_token. Revogue o acesso em myaccount.google.com/permissions e tente novamente.'
        )}`
      )
    }

    const email = await getGoogleUserEmail(tokens.access_token)
    const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const supabase = createAdminClient()
    const { error: upsertError } = await supabase.from('email_accounts').upsert(
      {
        user_id:         userId,
        email,
        connection_type: 'oauth_google',
        access_token:    tokens.access_token,
        refresh_token:   tokens.refresh_token,
        token_expiry:    expiry,
        connected_at:    new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

    if (upsertError) {
      console.error('[google/callback] falha ao gravar email_accounts:', upsertError.message)
      return NextResponse.redirect(
        `${accountPage}?email_error=${encodeURIComponent(`Erro ao salvar: ${upsertError.message}`)}`
      )
    }

    return NextResponse.redirect(`${accountPage}?email_connected=1`)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Falha desconhecida.'
    console.error('[google/callback] erro inesperado:', message)
    return NextResponse.redirect(`${accountPage}?email_error=${encodeURIComponent(message)}`)
  }
}
