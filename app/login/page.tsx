'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { getSnivraToken } from '@/lib/api'

function LoginForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Already signed in → go to dashboard
    if (getSnivraToken()) {
      router.replace('/dashboard')
      return
    }
    const err = searchParams.get('error')
    if (err) setError(decodeURIComponent(err))
  }, [searchParams, router])

  async function handleGoogleSignIn() {
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback`,
        },
      })

      if (error) {
        setError(error.message)
        setLoading(false)
      }
      // On success Supabase redirects away — loading stays true intentionally
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[#e3eaf5] p-6">
      {/* Logo */}
      <div className="flex flex-col items-center mb-6">
        <div className="w-16 h-16 rounded-2xl overflow-hidden shadow mb-3">
          <Image
            src="/snivra.jpeg"
            alt="SNIVRA"
            width={64}
            height={64}
            className="object-cover w-full h-full"
            priority
          />
        </div>
        <h1 className="text-lg font-bold text-[#1a1a2e]">Welcome to SNIVRA</h1>
        <p className="text-xs text-[#5a6a85] mt-1 text-center">
          Sign in to book your next salon appointment
        </p>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-px bg-[#e3eaf5]" />
        <span className="text-xs text-[#5a6a85]">Continue with</span>
        <div className="flex-1 h-px bg-[#e3eaf5]" />
      </div>

      {/* Google Button */}
      <button
        onClick={handleGoogleSignIn}
        disabled={loading}
        className="w-full flex items-center justify-center gap-3 bg-white border border-[#e3eaf5] rounded-xl py-3 px-4 text-sm font-medium text-[#1a1a2e] shadow-sm hover:bg-[#f4f6fb] active:bg-[#e8f0fe] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? <LoadingSpinner /> : <GoogleIcon />}
        {loading ? 'Redirecting…' : 'Continue with Google'}
      </button>

      {/* Error */}
      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-red-600">
          {error}
        </div>
      )}

      {/* Terms */}
      <p className="text-xs text-[#5a6a85] text-center mt-5 leading-relaxed">
        By signing in, you agree to our{' '}
        <span className="text-[#1565c0] font-medium">Terms of Service</span>{' '}
        and{' '}
        <span className="text-[#1565c0] font-medium">Privacy Policy</span>.
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#f4f6fb]">
      {/* Header */}
      <header className="flex items-center px-4 py-3 bg-white border-b border-[#e3eaf5]">
        <Link href="/" className="flex items-center gap-1.5 text-[#5a6a85] hover:text-[#1565c0] transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="text-sm font-medium">Back</span>
        </Link>
      </header>

      {/* Card */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <Suspense fallback={
          <div className="w-full max-w-sm bg-white rounded-2xl border border-[#e3eaf5] p-6 flex justify-center">
            <LoadingSpinner />
          </div>
        }>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#1565c0"
      strokeWidth="2.5"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round"/>
    </svg>
  )
}
