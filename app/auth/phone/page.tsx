'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { googleAuth } from '@/lib/api'

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(
    new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')
  )
  return match ? decodeURIComponent(match[1]) : null
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`
}

export default function PhonePage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const [suggestedName, setSuggestedName] = useState<string | undefined>()

  useEffect(() => {
    const token = getCookie('snivra_pending_token')
    if (!token) {
      router.replace('/login')
      return
    }
    const name = getCookie('snivra_suggested_name')
    setPendingToken(token)
    if (name) setSuggestedName(name)
    setReady(true)
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPhoneError(null)

    const normalized = phone.replace(/\D/g, '')
    if (!/^\d{10}$/.test(normalized)) {
      setPhoneError('Enter a valid 10-digit Indian mobile number.')
      return
    }

    if (!pendingToken) {
      router.replace('/login')
      return
    }

    setSubmitting(true)
    try {
      const result = await googleAuth(pendingToken, normalized, suggestedName)

      if (result.access_token) {
        // Store SNIVRA token in cookie (30 days)
        document.cookie = `snivra_token=${result.access_token}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`
        deleteCookie('snivra_pending_token')
        deleteCookie('snivra_suggested_name')
        router.replace('/dashboard')
      } else {
        setPhoneError('Could not complete signup. Please try again.')
      }
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f4f6fb]">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f4f6fb] px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[#e3eaf5] p-6">
        <div className="flex flex-col items-center mb-5">
          <div className="w-14 h-14 rounded-2xl overflow-hidden shadow mb-3">
            <Image
              src="/snivra.png"
              alt="SNIVRA"
              width={56}
              height={56}
              className="object-cover w-full h-full"
            />
          </div>
          <h1 className="text-base font-bold text-[#1a1a2e]">One more step</h1>
          <p className="text-xs text-[#5a6a85] text-center mt-1">
            We need your mobile number to complete your SNIVRA account.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <label className="block text-xs font-medium text-[#1a1a2e] mb-1.5">
            Mobile Number
          </label>
          <div className="flex items-center border border-[#e3eaf5] rounded-xl overflow-hidden focus-within:border-[#1565c0] focus-within:ring-2 focus-within:ring-[#e8f0fe] transition-all">
            <span className="px-3 py-3 text-sm text-[#5a6a85] bg-[#f4f6fb] border-r border-[#e3eaf5] select-none">
              +91
            </span>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={10}
              placeholder="9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              className="flex-1 px-3 py-3 text-sm text-[#1a1a2e] outline-none bg-white placeholder:text-[#b0bec5]"
              autoFocus
            />
          </div>

          {phoneError && (
            <p className="mt-2 text-xs text-red-500">{phoneError}</p>
          )}

          <button
            type="submit"
            disabled={submitting || phone.length !== 10}
            className="mt-4 w-full bg-[#1565c0] hover:bg-[#0d47a1] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl py-3 transition-colors flex items-center justify-center gap-2"
          >
            {submitting && <Spinner size={16} color="white" />}
            {submitting ? 'Completing signup…' : 'Continue'}
          </button>
        </form>

        <p className="text-xs text-[#5a6a85] text-center mt-4">
          Your number is used only for booking notifications.
        </p>
      </div>
    </div>
  )
}

function Spinner({ size = 36, color = '#1565c0' }: { size?: number; color?: string }) {
  return (
    <svg
      className="animate-spin"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
    >
      <path
        d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
        strokeLinecap="round"
      />
    </svg>
  )
}
