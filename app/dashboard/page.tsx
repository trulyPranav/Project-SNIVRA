'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import {
  getSnivraToken,
  clearSnivraToken,
  getNearbySaloons,
  getMe,
  getMyBookings,
  cancelBooking,
  submitRating,
} from '@/lib/api'
import type { SnivraUser, NearbySaloon, MyBooking, PendingReviewBooking } from '@/lib/api'
import { registerPushNotifications, shouldShowNotificationPrompt, dismissNotificationPrompt } from '@/lib/webpush'
import { createClient } from '@/lib/supabase'

// ─── Types ──────────────────────────────────────────────────────────────────────

interface SavedLocation {
  lat: number
  lng: number
  name: string
}

interface NominatimResult {
  place_id: number
  lat: string
  lon: string
  display_name: string
}

type Screen = 'loading' | 'location_setup' | 'main'
type LocationMode = 'choose' | 'gps_loading' | 'gps_error' | 'manual'

const RADIUS_OPTIONS = [5, 10, 20, 50]
const LOCATION_KEY = 'snivra_location'
const RADIUS_KEY = 'snivra_radius'

// ─── Storage helpers ─────────────────────────────────────────────────────────

function getSavedLocation(): SavedLocation | null {
  try {
    const raw = localStorage.getItem(LOCATION_KEY)
    return raw ? (JSON.parse(raw) as SavedLocation) : null
  } catch {
    return null
  }
}

function saveLocation(loc: SavedLocation) {
  localStorage.setItem(LOCATION_KEY, JSON.stringify(loc))
}

function getSavedRadius(): number {
  const raw = localStorage.getItem(RADIUS_KEY)
  const n = raw ? parseInt(raw, 10) : NaN
  return RADIUS_OPTIONS.includes(n) ? n : 5
}

function saveRadius(r: number) {
  localStorage.setItem(RADIUS_KEY, String(r))
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'en' } }
    )
    const data = await res.json()
    const a = data.address ?? {}
    const parts = [
      a.suburb ?? a.neighbourhood ?? a.quarter,
      a.city ?? a.town ?? a.village,
    ].filter(Boolean) as string[]
    return (
      parts.slice(0, 2).join(', ') ||
      data.display_name?.split(',')[0] ||
      'Your location'
    )
  } catch {
    return 'Your location'
  }
}

