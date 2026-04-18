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
