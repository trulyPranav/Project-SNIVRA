'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import {
  getSnivraToken,
  clearSnivraToken,
  getSalonBarbers,
  getSalonServices,
  getSessions,
  createBooking,
  PartialFitError,
} from '@/lib/api'
import type { Barber, Service, Session, BookingService } from '@/lib/api'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt12(time24: string): string {
  const [hStr, mStr] = time24.split(':')
  const h = parseInt(hStr, 10)
  const m = mStr
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${period}`
}

function formatArrivalTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatOtpExpiry(iso: string): string {
  const expiry = new Date(new Date(iso).getTime() + 30 * 60 * 1000)
  return expiry.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

const SESSION_LABELS: Record<Session['label'], string> = {
  MORNING: 'Morning',
  AFTERNOON: 'Afternoon',
  EVENING: 'Evening',
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

function todayYYYYMMDD(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

function daysInMonth(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number)
  const count = new Date(y, m, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return Array.from({ length: count }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SaloonBookingPage() {
  const { id: saloonId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()

  const saloonName = searchParams.get('name') ?? 'Salon'

  const [token, setToken] = useState<string | null>(null)

  const [barbers, setBarbers] = useState<Barber[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [sessions, setSessions] = useState<Session[]>([])

  const [currentMonth, setCurrentMonth] = useState<string>(todayYYYYMM())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [selectedBarber, setSelectedBarber] = useState<Barber | null>(null)

  const [barbersLoading, setBarbersLoading] = useState(true)
  const [servicesLoading, setServicesLoading] = useState(true)
  const [sessionsLoading, setSessionsLoading] = useState(false)

  const [barbersError, setBarbersError] = useState<string | null>(null)
  const [servicesError, setServicesError] = useState<string | null>(null)
  const [sessionsError, setSessionsError] = useState<string | null>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [booking, setBooking] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [bookingSuccess, setBookingSuccess] = useState<{
    id: string
    otp: string
    estimated_arrival_at: string
  } | null>(null)
  const [partialFit, setPartialFit] = useState<{
    feasibleServices: BookingService[]
    rejectedServices: BookingService[]
  } | null>(null)

  const selectedDurationMinutes = useMemo(
    () =>
      services
        .filter((s) => selectedServiceIds.includes(s.id))
        .reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0),
    [services, selectedServiceIds]
  )

  const barberMap = useMemo(
    () => new Map(barbers.map((b) => [b.id, b])),
    [barbers]
  )

  useEffect(() => {
    const t = getSnivraToken()
    if (!t) { router.replace('/login'); return }
    setToken(t)
  }, [router])

  useEffect(() => {
    setServicesLoading(true)
    setServicesError(null)
    getSalonServices(saloonId)
      .then((data) => setServices(data.filter((s) => s.is_active)))
      .catch((e: Error) => setServicesError(e.message))
      .finally(() => setServicesLoading(false))
  }, [saloonId])

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

  useEffect(() => {
    if (!token || !selectedDate) {
      setSessions([])
      setSelectedSession(null)
      setSelectedBarber(null)
      return
    }
    setSessionsLoading(true)
    setSessionsError(null)
    setSelectedSession(null)
    setSelectedBarber(null)
    getSessions(saloonId, selectedDate, token)
      .then((res) => setSessions(res.sessions.filter((s) => s.is_active)))
      .catch((e: Error) => {
        if (e.message === 'UNAUTHORIZED') { clearSnivraToken(); router.replace('/login'); return }
        setSessionsError(e.message)
        setSessions([])
      })
      .finally(() => setSessionsLoading(false))
  }, [token, saloonId, selectedDate, router])

  async function handleBook(serviceIds: string[]) {
    if (!token || !selectedBarber || !selectedSession) return
    setBooking(true)
    setBookingError(null)
    try {
      const result = await createBooking(
        saloonId,
        selectedSession.id,
        selectedBarber.id,
        serviceIds,
        token
      )
      setBookingSuccess({
        id: result.booking.id,
        otp: result.otp,
        estimated_arrival_at: result.estimated_arrival_at,
      })
      setConfirmOpen(false)
      setPartialFit(null)
    } catch (e) {
      if (e instanceof PartialFitError) {
        setPartialFit({
          feasibleServices: e.feasibleServices,
          rejectedServices: e.rejectedServices,
        })
        setConfirmOpen(false)
      } else {
        setBookingError(e instanceof Error ? e.message : 'Booking failed. Please try again.')
      }
    } finally {
      setBooking(false)
    }
  }

  function handleServiceToggle(serviceId: string) {
    setSelectedServiceIds((prev) =>
      prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId]
    )
    setSelectedSession(null)
    setSelectedBarber(null)
  }

  function handleDateSelect(d: string) {
    if (selectedDate === d) return
    setSelectedDate(d)
    setSelectedSession(null)
    setSelectedBarber(null)
  }

  function handleSessionSelect(session: Session) {
    if (selectedSession?.id === session.id) return
    setSelectedSession(session)
    setSelectedBarber(null)
  }

  function handleBarberSelect(barber: Barber) {
    setSelectedBarber(barber)
  }

  function handleMonthChange(delta: number) {
    const next = addMonth(currentMonth, delta)
    if (next < todayYYYYMM()) return
    setCurrentMonth(next)
    setSelectedDate(null)
    setSelectedSession(null)
    setSelectedBarber(null)
  }

  function handlePartialFitConfirm() {
    if (!partialFit) return
    const ids = partialFit.feasibleServices.map((s) => s.id)
    setSelectedServiceIds(ids)
    setPartialFit(null)
    setConfirmOpen(true)
  }

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

          <div className="bg-[#f4f6fb] border border-[#e3eaf5] rounded-2xl py-5 px-4 mb-4">
            <p className="text-xs text-[#5a6a85] mb-1.5">Your OTP</p>
            <p className="text-4xl font-bold tracking-[0.25em] text-[#1565c0]">
              {bookingSuccess.otp}
            </p>
          </div>

          <div className="bg-[#e8f0fe] rounded-xl px-4 py-3 mb-6">
            <p className="text-xs text-[#5a6a85]">Your turn at</p>
            <p className="text-lg font-bold text-[#1565c0]">
              {formatArrivalTime(bookingSuccess.estimated_arrival_at)}
            </p>
            <p className="text-[10px] text-[#5a6a85] mt-1">
              OTP valid until {formatOtpExpiry(bookingSuccess.estimated_arrival_at)}
            </p>
          </div>

          <div className="flex flex-col gap-2 mb-6 text-left">
            <SummaryRow label="Salon" value={saloonName} />
            <SummaryRow label="Date" value={selectedDate ?? ''} />
            {selectedSession && (
              <SummaryRow
                label="Session"
                value={`${SESSION_LABELS[selectedSession.label]} (${fmt12(selectedSession.start_time)} – ${fmt12(selectedSession.end_time)})`}
              />
            )}
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

  const hasServices = !servicesLoading && services.length > 0
  const canBook =
    selectedServiceIds.length > 0 &&
    selectedDurationMinutes > 0 &&
    !!selectedDate &&
    !!selectedSession &&
    !!selectedBarber

  const calendarDays = daysInMonth(currentMonth).filter((d) => !isBeforeToday(d))

  return (
    <div className="min-h-screen bg-[#f4f6fb] flex flex-col pb-24">

      <header className="sticky top-0 z-20 bg-white border-b border-[#e3eaf5] px-4 h-14 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="text-[#5a6a85] hover:text-[#1565c0] transition-colors -ml-1 p-1"
        >
          <BackIcon />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-[#1a1a2e] truncate">{saloonName}</h1>
          <p className="text-[11px] text-[#5a6a85]">Book an appointment</p>
        </div>
      </header>

      <div className="w-full max-w-xl mx-auto px-4 pt-4 flex flex-col gap-4">

        {/* Step 1: Date */}
        <Section
          step={1}
          title="Select Date"
          filled={!!selectedDate}
          filledLabel={selectedDate ?? undefined}
        >
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

          {calendarDays.length === 0 ? (
            <p className="text-center text-xs text-[#5a6a85] py-4">
              No available dates this month.
            </p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-2 [scrollbar-width:none] sm:[scrollbar-width:thin] sm:[scrollbar-color:#c5d8fb_transparent] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#c5d8fb] [&::-webkit-scrollbar-thumb]:rounded-full" style={{ WebkitOverflowScrolling: 'touch' }}>
              {calendarDays.map((d) => {
                const { day, date } = dayLabel(d)
                const active = selectedDate === d
                const isToday = d === todayYYYYMMDD()
                return (
                  <button
                    key={d}
                    onClick={() => handleDateSelect(d)}
                    className={`shrink-0 flex flex-col items-center rounded-xl px-3 pt-2.5 pb-2 border min-w-13 transition-all ${
                      active
                        ? 'bg-[#1565c0] border-[#1565c0] text-white'
                        : 'bg-white border-[#e3eaf5] text-[#1a1a2e] hover:border-[#1565c0]'
                    }`}
                  >
                    <span className={`text-[10px] font-medium uppercase ${active ? 'text-blue-200' : 'text-[#5a6a85]'}`}>
                      {day}
                    </span>
                    <span className="text-sm font-bold leading-snug">{date}</span>
                    {isToday && (
                      <span className={`text-[9px] mt-0.5 font-medium ${active ? 'text-blue-200' : 'text-[#1565c0]'}`}>
                        Today
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </Section>

        {/* Step 2: Services */}
        <Section
          step={2}
          title="Select Services"
          filled={selectedServiceIds.length > 0}
          filledLabel={
            selectedServiceIds.length > 0
              ? `${selectedServiceIds.length} service${selectedServiceIds.length !== 1 ? 's' : ''} · ${selectedDurationMinutes} min`
              : undefined
          }
          muted={!selectedDate}
          mutedLabel="Select a date first"
        >
          {selectedDate && (
            <>
              {servicesLoading ? (
                <div className="flex justify-center py-5">
                  <Spinner size={22} />
                </div>
              ) : servicesError ? (
                <ErrorInline message={servicesError} />
              ) : !hasServices ? (
                <p className="text-center text-xs text-[#5a6a85] py-4">
                  No services available at this salon.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
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
            </>
          )}
        </Section>

        {/* Step 3: Session */}
        <Section
          step={3}
          title="Select Session"
          filled={!!selectedSession}
          filledLabel={
            selectedSession
              ? `${SESSION_LABELS[selectedSession.label]} (${fmt12(selectedSession.start_time)} – ${fmt12(selectedSession.end_time)})`
              : undefined
          }
          muted={!selectedDate || selectedServiceIds.length === 0}
          mutedLabel={
            !selectedDate
              ? 'Select a date first'
              : selectedServiceIds.length === 0
              ? 'Select at least one service first'
              : undefined
          }
        >
          {selectedDate && selectedServiceIds.length > 0 && (
            <>
              {sessionsLoading ? (
                <div className="flex justify-center py-5">
                  <Spinner size={22} />
                </div>
              ) : sessionsError ? (
                <ErrorInline message={sessionsError} />
              ) : sessions.length === 0 ? (
                <p className="text-center text-xs text-[#5a6a85] py-4">
                  Salon is closed on this date.
                </p>
              ) : (
                <SessionPicker
                  sessions={sessions}
                  selectedSession={selectedSession}
                  requiredMinutes={selectedDurationMinutes}
                  onSessionSelect={handleSessionSelect}
                />
              )}
            </>
          )}
        </Section>

        {/* Step 4: Barber */}
        <Section
          step={4}
          title="Select Barber"
          filled={!!selectedBarber}
          filledLabel={selectedBarber?.name}
          muted={!selectedSession}
          mutedLabel="Select a session first"
        >
          {selectedSession && (
            <>
              {barbersLoading ? (
                <div className="flex justify-center py-5">
                  <Spinner size={22} />
                </div>
              ) : barbersError ? (
                <ErrorInline message={barbersError} />
              ) : (
                <BarberPicker
                  session={selectedSession}
                  barberMap={barberMap}
                  selectedBarber={selectedBarber}
                  requiredMinutes={selectedDurationMinutes}
                  onBarberSelect={handleBarberSelect}
                />
              )}
            </>
          )}
        </Section>
      </div>

      {canBook && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#e3eaf5] px-4 py-3 safe-bottom">
          <div className="max-w-xl mx-auto">
            <button
              onClick={() => setConfirmOpen(true)}
              className="w-full bg-[#1565c0] hover:bg-[#0d47a1] text-white font-semibold text-sm rounded-xl py-3.5 transition-colors"
            >
              Book — {SESSION_LABELS[selectedSession!.label]} with {selectedBarber!.name}
            </button>
          </div>
        </div>
      )}

      {confirmOpen && selectedDate && selectedBarber && selectedSession && (
        <ConfirmModal
          saloonName={saloonName}
          date={selectedDate}
          session={selectedSession}
          barber={selectedBarber}
          selectedServices={services.filter((s) => selectedServiceIds.includes(s.id))}
          loading={booking}
          error={bookingError}
          onConfirm={() => handleBook(selectedServiceIds)}
          onClose={() => { setConfirmOpen(false); setBookingError(null) }}
        />
      )}

      {partialFit && (
        <PartialFitModal
          feasible={partialFit.feasibleServices}
          rejected={partialFit.rejectedServices}
          onConfirm={handlePartialFitConfirm}
          onDismiss={() => setPartialFit(null)}
        />
      )}
    </div>
  )
}

// ─── Session Picker ───────────────────────────────────────────────────────────

function SessionPicker({
  sessions,
  selectedSession,
  requiredMinutes,
  onSessionSelect,
}: {
  sessions: Session[]
  selectedSession: Session | null
  requiredMinutes: number
  onSessionSelect: (s: Session) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {sessions.map((session) => {
        const active = selectedSession?.id === session.id
        const availableBarbers = session.barber_capacity.filter(
          (bc) => bc.remaining_minutes >= requiredMinutes
        )

        return (
          <button
            key={session.id}
            onClick={() => onSessionSelect(session)}
            className={`w-full flex items-center justify-between px-3 py-3 rounded-xl border text-left transition-all ${
              active
                ? 'bg-[#1565c0] border-[#1565c0] text-white'
                : 'bg-white border-[#e3eaf5] text-[#1a1a2e] hover:border-[#1565c0]'
            }`}
          >
            <div>
              <p className={`text-sm font-semibold ${active ? 'text-white' : 'text-[#1a1a2e]'}`}>
                {SESSION_LABELS[session.label]}
              </p>
              <p className={`text-[11px] mt-0.5 ${active ? 'text-blue-200' : 'text-[#5a6a85]'}`}>
                {fmt12(session.start_time)} – {fmt12(session.end_time)}
              </p>
            </div>
            <p className={`text-[10px] font-medium ${active ? 'text-blue-200' : 'text-[#5a6a85]'}`}>
              {availableBarbers.length} barber{availableBarbers.length !== 1 ? 's' : ''} available
            </p>
          </button>
        )
      })}
    </div>
  )
}

// ─── Barber Picker ──────────────────────────────────────────────────────────────

function BarberPicker({
  session,
  barberMap,
  selectedBarber,
  requiredMinutes,
  onBarberSelect,
}: {
  session: Session
  barberMap: Map<string, Barber>
  selectedBarber: Barber | null
  requiredMinutes: number
  onBarberSelect: (b: Barber) => void
}) {
  if (session.barber_capacity.length === 0) {
    return (
      <p className="text-center text-xs text-[#5a6a85] py-4">
        No barbers available in this session.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {session.barber_capacity.map((bc) => {
        const barber = barberMap.get(bc.barber_id)
        if (!barber) return null
        const fits = bc.remaining_minutes >= requiredMinutes
        const active = selectedBarber?.id === barber.id
        return (
          <button
            key={bc.barber_id}
            disabled={!fits}
            onClick={() => onBarberSelect(barber)}
            className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl border text-left transition-all ${
              !fits
                ? 'bg-[#f4f6fb] border-[#e3eaf5] text-[#c0cbd8] cursor-not-allowed'
                : active
                ? 'bg-[#1565c0] border-[#1565c0] text-white'
                : 'bg-white border-[#e3eaf5] text-[#1a1a2e] hover:border-[#1565c0]'
            }`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
              active ? 'bg-white/20 text-white' : 'bg-[#e8f0fe] text-[#1565c0]'
            }`}>
              {barber.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold truncate ${active ? 'text-white' : 'text-[#1a1a2e]'}`}>
                {barber.name}
              </p>
              <p className={`text-[10px] ${active ? 'text-blue-200' : 'text-[#5a6a85]'}`}>
                {fits
                  ? `${bc.remaining_minutes} min left · ${bc.queue_depth} in queue`
                  : `Only ${bc.remaining_minutes} min left (need ${requiredMinutes} min)`}
                {!barber.is_available && fits && (
                  <span className={`ml-1 ${active ? 'text-orange-200' : 'text-[#e65100]'}`}>· May be unavailable</span>
                )}
              </p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── Partial Fit Modal ────────────────────────────────────────────────────────