async function searchNominatim(q: string): Promise<NominatimResult[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=0`,
    { headers: { 'Accept-Language': 'en' } }
  )
  return res.json()
}

// ─── Dashboard Page ──────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()

  // Global screen state
  const [screen, setScreen] = useState<Screen>('loading')
  const [user, setUser] = useState<SnivraUser | null>(null)
  const [location, setLocation] = useState<SavedLocation | null>(null)
  const [radius, setRadius] = useState(5)

  // Saloon data
  const [saloons, setSaloons] = useState<NearbySaloon[] | null>(null)
  const [saloonsLoading, setSaloonsLoading] = useState(false)
  const [saloonsError, setSaloonsError] = useState<string | null>(null)

  // Location setup (initial screen)
  const [setupMode, setSetupMode] = useState<LocationMode>('choose')
  const [setupGpsError, setSetupGpsError] = useState<string | null>(null)
  const [setupQuery, setSetupQuery] = useState('')
  const [setupResults, setSetupResults] = useState<NominatimResult[]>([])
  const [setupSearching, setSetupSearching] = useState(false)
  const setupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Notification prompt
  const [notifPromptVisible, setNotifPromptVisible] = useState(false)

  // Rating prompt (shown once per session)
  const [ratingPromptOpen, setRatingPromptOpen] = useState(false)
  const [pendingReviewBooking, setPendingReviewBooking] = useState<PendingReviewBooking | null>(null)
  const [ratingSubmitting, setRatingSubmitting] = useState(false)
  const [ratingError, setRatingError] = useState<string | null>(null)
  const ratingPromptShownRef = useRef(false)

  // Bookings panel
  const [bookingsPanelOpen, setBookingsPanelOpen] = useState(false)
  const [myBookings, setMyBookings] = useState<MyBooking[] | null>(null)
  const [bookingsLoading, setBookingsLoading] = useState(false)
  const [bookingsError, setBookingsError] = useState<string | null>(null)
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  // Profile popover
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

  // Dark mode
  const [isDark, setIsDark] = useState(false)
  const themeButtonRef = useRef<HTMLButtonElement>(null)

  // Change location modal
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<LocationMode>('choose')
  const [modalGpsError, setModalGpsError] = useState<string | null>(null)
  const [modalQuery, setModalQuery] = useState('')
  const [modalResults, setModalResults] = useState<NominatimResult[]>([])
  const [modalSearching, setModalSearching] = useState(false)
  const modalTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const token = getSnivraToken()
    if (!token) {
      router.replace('/login')
      return
    }

    getMe(token)
      .then((u) => {
        setUser(u)
        // Show notification prompt if the user hasn't subscribed or dismissed before
        if (shouldShowNotificationPrompt()) {
          setNotifPromptVisible(true)
        }
        // Show rating prompt once per session if there's a pending review
        if (!ratingPromptShownRef.current && u.isReview && u.pending_review_booking) {
          ratingPromptShownRef.current = true
          setPendingReviewBooking(u.pending_review_booking)
          setRatingPromptOpen(true)
        }
      })
      .catch((err: Error) => {
        if (err.message === 'UNAUTHORIZED') {
          clearSnivraToken()
          router.replace('/login')
        }
        // Network / server errors: proceed without user profile
      })

    const saved = getSavedLocation()
    setRadius(getSavedRadius())

    if (saved) {
      setLocation(saved)
      setScreen('main')
    } else {
      setScreen('location_setup')
    }
  }, [router])

  // ── Fetch saloons ────────────────────────────────────────────────────────────
  const fetchSaloons = useCallback(async (loc: SavedLocation, r: number) => {
    setSaloonsLoading(true)
    setSaloonsError(null)
    try {
      const data = await getNearbySaloons(loc.lat, loc.lng, r)
      setSaloons(data)
    } catch (e) {
      setSaloonsError(
        e instanceof Error ? e.message : 'Failed to load salons'
      )
      setSaloons(null)
    } finally {
      setSaloonsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (screen === 'main' && location) {
      fetchSaloons(location, radius)
    }
  }, [screen, location, radius, fetchSaloons])

  // ── Setup search debounce ────────────────────────────────────────────────────
  useEffect(() => {
    if (setupTimer.current) clearTimeout(setupTimer.current)
    if (!setupQuery.trim()) {
      setSetupResults([])
      setSetupSearching(false)
      return
    }
    setSetupSearching(true)
    setupTimer.current = setTimeout(async () => {
      try {
        setSetupResults(await searchNominatim(setupQuery))
      } catch {
        setSetupResults([])
      } finally {
        setSetupSearching(false)
      }
    }, 350)
    return () => {
      if (setupTimer.current) clearTimeout(setupTimer.current)
    }
  }, [setupQuery])

  // ── Modal search debounce ─────────────────────────────────────────────────────
  useEffect(() => {
    if (modalTimer.current) clearTimeout(modalTimer.current)
    if (!modalQuery.trim()) {
      setModalResults([])
      setModalSearching(false)
      return
    }
    setModalSearching(true)
    modalTimer.current = setTimeout(async () => {
      try {
        setModalResults(await searchNominatim(modalQuery))
      } catch {
        setModalResults([])
      } finally {
        setModalSearching(false)
      }
    }, 350)
    return () => {
      if (modalTimer.current) clearTimeout(modalTimer.current)
    }
  }, [modalQuery])

  // ── GPS helper ───────────────────────────────────────────────────────────────
  function requestGps(isModal: boolean) {
    if (isModal) setModalMode('gps_loading')
    else setSetupMode('gps_loading')

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        const name = await reverseGeocode(lat, lng)
        const loc: SavedLocation = { lat, lng, name }
        saveLocation(loc)
        setLocation(loc)
        if (isModal) {
          setModalOpen(false)
          setModalMode('choose')
          setModalQuery('')
          setModalResults([])
        } else {
          setScreen('main')
        }
      },
      (err) => {
        const msg =
          err.code === 1
            ? 'Location access was denied. Allow it in your browser settings, or search manually.'
            : 'Could not detect your location. Please try again or search manually.'
        if (isModal) {
          setModalGpsError(msg)
          setModalMode('gps_error')
        } else {
          setSetupGpsError(msg)
          setSetupMode('gps_error')
        }
      },
      { timeout: 12000, maximumAge: 60000 }
    )
  }

  function pickResult(result: NominatimResult, isModal: boolean) {
    const parts = result.display_name.split(',')
    const name = parts.slice(0, 2).join(',').trim()
    const loc: SavedLocation = {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      name,
    }
    saveLocation(loc)
    setLocation(loc)
    if (isModal) {
      setModalOpen(false)
      setModalMode('choose')
      setModalQuery('')
      setModalResults([])
    } else {
      setScreen('main')
    }
  }

  function handleRadiusChange(r: number) {
    setRadius(r)
    saveRadius(r)
  }

  function openModal() {
    setModalOpen(true)
    setModalMode('choose')
    setModalGpsError(null)
    setModalQuery('')
    setModalResults([])
  }

  // ── Profile popover close-on-outside-click ───────────────────────────────────
  useEffect(() => {
    if (!profileOpen) return
    function handleOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [profileOpen])

  async function handleSignOut() {
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch (e) {
      console.error('Supabase signout failed', e)
    }

    clearSnivraToken()

    // optional cleanup
    document.cookie =
      'snivra_pending_token=; path=/; max-age=0; samesite=lax'
    document.cookie =
      'snivra_suggested_name=; path=/; max-age=0; samesite=lax'

    router.replace('/login')
  }

  // ── Dark mode ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  function toggleTheme() {
    const next = !isDark

    // Set the origin CSS vars from the button's centre position
    const btn = themeButtonRef.current
    if (btn) {
      const r = btn.getBoundingClientRect()
      const x = Math.round(r.left + r.width / 2)
      const y = Math.round(r.top + r.height / 2)
      document.documentElement.style.setProperty('--theme-toggle-x', `${x}px`)
      document.documentElement.style.setProperty('--theme-toggle-y', `${y}px`)
    }

    const applyTheme = () => {
      flushSync(() => setIsDark(next))
      document.documentElement.classList.toggle('dark', next)
      localStorage.setItem('snivra_theme', next ? 'dark' : 'light')
    }

    // Use View Transitions API when available, plain fallback otherwise
    if (typeof (document as any).startViewTransition === 'function') {
      ;(document as any).startViewTransition(applyTheme)
    } else {
      applyTheme()
    }
  }

  // ── Notification prompt ───────────────────────────────────────────────────────
  function handleDismissNotifPrompt() {
    dismissNotificationPrompt()
    setNotifPromptVisible(false)
  }

  async function handleEnableNotifications() {
    setNotifPromptVisible(false)
    const token = getSnivraToken()
    if (!token) return
    await registerPushNotifications(token)
  }

  // ── Rating prompt ──────────────────────────────────────────────

  async function handleSubmitRating(rating: 0 | 1) {
    if (!pendingReviewBooking) return
    const token = getSnivraToken()
    if (!token) return
    setRatingSubmitting(true)
    setRatingError(null)
    try {
      await submitRating(pendingReviewBooking.id, rating, token)
      setRatingPromptOpen(false)
      setPendingReviewBooking(null)
    } catch (e) {
      if (e instanceof Error && e.message === 'UNAUTHORIZED') {
        clearSnivraToken()
        router.replace('/login')
        return
      }
      setRatingError(e instanceof Error ? e.message : 'Failed to submit rating')
    } finally {
      setRatingSubmitting(false)
    }
  }

  function handleDismissRating() {
    // Dismiss without rating — do NOT call the API; isReview stays true server-side
    // but we only show the prompt once per session (ratingPromptShownRef guards it)
    setRatingPromptOpen(false)
  }

  // ── Bookings panel ────────────────────────────────────────────────────────────
  function openBookingsPanel() {
    setBookingsPanelOpen(true)
    setBookingsError(null)
    setCancelConfirmId(null)
    setCancelError(null)
    const t = getSnivraToken()
    if (!t) return
    setBookingsLoading(true)
    getMyBookings(t)
      .then(setMyBookings)
      .catch((e: Error) => {
        if (e.message === 'UNAUTHORIZED') { clearSnivraToken(); router.replace('/login'); return }
        setBookingsError(e.message)
      })
      .finally(() => setBookingsLoading(false))
  }

  async function handleCancelBooking(bookingId: string) {
    const t = getSnivraToken()
    if (!t) return
    setCancellingId(bookingId)
    setCancelError(null)
    try {
      await cancelBooking(bookingId, t)
      setMyBookings((prev) =>
        prev
          ? prev.map((b) => b.id === bookingId ? { ...b, status: 'CANCELLED' as const } : b)
          : prev
      )
      setCancelConfirmId(null)
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'Failed to cancel booking')
    } finally {
      setCancellingId(null)
    }
  }

  // ── Renders ──────────────────────────────────────────────────────────────────

  if (screen === 'loading') return <FullscreenLoader />

  if (screen === 'location_setup') {
    return (
      <LocationSetupScreen
        mode={setupMode}
        gpsError={setupGpsError}
        query={setupQuery}
        results={setupResults}
        searching={setupSearching}
        onQuery={setSetupQuery}
        onGps={() => requestGps(false)}
        onManual={() => setSetupMode('manual')}
        onPick={(r) => pickResult(r, false)}
        onRetryGps={() => {
          setSetupMode('choose')
          setSetupGpsError(null)
        }}
      />
    )
  }

  // ── Main dashboard ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f4f6fb] flex flex-col">

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-white border-b border-[#e3eaf5] px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg overflow-hidden shrink-0">
            <Image
              src="/snivra.png"
              alt="SNIVRA"
              width={28}
              height={28}
              className="object-cover w-full h-full"
            />
          </div>
          <span className="text-[#1565c0] font-bold text-base tracking-wide">
            SNIVRA
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={openBookingsPanel}
            title="My Bookings"
            className="p-1.5 text-[#5a6a85] hover:text-[#1565c0] transition-colors relative"
          >
            <BookingsIcon />
            {myBookings && myBookings.some((b) => b.status === 'BOOKED') && (
              <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-[#1565c0] border-2 border-white" />
            )}
          </button>
          <button
            ref={themeButtonRef}
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-1.5 text-[#5a6a85] hover:text-[#1565c0] transition-colors"
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>
          {user && (
            <div ref={profileRef} className="relative">
              <button
                onClick={() => setProfileOpen((o) => !o)}
                title={user.name}
                className="w-8 h-8 rounded-full bg-[#e8f0fe] border border-[#c5d8fb] flex items-center justify-center hover:border-[#1565c0] transition-colors"
              >
                <span className="text-[#1565c0] text-xs font-bold">
                  {getInitials(user.name)}
                </span>
              </button>
              {profileOpen && (
                <ProfilePopover
                  user={user}
                  onSignOut={handleSignOut}
                  onClose={() => setProfileOpen(false)}
                />
              )}
            </div>
          )}
        </div>
      </header>

      {/* ── Notification prompt banner ── */}
      {notifPromptVisible && (
        <div className="bg-[#e8f0fe] border-b border-[#c5d8fb] px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#1565c0] flex items-center justify-center shrink-0">
            <BellIcon />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#1a1a2e] leading-snug">
              Stay updated on your bookings
            </p>
            <p className="text-[11px] text-[#5a6a85] mt-0.5">
              Get notified when your booking status changes.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDismissNotifPrompt}
              className="text-xs text-[#5a6a85] hover:text-[#1a1a2e] transition-colors font-medium"
            >
              Not now
            </button>
            <button
              onClick={handleEnableNotifications}
              className="text-xs font-semibold bg-[#1565c0] text-white px-3 py-1.5 rounded-full hover:bg-[#0d47a1] transition-colors"
            >
              Enable
            </button>
          </div>
        </div>
      )}

      {/* ── Location + radius bar ── */}
      <div className="bg-white border-b border-[#e3eaf5] px-4 pt-3 pb-2.5">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <PinFillIcon />
            <span className="text-sm font-medium text-[#1a1a2e] truncate max-w-52.5">
              {location?.name ?? '—'}
            </span>
          </div>
          <button
            onClick={openModal}
            className="shrink-0 ml-2 text-xs font-semibold text-[#1565c0] hover:underline"
          >
            Change
          </button>
        </div>
        <div
          className="flex gap-2 overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          {RADIUS_OPTIONS.map((r) => (
            <button
              key={r}
              onClick={() => handleRadiusChange(r)}
              className={`shrink-0 text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${
                radius === r
                  ? 'bg-[#1565c0] text-white border-[#1565c0]'
                  : 'bg-white text-[#5a6a85] border-[#e3eaf5] hover:border-[#1565c0] hover:text-[#1565c0]'
              }`}
            >
              {r} km
            </button>
          ))}
        </div>
      </div>

      {/* ── Saloon list ── */}
      <main className="flex-1 px-4 py-4 w-full max-w-xl mx-auto">
        <h2 className="text-sm font-semibold text-[#1a1a2e] mb-3">
          Nearby Salons
        </h2>

        {saloonsLoading && (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <SaloonSkeleton key={i} />
            ))}
          </div>
        )}

        {!saloonsLoading && saloonsError && (
          <div className="bg-white rounded-xl border border-[#fce4e4] p-4 text-center">
            <p className="text-sm text-[#c62828] mb-3">{saloonsError}</p>
            <button
              onClick={() => location && fetchSaloons(location, radius)}
              className="text-xs font-semibold text-[#1565c0] underline"
            >
              Try again
            </button>
          </div>
        )}

        {!saloonsLoading && !saloonsError && saloons !== null && saloons.length === 0 && (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-[#e8f0fe] flex items-center justify-center mb-3">
              <ScissorsIcon size={22} color="#1565c0" />
            </div>
            <p className="text-sm font-semibold text-[#1a1a2e] mb-1">
              No salons found nearby
            </p>
            <p className="text-xs text-[#5a6a85] mb-5">
              No salons within {radius} km of your location.
            </p>
            {radius < 50 && (
              <button
                onClick={() => {
                  const idx = RADIUS_OPTIONS.indexOf(radius)
                  const next = RADIUS_OPTIONS[idx + 1]
                  if (next) handleRadiusChange(next)
                }}
                className="text-xs font-semibold text-[#1565c0] bg-[#e8f0fe] px-5 py-2 rounded-full"
              >
                Expand to {RADIUS_OPTIONS[RADIUS_OPTIONS.indexOf(radius) + 1]} km
              </button>
            )}
          </div>
        )}

        {!saloonsLoading && !saloonsError && saloons && saloons.length > 0 && (
          <div className="flex flex-col gap-3">
            {saloons.map((s) => (
              <SaloonCard key={s.id} saloon={s} />
            ))}
          </div>
        )}
      </main>

      {/* ── Bookings panel ── */}
      <BookingsPanel
        open={bookingsPanelOpen}
        bookings={myBookings}
        loading={bookingsLoading}
        error={bookingsError}
        cancelConfirmId={cancelConfirmId}
        cancellingId={cancellingId}
        cancelError={cancelError}
        onClose={() => setBookingsPanelOpen(false)}
        onCancelRequest={(id) => { setCancelConfirmId(id); setCancelError(null) }}
        onCancelDismiss={() => { setCancelConfirmId(null); setCancelError(null) }}
        onCancelConfirm={handleCancelBooking}
      />

      {/* ── Change location modal ── */}
      {modalOpen && (
        <LocationModal
          mode={modalMode}
          gpsError={modalGpsError}
          query={modalQuery}
          results={modalResults}
          searching={modalSearching}
          onQuery={setModalQuery}
          onGps={() => requestGps(true)}
          onManual={() => setModalMode('manual')}
          onPick={(r) => pickResult(r, true)}
          onRetryGps={() => {
            setModalMode('choose')
            setModalGpsError(null)
          }}
          onClose={() => setModalOpen(false)}
        />
      )}

      {/* ── Rating prompt ── */}
      {ratingPromptOpen && pendingReviewBooking && (
        <RatingPrompt
          barberName={pendingReviewBooking.barber_name}
          saloonName={pendingReviewBooking.saloon_name}
          submitting={ratingSubmitting}
          error={ratingError}
          onRate={handleSubmitRating}
          onDismiss={handleDismissRating}
        />
      )}
    </div>
  )
}

// ─── Location Setup Screen ────────────────────────────────────────────────────

interface LocationContentProps {
  mode: LocationMode
  gpsError: string | null
  query: string
  results: NominatimResult[]
  searching: boolean
  onQuery: (q: string) => void
  onGps: () => void
  onManual: () => void
  onPick: (r: NominatimResult) => void
  onRetryGps: () => void
}

function LocationSetupScreen(props: LocationContentProps) {
  return (
    <div className="min-h-screen bg-[#f4f6fb] flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-md mb-4">
            <Image
              src="/snivra.png"
              alt="SNIVRA"
              width={64}
              height={64}
              className="object-cover w-full h-full"
            />
          </div>
          <h1 className="text-xl font-bold text-[#1a1a2e]">
            Find salons near you
          </h1>
          <p className="text-xs text-[#5a6a85] text-center mt-1 max-w-60">
            Share your location or search for your area to discover nearby
            salons.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-[#e3eaf5] shadow-sm overflow-hidden">
          <LocationContent {...props} />
        </div>
      </div>
    </div>
  )
}

// ─── Change Location Modal (bottom sheet) ────────────────────────────────────

interface LocationModalProps extends LocationContentProps {
  onClose: () => void
}

function LocationModal({ onClose, ...contentProps }: LocationModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <button
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Close"
      />
      {/* Sheet */}
      <div className="relative bg-white rounded-t-2xl shadow-2xl w-full max-h-[85vh] flex flex-col">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-[#e3eaf5]" />
        </div>
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-[#e3eaf5] shrink-0">
          <span className="text-sm font-semibold text-[#1a1a2e]">
            Change Location
          </span>
          <button
            onClick={onClose}
            className="text-[#5a6a85] hover:text-[#1a1a2e] transition-colors"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          <LocationContent {...contentProps} />
        </div>
      </div>
    </div>
  )
}

// ─── Location Content (shared) ───────────────────────────────────────────────

function LocationContent({
  mode,
  gpsError,
  query,
  results,
  searching,
  onQuery,
  onGps,
  onManual,
  onPick,
  onRetryGps,
}: LocationContentProps) {
  if (mode === 'gps_loading') {
    return (
      <div className="flex flex-col items-center py-12 px-4">
        <Spinner size={36} color="#1565c0" />
        <p className="mt-3 text-sm text-[#5a6a85]">Getting your location…</p>
      </div>
    )
  }

  if (mode === 'gps_error') {
    return (
      <div className="flex flex-col items-center py-8 px-5 text-center">
        <div className="w-11 h-11 rounded-full bg-[#fce4e4] flex items-center justify-center mb-3">
          <AlertIcon />
        </div>
        <p className="text-sm font-semibold text-[#1a1a2e] mb-1">
          Location unavailable
        </p>
        <p className="text-xs text-[#5a6a85] mb-6 leading-relaxed">{gpsError}</p>
        <div className="flex flex-col gap-2 w-full">
          <button
            onClick={onRetryGps}
            className="w-full text-sm font-semibold border border-[#1565c0] text-[#1565c0] rounded-xl py-3 hover:bg-[#e8f0fe] transition-colors"
          >
            Try again
          </button>
          <button
            onClick={onManual}
            className="w-full text-sm font-semibold bg-[#1565c0] text-white rounded-xl py-3 hover:bg-[#0d47a1] transition-colors"
          >
            Search manually
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'manual') {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 border border-[#e3eaf5] rounded-xl px-3 py-2.5 bg-[#f4f6fb] focus-within:border-[#1565c0] focus-within:bg-white transition-all">
          <SearchIcon />
          <input
            autoFocus
            type="text"
            placeholder="Search city or area…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            className="flex-1 text-sm text-[#1a1a2e] bg-transparent outline-none placeholder:text-[#b0bec5]"
          />
          {searching && <Spinner size={15} color="#5a6a85" />}
        </div>

        {results.length > 0 && (
          <ul className="mt-1 flex flex-col">
            {results.map((r) => (
              <li key={r.place_id}>
                <button
                  onClick={() => onPick(r)}
                  className="w-full flex items-start gap-3 py-3 px-1 text-left hover:bg-[#f4f6fb] transition-colors rounded-lg"
                >
                  <PinIcon size={14} className="text-[#5a6a85] mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-[#1a1a2e] font-medium truncate leading-snug">
                      {r.display_name.split(',')[0]}
                    </p>
                    <p className="text-xs text-[#5a6a85] truncate">
                      {r.display_name.split(',').slice(1, 3).join(',').trim()}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!searching && query.trim() && results.length === 0 && (
          <p className="text-center text-xs text-[#5a6a85] py-5">
            No results found. Try a different search.
          </p>
        )}
      </div>
    )
  }

  // Default: choose
  return (
    <div className="flex flex-col gap-3 p-4">
      {/* GPS option */}
      <button
        onClick={onGps}
        className="w-full flex items-center gap-4 bg-[#1565c0] hover:bg-[#0d47a1] active:bg-[#0d47a1] transition-colors rounded-xl p-4 text-left"
      >
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <GpsIcon />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">
            Use my current location
          </p>
          <p className="text-xs text-blue-200 mt-0.5">Quick and accurate</p>
        </div>
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-[#e3eaf5]" />
        <span className="text-xs text-[#b0bec5]">or</span>
        <div className="flex-1 h-px bg-[#e3eaf5]" />
      </div>

      {/* Manual search option */}
      <button
        onClick={onManual}
        className="w-full flex items-center gap-4 border border-[#e3eaf5] hover:border-[#1565c0] hover:bg-[#f8faff] transition-colors rounded-xl p-4 text-left"
      >
        <div className="w-10 h-10 rounded-full bg-[#f4f6fb] flex items-center justify-center shrink-0">
          <SearchIcon />
        </div>
        <div>
          <p className="text-sm font-semibold text-[#1a1a2e]">
            Search your area
          </p>
          <p className="text-xs text-[#5a6a85] mt-0.5">
            Find by city or neighbourhood
          </p>
        </div>
      </button>
    </div>
  )
}

// ─── Salon Card ───────────────────────────────────────────────────────────────

function SaloonCard({ saloon }: { saloon: NearbySaloon }) {
  return (
    <Link
      href={`/dashboard/saloon/${saloon.id}?name=${encodeURIComponent(saloon.name)}`}
      className={`bg-white rounded-xl border px-4 py-3.5 flex items-center gap-3 transition-colors active:bg-[#f0f4ff] ${
        saloon.is_open
          ? 'border-[#e3eaf5] hover:border-[#1565c0] hover:bg-[#f8faff]'
          : 'border-[#e3eaf5] opacity-60'
      }`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
        saloon.is_open ? 'bg-[#e8f0fe]' : 'bg-[#f0f0f0]'
      }`}>
        <ScissorsIcon size={20} color={saloon.is_open ? '#1565c0' : '#9e9e9e'} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-[#1a1a2e] truncate">
            {saloon.name}
          </p>
          {!saloon.is_open && (
            <span className="shrink-0 text-[10px] font-semibold text-[#757575] bg-[#eeeeee] rounded-full px-2 py-0.5">
              Closed today
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <div className="flex items-center gap-1">
            <PinIcon size={12} className="text-[#5a6a85] shrink-0" />
            <span className="text-xs text-[#5a6a85]">
              {formatDistance(saloon.distance)} away
            </span>
          </div>
          <span className="text-[#e3eaf5]">·</span>
          <span className="text-xs text-[#5a6a85]">
            {saloon.satisfaction_rate === null
              ? 'No reviews yet'
              : `${saloon.satisfaction_rate}% satisfied`}
          </span>
        </div>
      </div>
      <ChevronRightIcon />
    </Link>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SaloonSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-[#e3eaf5] px-4 py-3.5 flex items-center gap-3 animate-pulse">
      <div className="w-10 h-10 rounded-xl bg-[#e8f0fe] shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-[#e3eaf5] rounded w-3/5" />
        <div className="h-2.5 bg-[#f4f6fb] rounded w-2/5" />
      </div>
      <div className="w-5 h-5 rounded bg-[#f4f6fb]" />
    </div>
  )
}

// ─── Fullscreen Loader ────────────────────────────────────────────────────────

function FullscreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f4f6fb]">
      <Spinner size={36} color="#1565c0" />
    </div>
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner({ size = 24, color = '#1565c0' }: { size?: number; color?: string }) {
  return (
    <svg
      className="animate-spin"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
    >
      <path
        d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function GpsIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  )
}

function PinIcon({
  size = 14,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function PinFillIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="#1565c0"
      stroke="#1565c0"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" fill="white" stroke="white" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#5a6a85"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function ScissorsIcon({ size = 20, color = '#1565c0' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#c62828"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#b0bec5"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

// ─── Profile Popover ──────────────────────────────────────────────────────────

function ProfilePopover({
  user,
  onSignOut,
  onClose,
}: {
  user: SnivraUser
  onSignOut: () => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [pointsInfoOpen, setPointsInfoOpen] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(user.referral_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // silent fail
    }
  }

  return (
    <div className="absolute right-0 top-10 z-30 w-64 bg-white rounded-2xl border border-[#e3eaf5] shadow-lg overflow-hidden">
      {/* Name + phone */}
      <div className="px-4 pt-4 pb-3 border-b border-[#f0f4fa]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#e8f0fe] border border-[#c5d8fb] flex items-center justify-center shrink-0">
            <span className="text-[#1565c0] text-sm font-bold">
              {user.name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#1a1a2e] truncate">{user.name}</p>
            <p className="text-[11px] text-[#5a6a85] truncate">+91 {user.phone}</p>
          </div>
        </div>
      </div>

      {/* Referral code */}
      <div className="px-4 py-3 border-b border-[#f0f4fa]">
        <div className="flex items-center gap-1.5 mb-1.5">
          <GiftIcon />
          <span className="text-[11px] text-[#5a6a85] font-medium">Referral code</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-[#1a1a2e] tracking-widest">{user.referral_code}</span>
          <button
            onClick={handleCopy}
            className="text-xs font-semibold text-[#1565c0] bg-[#e8f0fe] hover:bg-[#c5d8fb] px-3 py-1 rounded-full transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Referral points */}
      <div className="px-4 py-3 border-b border-[#f0f4fa]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#5a6a85] font-medium">Referral points</span>
            <button
              type="button"
              onClick={() => setPointsInfoOpen((o) => !o)}
              className="w-4 h-4 rounded-full border border-[#b0bec5] text-[#5a6a85] hover:border-[#1565c0] hover:text-[#1565c0] flex items-center justify-center transition-colors text-[10px] font-bold leading-none"
              aria-label="How are points earned?"
            >
              i
            </button>
          </div>
          <span className="text-sm font-bold text-[#1565c0]">{user.referral_points}</span>
        </div>
        {pointsInfoOpen && (
          <div className="mt-2 rounded-lg bg-[#f4f6fb] border border-[#e3eaf5] px-3 py-2 text-[11px] text-[#5a6a85] leading-relaxed">
            Earn <span className="font-semibold text-[#1a1a2e]">+5 points</span> each time someone signs up using your referral code. Points are credited once per referred user after they complete signup.
          </div>
        )}
      </div>

      {/* Sign out */}
      <button
        onClick={() => { onClose(); onSignOut() }}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm text-[#c62828] hover:bg-[#fff5f5] transition-colors font-medium"
      >
        <SignOutIcon />
        Sign out
      </button>
    </div>
  )
}

function SunIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function GiftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 12 20 22 4 22 4 12" />
      <rect x="2" y="7" width="20" height="5" />
      <line x1="12" y1="22" x2="12" y2="7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </svg>
  )
}

function BookingsIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="14" x2="16" y2="14" />
      <line x1="8" y1="18" x2="12" y2="18" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="white"
      stroke="white"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

// ─── Rating Prompt ────────────────────────────────────────────────────────────

interface RatingPromptProps {
  barberName: string
  saloonName: string
  submitting: boolean
  error: string | null
  onRate: (rating: 0 | 1) => void
  onDismiss: () => void
}

function RatingPrompt({ barberName, saloonName, submitting, error, onRate, onDismiss }: RatingPromptProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* Backdrop */}
      <button
        className="absolute inset-0 bg-black/40"
        onClick={onDismiss}
        aria-label="Dismiss"
        disabled={submitting}
      />
      {/* Sheet */}
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-sm px-5 pt-5 pb-8 flex flex-col items-center text-center">
        {/* Handle (mobile) */}
        <div className="w-10 h-1 rounded-full bg-[#e3eaf5] mb-4 sm:hidden" />

        <div className="w-14 h-14 rounded-full bg-[#e8f0fe] flex items-center justify-center mb-3">
          <ScissorsIcon size={26} color="#1565c0" />
        </div>

        <h2 className="text-base font-bold text-[#1a1a2e] mb-1">
          How was your experience?
        </h2>
        <div className="flex flex-col items-center gap-0.5 mb-5">
          <p className="text-xs text-[#5a6a85]">
            <span className="font-semibold text-[#1a1a2e]">{barberName}</span>
            {' '}at{' '}
            <span className="font-semibold text-[#1a1a2e]">{saloonName}</span>
          </p>
        </div>

        {error && (
          <p className="text-xs text-[#c62828] mb-4 bg-[#fce4e4] rounded-lg px-3 py-2 w-full">
            {error}
          </p>
        )}

        <div className="flex gap-3 w-full mb-4">
          <button
            onClick={() => onRate(0)}
            disabled={submitting}
            className="flex-1 flex flex-col items-center gap-1.5 rounded-xl border-2 border-[#e3eaf5] py-4 hover:border-[#c62828] hover:bg-[#fff5f5] transition-colors disabled:opacity-50"
          >
            <ThumbDownIcon />
            <span className="text-xs font-semibold text-[#5a6a85]">Not satisfied</span>
          </button>
          <button
            onClick={() => onRate(1)}
            disabled={submitting}
            className="flex-1 flex flex-col items-center gap-1.5 rounded-xl border-2 border-[#e3eaf5] py-4 hover:border-[#2e7d32] hover:bg-[#f1f8f1] transition-colors disabled:opacity-50"
          >
            <ThumbUpIcon />
            <span className="text-xs font-semibold text-[#5a6a85]">Satisfied</span>
          </button>
        </div>

        {submitting && (
          <div className="flex items-center gap-2 text-xs text-[#5a6a85]">
            <Spinner size={14} color="#5a6a85" />
            Submitting…
          </div>
        )}

        {!submitting && (
          <button
            onClick={onDismiss}
            className="text-xs text-[#5a6a85] hover:text-[#1a1a2e] transition-colors mt-1"
          >
            Maybe later
          </button>
        )}
      </div>
    </div>
  )
}

function ThumbUpIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  )
}

function ThumbDownIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
      <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
    </svg>
  )
}

