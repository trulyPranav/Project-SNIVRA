const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1'

export interface SnivraUser {
  id: string
  phone: string
  name: string
  role: 'CUSTOMER' | 'BARBER' | 'OWNER'
  is_active: boolean
  created_at: string
  updated_at: string
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
  name?: string
): Promise<GoogleAuthResponse> {
  const body: Record<string, string> = { access_token: accessToken }
  if (phone) body.phone = phone
  if (name) body.name = name

  const res = await fetch(`${API_URL}/auth/google`, {
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
  const res = await fetch(`${API_URL}/users/me`, {
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
}

export async function getNearbySaloons(
  lat: number,
  lng: number,
  radius = 5
): Promise<NearbySaloon[]> {
  const res = await fetch(
    `${API_URL}/saloons/nearby?lat=${lat}&lng=${lng}&radius=${radius}`
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to fetch nearby salons')
  return data.saloons
}

// ── Seats ──────────────────────────────────────────────────────────────────────

export interface Seat {
  id: string
  saloon_id: string
  seat_number: number
  is_active: boolean
}

export async function getSeats(saloonId: string, token: string): Promise<Seat[]> {
  const res = await fetch(`${API_URL}/seats/${saloonId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(data.error || 'Failed to fetch seats')
  return data.seats
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
  const res = await fetch(
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
  status: string
}

export interface SeatSlotsResult {
  slots: TimeSlot[]
  summary: {
    total_slots: number
    available_slots: number
    unavailable_slots: number
  }
}

export async function getSeatSlots(
  saloonId: string,
  slotDate: string,
  seatNumber: number,
  token: string
): Promise<SeatSlotsResult> {
  const res = await fetch(
    `${API_URL}/time-slots/${saloonId}/seat-slots?slot_date=${slotDate}&seat_number=${seatNumber}`,
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
  seatId: string,
  token: string
): Promise<BookingResult> {
  const res = await fetch(`${API_URL}/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ saloon_id: saloonId, time_slot_id: timeSlotId, seat_id: seatId }),
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
  seat_number: number
  saloon_name: string
  otp: string
}

export async function getMyBookings(token: string): Promise<MyBooking[]> {
  const res = await fetch(`${API_URL}/bookings/my-bookings`, {
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
  const res = await fetch(`${API_URL}/bookings/${bookingId}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(data.error || 'Failed to cancel booking')
  return data.booking
}

// ── Push Tokens ───────────────────────────────────────────────────────────────

export async function saveWebSubscription(
  subscription: PushSubscriptionJSON,
  token: string
): Promise<void> {
  const res = await fetch(`${API_URL}/tokens/web-subscription`, {
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