function PartialFitModal({
  feasible,
  rejected,
  onConfirm,
  onDismiss,
}: {
  feasible: BookingService[]
  rejected: BookingService[]
  onConfirm: () => void
  onDismiss: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button className="absolute inset-0 bg-black/40" onClick={onDismiss} aria-label="Close" />
      <div className="relative bg-white rounded-t-2xl shadow-2xl w-full">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[#e3eaf5]" />
        </div>
        <div className="px-5 pb-6 pt-2">
          <h3 className="text-base font-bold text-[#1a1a2e] mb-2">Not enough capacity</h3>
          <p className="text-xs text-[#5a6a85] mb-4 leading-relaxed">
            The following services cannot fit in this session:
          </p>

          <div className="flex flex-col gap-2 mb-4">
            {rejected.map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-[#fce4e4] rounded-lg px-3 py-2">
                <span className="text-xs font-medium text-[#c62828]">{s.name}</span>
                <span className="text-[10px] text-[#c62828]">Not available</span>
              </div>
            ))}
            {feasible.map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-[#e8f5e9] rounded-lg px-3 py-2">
                <span className="text-xs font-medium text-[#2e7d32]">{s.name}</span>
                <span className="text-[10px] text-[#2e7d32]">{s.duration_minutes} min · can book</span>
              </div>
            ))}
          </div>

          {feasible.length > 0 ? (
            <>
              <p className="text-xs text-[#5a6a85] mb-4">
                Would you like to continue with {feasible.map((s) => s.name).join(', ')} only?
              </p>
              <button
                onClick={onConfirm}
                className="w-full bg-[#1565c0] hover:bg-[#0d47a1] text-white font-semibold text-sm rounded-xl py-3.5 transition-colors"
              >
                Continue with available services
              </button>
            </>
          ) : (
            <p className="text-xs text-[#5a6a85] mb-4">
              No services can fit in this session. Please choose a different session.
            </p>
          )}

          <button
            onClick={onDismiss}
            className="w-full mt-2 text-sm font-medium text-[#5a6a85] py-2.5"
          >
            {feasible.length > 0 ? 'Choose a different session' : 'Go back'}
          </button>
        </div>
      </div>
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
    <div className={`bg-white rounded-xl border ${muted ? 'border-[#e3eaf5] opacity-60' : 'border-[#e3eaf5]'}`}>
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

// ─── Confirm Modal ────────────────────────────────────────────────────────────

function ConfirmModal({
  saloonName,
  date,
  session,
  barber,
  selectedServices,
  loading,
  error,
  onConfirm,
  onClose,
}: {
  saloonName: string
  date: string
  session: Session
  barber: Barber
  selectedServices: Service[]
  loading: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  const totalMinutes = selectedServices.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0)

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-t-2xl shadow-2xl w-full">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[#e3eaf5]" />
        </div>
        <div className="px-5 pb-6 pt-2">
          <h3 className="text-base font-bold text-[#1a1a2e] mb-4">Confirm Booking</h3>

          <div className="flex flex-col gap-2.5 mb-5">
            <SummaryRow label="Salon" value={saloonName} />
            <SummaryRow label="Date" value={date} />
            <SummaryRow
              label="Session"
              value={`${SESSION_LABELS[session.label]} (${fmt12(session.start_time)} – ${fmt12(session.end_time)})`}
            />
            <SummaryRow label="Barber" value={barber.name} />
            {selectedServices.length > 0 && (
              <SummaryRow
                label="Services"
                value={`${selectedServices.map((s) => s.name).join(', ')} (${totalMinutes} min)`}
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
