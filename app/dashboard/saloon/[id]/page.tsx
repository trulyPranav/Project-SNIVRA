'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import {
  getSnivraToken,
  clearSnivraToken,
  getSalonBarbers,
  getSalonServices,
  getConfiguredDates,
  getBarberSlots,
  createBooking,
} from '@/lib/api'
import type { Barber, Service, TimeSlot } from '@/lib/api'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt12(time24: string): string {
  const [hStr, mStr] = time24.split(':')
  const h = parseInt(hStr, 10)
  const m = mStr
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${period}`
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  })
}

function dayLabel(dateStr: string): { day: string; date: string } {
  const d = new Date(dateStr + 'T00:00:00')
  return {
    day: d.toLocaleDateString('en-IN', { weekday: 'short' }),
    date: d.getDate().toString(),
  }
}

function todayYYYYMM(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function addMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function isBeforeToday(dateStr: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(dateStr + 'T00:00:00') < today
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SaloonBookingPage() {
  const { id: saloonId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()

  const saloonName = searchParams.get('name') ?? 'Salon'

  // Auth
  const [token, setToken] = useState<string | null>(null)

  // Data
  const [barbers, setBarbers] = useState<Barber[]>([])
  const [configuredDates, setConfiguredDates] = useState<string[]>([])
  const [slotCountByDate, setSlotCountByDate] = useState<Record<string, number>>({})
  const [slots, setSlots] = useState<TimeSlot[]>([])

  // Selections
  const [currentMonth, setCurrentMonth] = useState<string>(todayYYYYMM())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedBarber, setSelectedBarber] = useState<Barber | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)

  // Loading states
  const [barbersLoading, setBarbersLoading] = useState(true)
  const [datesLoading, setDatesLoading] = useState(true)
  const [slotsLoading, setSlotsLoading] = useState(false)

  // Errors
  const [barbersError, setBarbersError] = useState<string | null>(null)
  const [datesError, setDatesError] = useState<string | null>(null)
  const [slotsError, setSlotsError] = useState<string | null>(null)

  // Booking
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [booking, setBooking] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [bookingSuccess, setBookingSuccess] = useState<{ id: string; otp: string } | null>(null)
  const [barberIsAvailable, setBarberIsAvailable] = useState<boolean | null>(null)
  // Services
  const [services, setServices] = useState<Service[]>([])
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [servicesLoading, setServicesLoading] = useState(true)
  const [servicesError, setServicesError] = useState<string | null>(null)
  // ── Auth init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = getSnivraToken()
    if (!t) { router.replace('/login'); return }
    setToken(t)
  }, [router])
  // ── Fetch services (no auth needed) ──────────────────────────────────────────────
  useEffect(() => {
    setServicesLoading(true)
    setServicesError(null)
    getSalonServices(saloonId)
      .then((data) => setServices(data))
      .catch((e: Error) => setServicesError(e.message))
      .finally(() => setServicesLoading(false))
  }, [saloonId])
  // ── Fetch barbers ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return
    setBarbersLoading(true)
    setBarbersError(null)
    getSalonBarbers(saloonId, token)
      .then((data) => setBarbers(data))
      .catch((e: Error) => {
        if (e.message === 'UNAUTHORIZED') { clearSnivraToken(); router.replace('/login'); return }
        setBarbersError(e.message)
      })
      .finally(() => setBarbersLoading(false))
  }, [token, saloonId, router])

  // ── Fetch configured dates ───────────────────────────────────────────────────
  const fetchDates = useCallback(
    (month: string) => {
      if (!token) return
      setDatesLoading(true)
      setDatesError(null)
      setSelectedDate(null)
      setSelectedSlot(null)
      setSlots([])
      getConfiguredDates(saloonId, month, token)
        .then((res) => {
          setConfiguredDates(res.configured_dates)
          setSlotCountByDate(res.slot_count_by_date)
        })
        .catch((e: Error) => {
          if (e.message === 'UNAUTHORIZED') { clearSnivraToken(); router.replace('/login'); return }
          setDatesError(e.message)
        })
        .finally(() => setDatesLoading(false))
    },
    [token, saloonId, router]
  )

  useEffect(() => {
    fetchDates(currentMonth)
  }, [currentMonth, fetchDates])

  // ── Fetch slots ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !selectedDate || !selectedBarber) {
      setSlots([])
      setSelectedSlot(null)
      setBarberIsAvailable(null)
      return
    }
    setSlotsLoading(true)
    setSlotsError(null)
    setSelectedSlot(null)
    setBarberIsAvailable(null)
    getBarberSlots(saloonId, selectedDate, selectedBarber.id, token)
      .then((res) => {
        setSlots(res.slots)
        setBarberIsAvailable(res.barber_is_available)
      })
      .catch((e: Error) => {
        if (e.message === 'UNAUTHORIZED') { clearSnivraToken(); router.replace('/login'); return }
        setSlotsError(e.message)
        setSlots([])
      })
      .finally(() => setSlotsLoading(false))
  }, [token, saloonId, selectedDate, selectedBarber, router])

  // ── Book ──────────────────────────────────────────────────────────────────────
  async function handleBook() {
    if (!token || !selectedBarber || !selectedSlot) return
    setBooking(true)
    setBookingError(null)
    try {
      const result = await createBooking(
        saloonId,
        selectedSlot.id,
        token,
        selectedServiceIds.length > 0 ? selectedServiceIds : undefined
      )
      setBookingSuccess({ id: result.booking.id, otp: result.otp })
      setConfirmOpen(false)
    } catch (e) {
      setBookingError(e instanceof Error ? e.message : 'Booking failed. Please try again.')
    } finally {
      setBooking(false)
    }
  }

  function handleBarberSelect(barber: Barber) {
    if (selectedBarber?.id === barber.id) return
    setSelectedBarber(barber)
    setSelectedSlot(null)
    setBarberIsAvailable(null)
  }

  function handleServiceToggle(serviceId: string) {
    setSelectedServiceIds((prev) =>
      prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId]
    )
  }

  function handleDateSelect(d: string) {
    if (selectedDate === d) return
    setSelectedDate(d)
    setSelectedSlot(null)
  }

  function handleMonthChange(delta: number) {
    const next = addMonth(currentMonth, delta)
    // Don't go before current month
    if (next < todayYYYYMM()) return
    setCurrentMonth(next)
  }

  // ── Booking success screen ───────────────────────────────────────────────────
  if (bookingSuccess) {
    return (
      <div className="min-h-screen bg-[#f4f6fb] flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-[#e3eaf5] shadow-sm p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-[#e8f5e9] flex items-center justify-center mx-auto mb-4">
            <CheckCircleIcon />
          </div>
          <h2 className="text-lg font-bold text-[#1a1a2e] mb-1">Booking Confirmed!</h2>
          <p className="text-xs text-[#5a6a85] mb-6">
            Show this OTP to the barber when you arrive.
          </p>

          {/* OTP display */}
          <div className="bg-[#f4f6fb] border border-[#e3eaf5] rounded-2xl py-5 px-4 mb-6">
            <p className="text-xs text-[#5a6a85] mb-1.5">Your OTP</p>
            <p className="text-4xl font-bold tracking-[0.25em] text-[#1565c0]">
              {bookingSuccess.otp}
            </p>
          </div>

          {/* Summary */}
          <div className="flex flex-col gap-2 mb-6 text-left">
            <SummaryRow label="Salon" value={saloonName} />
            <SummaryRow label="Date" value={selectedDate ?? ''} />
            <SummaryRow
              label="Time"
              value={selectedSlot ? `${fmt12(selectedSlot.start_time)} – ${fmt12(selectedSlot.end_time)}` : ''}
            />
            <SummaryRow label="Barber" value={selectedBarber?.name ?? ''} />
            {selectedServiceIds.length > 0 && (
              <SummaryRow
                label="Services"
                value={services.filter((s) => selectedServiceIds.includes(s.id)).map((s) => s.name).join(', ')}
              />
            )}
          </div>

          <button
            onClick={() => router.replace('/dashboard')}
            className="w-full bg-[#1565c0] hover:bg-[#0d47a1] text-white font-semibold text-sm rounded-xl py-3 transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  // ─── Main booking page ────────────────────────────────────────────────────────
  const hasServices = !servicesLoading && services.length > 0
  const timeStepNum = hasServices ? 4 : 3
  const canBook = !!selectedDate && !!selectedBarber && !!selectedSlot

  return (
    <div className="min-h-screen bg-[#f4f6fb] flex flex-col pb-24">

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-white border-b border-[#e3eaf5] px-4 h-14 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="text-[#5a6a85] hover:text-[#1565c0] transition-colors -ml-1 p-1"
        >
          <BackIcon />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-[#1a1a2e] truncate">{saloonName}</h1>
          <p className="text-[11px] text-[#5a6a85]">Book a slot</p>
        </div>
      </header>

      <div className="w-full max-w-xl mx-auto px-4 pt-4 flex flex-col gap-4">

        {/* ── Step 1: Date ── */}
        <Section
          step={1}
          title="Select Date"
          filled={!!selectedDate}
          filledLabel={selectedDate ?? undefined}
        >
          {/* Month navigator */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => handleMonthChange(-1)}
              disabled={currentMonth <= todayYYYYMM()}
              className="p-1.5 rounded-lg hover:bg-[#f4f6fb] disabled:opacity-30 transition-colors"
            >
              <ChevronLeftIcon />
            </button>
            <span className="text-xs font-semibold text-[#1a1a2e]">
              {monthLabel(currentMonth)}
            </span>
            <button
              onClick={() => handleMonthChange(1)}
              className="p-1.5 rounded-lg hover:bg-[#f4f6fb] transition-colors"
            >
              <ChevronRightIcon />
            </button>
          </div>

          {datesLoading ? (
            <div className="flex justify-center py-5">
              <Spinner size={22} />
            </div>
          ) : datesError ? (
            <ErrorInline message={datesError} onRetry={() => fetchDates(currentMonth)} />
          ) : configuredDates.length === 0 ? (
            <p className="text-center text-xs text-[#5a6a85] py-4">
              No available dates this month.
            </p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {configuredDates
                .filter((d) => !isBeforeToday(d))
                .map((d) => {
                  const { day, date } = dayLabel(d)
                  const count = slotCountByDate[d] ?? 0
                  const active = selectedDate === d
                  return (
                    <button
                      key={d}
                      onClick={() => handleDateSelect(d)}
                      className={`shrink-0 flex flex-col items-center rounded-xl px-3 pt-2.5 pb-2 border min-w-[52px] transition-all ${
                        active
                          ? 'bg-[#1565c0] border-[#1565c0] text-white'
                          : 'bg-white border-[#e3eaf5] text-[#1a1a2e] hover:border-[#1565c0]'
                      }`}
                    >
                      <span className={`text-[10px] font-medium uppercase ${active ? 'text-blue-200' : 'text-[#5a6a85]'}`}>
                        {day}
                      </span>
                      <span className="text-sm font-bold leading-snug">{date}</span>
                      <span className={`text-[10px] mt-0.5 ${active ? 'text-blue-200' : 'text-[#5a6a85]'}`}>
                        {count}
                      </span>
                    </button>
                  )
                })}
            </div>
          )}
        </Section>

        {/* ── Step 2: Barber ── */}
        <Section
          step={2}
          title="Select Barber"
          filled={!!selectedBarber}
        >
          {barbersLoading ? (
            <div className="flex justify-center py-5">
              <Spinner size={22} />
            </div>
          ) : barbersError ? (
            <ErrorInline message={barbersError} />
          ) : barbers.length === 0 ? (
            <p className="text-center text-xs text-[#5a6a85] py-4">No barbers available.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {barbers.map((b) => {
                const active = selectedBarber?.id === b.id
                return (
                  <button
                    key={b.id}
                    onClick={() => handleBarberSelect(b)}
                    className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl border text-left transition-all ${
                      active
                        ? 'bg-[#1565c0] border-[#1565c0] text-white'
                        : 'bg-white border-[#e3eaf5] text-[#1a1a2e] hover:border-[#1565c0]'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                      active ? 'bg-white/20 text-white' : 'bg-[#e8f0fe] text-[#1565c0]'
                    }`}>
                      {b.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${active ? 'text-white' : 'text-[#1a1a2e]'}`}>{b.name}</p>
                      {!b.is_available && (
                        <p className={`text-[10px] font-medium ${active ? 'text-orange-200' : 'text-[#e65100]'}`}>Unavailable</p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </Section>

        {/* ── Step 3: Services (optional) ── */}
        {hasServices && (
          <Section
            step={3}
            title="Select Services"
            filled={selectedServiceIds.length > 0}
            filledLabel={`${selectedServiceIds.length} service${selectedServiceIds.length !== 1 ? 's' : ''} selected`}
          >
            {servicesError ? (
              <ErrorInline message={servicesError} />
            ) : (
              <div className="flex flex-col gap-2">
                {/* <p className="text-[11px] text-[#5a6a85] mb-1">Optional — tap to add</p> */}
                {services.map((svc) => {
                  const sel = selectedServiceIds.includes(svc.id)
                  return (
                    <button
                      key={svc.id}
                      onClick={() => handleServiceToggle(svc.id)}
                      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl border text-left transition-all ${
                        sel
                          ? 'bg-[#1565c0] border-[#1565c0] text-white'
                          : 'bg-white border-[#e3eaf5] text-[#1a1a2e] hover:border-[#1565c0]'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                        sel ? 'bg-white border-white' : 'border-[#c0cbd8]'
                      }`}>
                        {sel && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold truncate ${sel ? 'text-white' : 'text-[#1a1a2e]'}`}>{svc.name}</p>
                        {svc.description && (
                          <p className={`text-[10px] truncate ${sel ? 'text-blue-200' : 'text-[#5a6a85]'}`}>{svc.description}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        {svc.price != null && (
                          <p className={`text-sm font-bold ${sel ? 'text-white' : 'text-[#1565c0]'}`}>₹{svc.price}</p>
                        )}
                        {svc.duration_minutes != null && (
                          <p className={`text-[10px] ${sel ? 'text-blue-200' : 'text-[#5a6a85]'}`}>{svc.duration_minutes}m</p>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </Section>
        )}

        {/* ── Step 3/4: Time Slot ── */}
        <Section
          step={timeStepNum}
          title="Select Time"
          filled={!!selectedSlot}
          filledLabel={selectedSlot ? `${fmt12(selectedSlot.start_time)} – ${fmt12(selectedSlot.end_time)}` : undefined}
          muted={!selectedDate || !selectedBarber}
          mutedLabel={!selectedDate ? 'Select a date first' : !selectedBarber ? 'Select a barber first' : undefined}
        >
          {selectedDate && selectedBarber && (
            <>
              {barberIsAvailable === false && !slotsLoading && !slotsError && (
                <div className="mb-3 flex items-start gap-2 bg-[#fff8e1] border border-[#ffe082] rounded-xl px-3 py-2.5">
                  <svg className="shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <p className="text-[11px] text-[#e65100] leading-snug">
                    This barber is currently marked unavailable — they may not be present.
                  </p>
                </div>
              )}
              {slotsLoading ? (
                <div className="flex justify-center py-5">
                  <Spinner size={22} />
                </div>
              ) : slotsError ? (
                <ErrorInline message={slotsError} />
              ) : slots.length === 0 ? (
                <p className="text-center text-xs text-[#5a6a85] py-4">
                  No slots available for this barber on this date.
                </p>
              ) : (
                <SlotGrid
                  slots={slots}
                  selected={selectedSlot}
                  onSelect={setSelectedSlot}
                />
              )}
            </>
          )}
        </Section>
      </div>

      {/* ── Floating Book button ── */}
      {canBook && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#e3eaf5] px-4 py-3 safe-bottom">
          <div className="max-w-xl mx-auto">
            <button
              onClick={() => setConfirmOpen(true)}
              className="w-full bg-[#1565c0] hover:bg-[#0d47a1] text-white font-semibold text-sm rounded-xl py-3.5 transition-colors"
            >
              Book — {fmt12(selectedSlot!.start_time)} to {fmt12(selectedSlot!.end_time)}
            </button>
          </div>
        </div>
      )}

      {/* ── Confirm modal ── */}
      {confirmOpen && selectedDate && selectedBarber && selectedSlot && (
        <ConfirmModal
          saloonName={saloonName}
          date={selectedDate}
          slot={selectedSlot}
          barber={selectedBarber}
          selectedServices={services.filter((s) => selectedServiceIds.includes(s.id))}
          loading={booking}
          error={bookingError}
          onConfirm={handleBook}
          onClose={() => { setConfirmOpen(false); setBookingError(null) }}
        />
      )}
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  step,
  title,
  filled,
  filledLabel,
  muted,
  mutedLabel,
  children,
}: {
  step: number
  title: string
  filled?: boolean
  filledLabel?: string
  muted?: boolean
  mutedLabel?: string
  children?: React.ReactNode
}) {
  return (
    <div className={`bg-white rounded-xl border ${muted ? 'border-[#e3eaf5] opacity-60' : 'border-[#e3eaf5]'} overflow-hidden`}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
            filled
              ? 'bg-[#1565c0] text-white'
              : 'bg-[#e8f0fe] text-[#1565c0]'
          }`}
        >
          {filled ? <CheckSmallIcon /> : step}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1a1a2e]">{title}</p>
          {filled && filledLabel && (
            <p className="text-xs text-[#1565c0] font-medium truncate">{filledLabel}</p>
          )}
          {muted && mutedLabel && (
            <p className="text-xs text-[#b0bec5]">{mutedLabel}</p>
          )}
        </div>
      </div>

      {!muted && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Slot Grid ────────────────────────────────────────────────────────────────

function SlotGrid({
  slots,
  selected,
  onSelect,
}: {
  slots: TimeSlot[]
  selected: TimeSlot | null
  onSelect: (s: TimeSlot) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {slots.map((s) => {
        const active = selected?.id === s.id
        const booked = !s.is_available
        const barberOut = s.barber_available === false
        const disabled = booked || barberOut
        return (
          <button
            key={s.id}
            disabled={disabled}
            onClick={() => onSelect(s)}
            title={barberOut && !booked ? 'Barber unavailable for this slot' : undefined}
            className={`rounded-xl border py-2.5 text-center transition-all ${
              booked
                ? 'bg-[#f4f6fb] border-[#e3eaf5] text-[#c0cbd8] cursor-not-allowed'
                : barberOut
                ? 'bg-[#fff8e1] border-[#ffe082] text-[#bf6e00] cursor-not-allowed'
                : active
                ? 'bg-[#1565c0] border-[#1565c0] text-white'
                : 'bg-white border-[#e3eaf5] text-[#1a1a2e] hover:border-[#1565c0]'
            }`}
          >
            <span className="text-xs font-semibold leading-tight block">
              {fmt12(s.start_time)}
            </span>
            {barberOut && !booked && (
              <span className="text-[9px] leading-tight block mt-0.5 font-medium text-[#bf6e00]">
                Unavailable
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────

function ConfirmModal({
  saloonName,
  date,
  slot,
  barber,
  selectedServices,
  loading,
  error,
  onConfirm,
  onClose,
}: {
  saloonName: string
  date: string
  slot: TimeSlot
  barber: Barber
  selectedServices: { id: string; name: string }[]
  loading: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-t-2xl shadow-2xl w-full">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[#e3eaf5]" />
        </div>
        <div className="px-5 pb-6 pt-2">
          <h3 className="text-base font-bold text-[#1a1a2e] mb-4">Confirm Booking</h3>

          <div className="flex flex-col gap-2.5 mb-5">
            <SummaryRow label="Salon" value={saloonName} />
            <SummaryRow label="Date" value={date} />
            <SummaryRow
              label="Time"
              value={`${fmt12(slot.start_time)} – ${fmt12(slot.end_time)}`}
            />
            <SummaryRow label="Barber" value={barber.name} />
            {selectedServices.length > 0 && (
              <SummaryRow
                label="Services"
                value={selectedServices.map((s) => s.name).join(', ')}
              />
            )}
          </div>

          {error && (
            <div className="mb-4 bg-[#fce4e4] border border-[#ef9a9a] rounded-xl px-3 py-2.5">
              <p className="text-xs text-[#c62828]">{error}</p>
            </div>
          )}

          <button
            onClick={onConfirm}
            disabled={loading}
            className="w-full bg-[#1565c0] hover:bg-[#0d47a1] disabled:opacity-60 text-white font-semibold text-sm rounded-xl py-3.5 transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Spinner size={15} color="white" />}
            {loading ? 'Booking…' : 'Confirm Booking'}
          </button>

          <button
            onClick={onClose}
            disabled={loading}
            className="w-full mt-2 text-sm font-medium text-[#5a6a85] py-2.5"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Summary Row ──────────────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-[#5a6a85] shrink-0">{label}</span>
      <span className="text-xs font-semibold text-[#1a1a2e] text-right min-w-0 truncate">{value}</span>
    </div>
  )
}

// ─── Error inline ─────────────────────────────────────────────────────────────

function ErrorInline({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center py-4 text-center">
      <p className="text-xs text-[#c62828] mb-2">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-xs font-semibold text-[#1565c0] underline">
          Retry
        </button>
      )}
    </div>
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner({ size = 22, color = '#1565c0' }: { size?: number; color?: string }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
    </svg>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a1a2e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a1a2e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function CheckSmallIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}
