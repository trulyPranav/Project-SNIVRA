import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { googleAuth } from '@/lib/api'

const TOKEN_COOKIE_OPTS = {
  path: '/',
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  httpOnly: false, // must be readable by client JS
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const errorDesc = searchParams.get('error_description')

  // Supabase sends ?error=... when the OAuth flow fails on their side
  if (error) {
    const msg = errorDesc
      ? decodeURIComponent(errorDesc.replace(/\+/g, ' '))
      : 'Google sign-in was cancelled or failed.'
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(msg)}`
    )
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('No authorization code received.')}`
    )
  }

  // Exchange code for session server-side — this reads the PKCE verifier from cookies
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError || !data.session) {
    const msg = exchangeError?.message ?? 'Session exchange failed.'
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(msg)}`
    )
  }

  // Exchange Supabase token for a SNIVRA JWT
  try {
    const result = await googleAuth(data.session.access_token)

    if (result.requires_phone) {
      // New user — need phone before issuing SNIVRA JWT
      const response = NextResponse.redirect(`${origin}/auth/phone`)
      response.cookies.set('snivra_pending_token', data.session.access_token, {
        ...TOKEN_COOKIE_OPTS,
        maxAge: 60 * 10, // 10 minutes
      })
      if (result.suggested_name) {
        response.cookies.set('snivra_suggested_name', result.suggested_name, {
          ...TOKEN_COOKIE_OPTS,
          maxAge: 60 * 10,
        })
      }
      return response
    }

    if (result.access_token) {
      const response = NextResponse.redirect(`${origin}/dashboard`)
      response.cookies.set('snivra_token', result.access_token, {
        ...TOKEN_COOKIE_OPTS,
        maxAge: 60 * 60 * 24 * 30, // 30 days
      })
      return response
    }

    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('Authentication failed. Please try again.')}`
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Authentication failed.'
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(msg)}`
    )
  }
}
