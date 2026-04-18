import { saveWebSubscription } from './api'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
const SW_PATH = '/sw.js'
// LocalStorage key: set once the browser subscription is saved to the server
const SUBSCRIBED_KEY = 'snivra_push_subscribed'
// LocalStorage key: set when the user explicitly dismisses the prompt
const PROMPT_DISMISSED_KEY = 'snivra_push_dismissed'

/**
 * Returns true when the in-app notification prompt should be shown.
 * False if: already subscribed, user dismissed before, browser unsupported, or
 * the OS/browser permission is already 'denied'.
 */
export function shouldShowNotificationPrompt(): boolean {
  if (typeof window === 'undefined') return false
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  if (!VAPID_PUBLIC_KEY) return false
  if (localStorage.getItem(SUBSCRIBED_KEY) === '1') return false
  if (localStorage.getItem(PROMPT_DISMISSED_KEY) === '1') return false
  if (Notification.permission === 'denied') return false
  return true
}

/** Call when the user clicks "Not now" on the in-app prompt. */
export function dismissNotificationPrompt(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(PROMPT_DISMISSED_KEY, '1')
  }
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i)
  }
  return output.buffer as ArrayBuffer
}

/**
 * Register the service worker, request notification permission, subscribe to
 * Web Push, and POST the subscription to the SNIVRA backend.
 *
 * Safe to call multiple times — skips silently if already subscribed this
 * session, permission is denied, or the environment doesn't support push.
 *
 * @returns 'subscribed' | 'already_subscribed' | 'denied' | 'unsupported' | 'error'
 */
export async function registerPushNotifications(
  token: string
): Promise<'subscribed' | 'already_subscribed' | 'denied' | 'unsupported' | 'error'> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !VAPID_PUBLIC_KEY
  ) {
    return 'unsupported'
  }

  // Don't pester the user on every page load — if we already subscribed this
  // browser instance, skip silently.
  if (localStorage.getItem(SUBSCRIBED_KEY) === '1') {
    return 'already_subscribed'
  }

  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return 'denied'
    }

    const registration = await navigator.serviceWorker.register(SW_PATH, { scope: '/' })
    // Wait for the SW to become active before subscribing
    await navigator.serviceWorker.ready

    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    let subscription = await registration.pushManager.getSubscription()

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })
    }

    await saveWebSubscription(subscription.toJSON(), token)
    localStorage.setItem(SUBSCRIBED_KEY, '1')
    return 'subscribed'
  } catch (err) {
    console.error('[SNIVRA push]', err)
    return 'error'
  }
}
