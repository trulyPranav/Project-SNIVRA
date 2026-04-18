'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// This page is no longer part of the auth flow.
// The OAuth callback is handled server-side at /api/auth/callback (route handler).
// This component just redirects to login as a safety fallback.
export default function AuthCallbackFallback() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/login')
  }, [router])
  return null
}
