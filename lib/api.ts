const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1'

const isNgrok = process.env.NEXT_PUBLIC_API_URL?.includes('ngrok')

function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (isNgrok) headers.set('ngrok-skip-browser-warning', 'true')
  return fetch(input, { ...init, headers })
}

export interface PendingReviewBooking {
  id: string
  barber_id: string
  barber_name: string
  saloon_id: string
  saloon_name: string
  created_at: string
}

export interface SnivraUser {
  id: string
  phone: string
  name: string
  role: 'CUSTOMER' | 'BARBER' | 'OWNER'
  is_active: boolean
  created_at: string
  updated_at: string
  referral_code: string
  referral_points: number
  referred_by: string | null
  referral_credited: boolean
  // CUSTOMER-only review prompt fields
  isReview?: boolean
  pending_review_booking?: PendingReviewBooking | null
}

export interface GoogleAuthResponse {
  message: string
  requires_phone?: boolean
  is_new_user?: boolean
  email?: string
  suggested_name?: string
  user?: SnivraUser
  access_token?: string
  token_type?: string
}

export async function googleAuth(
  accessToken: string,
  phone?: string,
  name?: string,
  referralCode?: string
): Promise<GoogleAuthResponse> {
  const body: Record<string, string> = { access_token: accessToken }
  if (phone) body.phone = phone
  if (name) body.name = name
  if (referralCode) body.referral_code = referralCode

  const res = await apiFetch(`${API_URL}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || 'Authentication failed')
  }

  return data
}

export function setSnivraToken(token: string) {
  if (typeof document === 'undefined') return
  document.cookie = `snivra_token=${token}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`
}

export function getSnivraToken(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)snivra_token=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

export function clearSnivraToken() {
  if (typeof document === 'undefined') return
  document.cookie = 'snivra_token=; path=/; max-age=0; samesite=lax'
}

// ── User ───────────────────────────────────────────────────────────────────────

export async function getMe(token: string): Promise<SnivraUser> {
  const res = await apiFetch(`${API_URL}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(data.error || 'Failed to fetch user')
  return data.user
}

// ── Saloons ────────────────────────────────────────────────────────────────────

export interface NearbySaloon {
  id: string
  name: string
  distance: number
  is_open: boolean
  total_reviews: number
  satisfied_count: number
  satisfaction_rate: number | null
}

export async function getNearbySaloons(
  lat: number,
  lng: number,
  radius = 5
): Promise<NearbySaloon[]> {
  const res = await apiFetch(
    `${API_URL}/saloons/nearby?lat=${lat}&lng=${lng}&radius=${radius}`
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to fetch nearby salons')
  return data.saloons
}

// ── Barbers ────────────────────────────────────────────────────────────────────

export interface Barber {
  id: string
  name: string
  phone: string
  role: 'BARBER' | 'OWNER'
  is_available: boolean
  total_reviews: number
  satisfied_count: number
  satisfaction_rate: number | null
}

export async function getSalonBarbers(saloonId: string, token: string): Promise<Barber[]> {
  const res = await apiFetch(`${API_URL}/saloons/${saloonId}/barbers`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(data.error || 'Failed to fetch barbers')
  return data.barbers
}

// ── Services ──────────────────────────────────────────────────────────────────

export interface Service {
  id: string
  name: string
  description?: string
  price?: number
  duration_minutes?: number
  is_active: boolean
}

export async function getSalonServices(saloonId: string): Promise<Service[]> {
  const res = await apiFetch(`${API_URL}/saloons/${saloonId}/services`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to fetch services')
  return data.services
}

// ── Time Slots ────────────────────────────────────────────────────────────────

export interface ConfiguredDatesResult {
  configured_dates: string[]
  slot_count_by_date: Record<string, number>
}

export async function getConfiguredDates(
  saloonId: string,
  month: string, // YYYY-MM
  token: string
): Promise<ConfiguredDatesResult> {
  const res = await apiFetch(
    `${API_URL}/time-slots/${saloonId}/configured-dates?month=${month}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await res.json()
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(data.error || 'Failed to fetch configured dates')
  return data
}

export interface TimeSlot {
  id: string
  start_time: string
  end_time: string
  is_available: boolean
  barber_available: boolean
  status: string
}

export interface BarberSlotsResult {
  barber_is_available: boolean
  slots: TimeSlot[]
  summary: {
    total_slots: number
    available_slots: number
    unavailable_slots: number
    barber_unavailable_slots: number
  }
}

export async function getBarberSlots(
  saloonId: string,
  slotDate: string,
  barberId: string,
  token: string
): Promise<BarberSlotsResult> {
  const res = await apiFetch(
    `${API_URL}/time-slots/${saloonId}/barber-slots?slot_date=${slotDate}&barber_id=${barberId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await res.json()
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(data.error || 'Failed to fetch time slots')
  return data
}

// ── Bookings ──────────────────────────────────────────────────────────────────

export interface BookingResult {
  booking: { id: string; status: string }
  otp: string
}

export async function createBooking(
  saloonId: string,
  timeSlotId: string,
  token: string,
  serviceIds?: string[]
): Promise<BookingResult> {
  const body: Record<string, unknown> = { saloon_id: saloonId, time_slot_id: timeSlotId }
  if (serviceIds && serviceIds.length > 0) body.service_ids = serviceIds
  const res = await apiFetch(`${API_URL}/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(data.error || 'Failed to create booking')
  return data
}

export interface MyBooking {
  id: string
  status: 'BOOKED' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'
  slot_date: string
  start_time: string
  end_time: string
  barber_name: string
  saloon_name: string
  otp: string
  services: { id: string; name: string }[]
}

export async function getMyBookings(token: string): Promise<MyBooking[]> {
  const res = await apiFetch(`${API_URL}/bookings/my-bookings`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(data.error || 'Failed to fetch bookings')
  return data.bookings
}

export async function cancelBooking(
  bookingId: string,
  token: string
): Promise<{ id: string; status: string }> {
  const res = await apiFetch(`${API_URL}/bookings/${bookingId}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(data.error || 'Failed to cancel booking')
  return data.booking
}

// ── Ratings ──────────────────────────────────────────────────────────────────

export interface RatingResult {
  id: string
  booking_id: string
  customer_id: string
  barber_id: string
  saloon_id: string
  rating: 0 | 1
  created_at: string
}

export async function submitRating(
  bookingId: string,
  rating: 0 | 1,
  token: string
): Promise<RatingResult> {
  const res = await apiFetch(`${API_URL}/ratings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ booking_id: bookingId, rating }),
  })
  const data = await res.json()
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(data.error || 'Failed to submit rating')
  return data.rating
}

// ── Push Tokens ───────────────────────────────────────────────────────────────

export async function saveWebSubscription(
  subscription: PushSubscriptionJSON,
  token: string
): Promise<void> {
  const res = await apiFetch(`${API_URL}/tokens/web-subscription`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ subscription }),
  })
  const data = await res.json()
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(data.error || 'Failed to save push subscription')
}