// ─── Bookings Panel ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  MyBooking['status'],
  { label: string; cls: string }
> = {
  BOOKED:    { label: 'Booked',    cls: 'bg-[#e8f0fe] text-[#1565c0]' },
  ARRIVED:   { label: 'Arrived',   cls: 'bg-[#fff8e1] text-[#f57f17]' },
  COMPLETED: { label: 'Completed', cls: 'bg-[#e8f5e9] text-[#2e7d32]' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-[#f5f5f5] text-[#757575]' },
  NO_SHOW:   { label: 'No Show',   cls: 'bg-[#fce4e4] text-[#c62828]' },
}

function formatBookingDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function formatArrivalTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatSessionLabel(label: string): string {
  const labels: Record<string, string> = {
    MORNING: 'Morning',
    AFTERNOON: 'Afternoon',
    EVENING: 'Evening',
  }
  return labels[label] ?? label
}

interface BookingsPanelProps {
  open: boolean
  bookings: MyBooking[] | null
  loading: boolean
  error: string | null
  cancelConfirmId: string | null
  cancellingId: string | null
  cancelError: string | null
  onClose: () => void
  onCancelRequest: (id: string) => void
  onCancelDismiss: () => void
  onCancelConfirm: (id: string) => void
}

function BookingsPanel({
  open,
  bookings,
  loading,
  error,
  cancelConfirmId,
  cancellingId,
  cancelError,
  onClose,
  onCancelRequest,
  onCancelDismiss,
  onCancelConfirm,
}: BookingsPanelProps) {
  if (!open) return null

  const activeBookings = bookings?.filter((b) => b.status !== 'CANCELLED' && b.status !== 'COMPLETED' && b.status !== 'NO_SHOW') ?? []
  const pastBookings = bookings?.filter((b) => b.status === 'CANCELLED' || b.status === 'COMPLETED' || b.status === 'NO_SHOW') ?? []

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <button
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Close"
      />
      {/* Sheet */}
      <div className="relative bg-white rounded-t-2xl shadow-2xl w-full flex flex-col" style={{ maxHeight: '90dvh' }}>
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-[#e3eaf5]" />
        </div>
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-[#e3eaf5] shrink-0">
          <span className="text-base font-bold text-[#1a1a2e]">My Bookings</span>
          <button onClick={onClose} className="text-[#5a6a85] hover:text-[#1a1a2e] transition-colors">
            <CloseIcon />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-4 py-4">
          {loading && (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-[#f4f6fb] rounded-xl h-28 animate-pulse" />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center py-10 text-center">
              <p className="text-sm text-[#c62828] mb-3">{error}</p>
            </div>
          )}

          {!loading && !error && bookings !== null && bookings.length === 0 && (
            <div className="flex flex-col items-center py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-[#e8f0fe] flex items-center justify-center mb-3">
                <BookingsIcon />
              </div>
              <p className="text-sm font-semibold text-[#1a1a2e] mb-1">No bookings yet</p>
              <p className="text-xs text-[#5a6a85]">Your bookings will appear here.</p>
            </div>
          )}

          {!loading && !error && bookings !== null && bookings.length > 0 && (
            <>
              {activeBookings.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-[#5a6a85] uppercase tracking-wide mb-2">Upcoming</p>
                  <div className="flex flex-col gap-3 mb-5">
                    {activeBookings.map((b) => (
                      <BookingCard
                        key={b.id}
                        booking={b}
                        isConfirming={cancelConfirmId === b.id}
                        isCancelling={cancellingId === b.id}
                        cancelError={cancelConfirmId === b.id ? cancelError : null}
                        onCancelRequest={() => onCancelRequest(b.id)}
                        onCancelDismiss={onCancelDismiss}
                        onCancelConfirm={() => onCancelConfirm(b.id)}
                      />
                    ))}
                  </div>
                </>
              )}

              {pastBookings.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-[#5a6a85] uppercase tracking-wide mb-2">Past</p>
                  <div className="flex flex-col gap-3">
                    {pastBookings.map((b) => (
                      <BookingCard
                        key={b.id}
                        booking={b}
                        isConfirming={false}
                        isCancelling={false}
                        cancelError={null}
                        onCancelRequest={() => {}}
                        onCancelDismiss={onCancelDismiss}
                        onCancelConfirm={() => {}}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface BookingCardProps {
  booking: MyBooking
  isConfirming: boolean
  isCancelling: boolean
  cancelError: string | null
  onCancelRequest: () => void
  onCancelDismiss: () => void
  onCancelConfirm: () => void
}

function BookingCard({
  booking,
  isConfirming,
  isCancelling,
  cancelError,
  onCancelRequest,
  onCancelDismiss,
  onCancelConfirm,
}: BookingCardProps) {
  const cfg = STATUS_CONFIG[booking.status]
  const canCancel = booking.status === 'BOOKED'

  return (
    <div className="bg-white rounded-xl border border-[#e3eaf5] p-4 flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-[#1a1a2e] leading-snug">{booking.saloon_name}</p>
        <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.cls}`}>
          {cfg.label}
        </span>
      </div>

      {/* Date + arrival + barber */}
      <div className="flex flex-col gap-1">
        <p className="text-xs text-[#5a6a85]">{formatBookingDate(booking.session_date)}</p>
        <p className="text-xs text-[#5a6a85]">
          Your turn at {formatArrivalTime(booking.estimated_arrival_at)} · {formatSessionLabel(booking.session_label)} · {booking.barber_name}
        </p>
        {booking.services.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {booking.services.map((s) => (
              <span key={s.id} className="text-[10px] font-medium bg-[#e8f0fe] text-[#1565c0] px-2 py-0.5 rounded-full">
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* OTP (only for BOOKED with valid OTP) */}
      {booking.status === 'BOOKED' && booking.otp && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 bg-[#e8f0fe] rounded-lg px-3 py-2">
            <span className="text-xs font-semibold text-[#1565c0]">OTP</span>
            <span className="text-base font-bold text-[#1565c0] tracking-widest">{booking.otp}</span>
          </div>
          <p className="text-[10px] text-[#5a6a85]">
            Valid until {formatArrivalTime(new Date(new Date(booking.estimated_arrival_at).getTime() + 30 * 60 * 1000).toISOString())}
          </p>
        </div>
      )}

      {/* Cancel section */}
      {canCancel && !isConfirming && (
        <button
          onClick={onCancelRequest}
          className="self-start text-xs font-semibold text-[#c62828] hover:underline transition-colors"
        >
          Cancel booking
        </button>
      )}

      {canCancel && isConfirming && (
        <div className="border border-[#fce4e4] rounded-lg p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-[#1a1a2e]">Cancel this booking?</p>
          <p className="text-xs text-[#5a6a85]">This will cancel your booking. This action cannot be undone.</p>
          {cancelError && (
            <p className="text-xs text-[#c62828]">{cancelError}</p>
          )}
          <div className="flex gap-2 mt-1">
            <button
              onClick={onCancelDismiss}
              disabled={isCancelling}
              className="flex-1 text-xs font-semibold border border-[#e3eaf5] text-[#5a6a85] rounded-lg py-2 hover:border-[#5a6a85] transition-colors disabled:opacity-50"
            >
              Keep
            </button>
            <button
              onClick={onCancelConfirm}
              disabled={isCancelling}
              className="flex-1 text-xs font-semibold bg-[#c62828] text-white rounded-lg py-2 hover:bg-[#b71c1c] transition-colors disabled:opacity-50"
            >
              {isCancelling ? 'Cancelling…' : 'Yes, cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
