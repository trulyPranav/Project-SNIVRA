import Image from 'next/image'
import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-[#e3eaf5] bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Image
            src="/snivra.jpeg"
            alt="SNIVRA"
            width={32}
            height={32}
            className="rounded-lg object-cover"
          />
          <span className="text-[#1565c0] font-semibold text-base tracking-wide">SNIVRA</span>
        </div>
        <Link
          href="/login"
          className="text-sm font-medium text-[#1565c0] border border-[#1565c0] rounded-lg px-4 py-1.5 hover:bg-[#1565c0] hover:text-white transition-colors"
        >
          Sign In
        </Link>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-10 pb-8 bg-[#f4f6fb]">
        <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-md mb-5">
          <Image
            src="/snivra.jpeg"
            alt="SNIVRA Logo"
            width={80}
            height={80}
            className="object-cover w-full h-full"
            priority
          />
        </div>
        <h1 className="text-2xl font-bold text-[#1a1a2e] leading-tight mb-2">
          Your Next Great Cut,<br />One Tap Away
        </h1>
        <p className="text-sm text-[#5a6a85] leading-relaxed max-w-xs mb-6">
          Discover nearby salons, book a seat instantly, and show up on time — no calls, no waiting.
        </p>
        <Link
          href="/login"
          className="w-full max-w-xs flex items-center justify-center gap-2 bg-[#1565c0] hover:bg-[#0d47a1] active:bg-[#0d47a1] text-white font-semibold text-sm rounded-xl py-3 shadow transition-colors"
        >
          Get Started
        </Link>
      </section>

      {/* Features */}
      <section className="flex flex-col gap-3 px-4 py-6">
        <FeatureCard
          icon={<LocationIcon />}
          title="Find Nearby Salons"
          desc="Discover top-rated barbers and salons around you in seconds."
        />
        <FeatureCard
          icon={<CalendarIcon />}
          title="Instant Booking"
          desc="Pick your seat and time slot, confirm in one tap — no back and forth."
        />
        <FeatureCard
          icon={<CheckIcon />}
          title="Seamless Check-In"
          desc="Arrive, show your OTP, and you're in the chair. Simple as that."
        />
      </section>

      {/* Footer CTA */}
      <section className="mt-auto px-4 pb-8 pt-4">
        <div className="rounded-2xl bg-[#1565c0] p-5 text-center">
          <p className="text-white font-semibold text-base mb-1">Ready to book?</p>
          <p className="text-blue-200 text-xs mb-4">Sign in with Google in seconds.</p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center bg-white text-[#1565c0] font-semibold text-sm rounded-xl px-8 py-2.5 shadow hover:bg-blue-50 transition-colors"
          >
            Sign In Now
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="text-center py-4 text-xs text-[#5a6a85] border-t border-[#e3eaf5]">
        © {new Date().getFullYear()} SNIVRA. All rights reserved.
      </footer>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <div className="flex items-start gap-3 bg-white rounded-xl border border-[#e3eaf5] p-4 shadow-sm">
      <div className="shrink-0 w-9 h-9 rounded-lg bg-[#e8f0fe] flex items-center justify-center text-[#1565c0]">
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-[#1a1a2e]">{title}</h3>
        <p className="text-xs text-[#5a6a85] mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  )
}

function LocationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}
