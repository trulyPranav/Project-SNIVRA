// SNIVRA Service Worker — Web Push handler — v2

self.addEventListener('install', (event) => {
  // Force this SW version to become active immediately, replacing any old version
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  console.log('[SNIVRA SW] push received', event)

  let title = 'SNIVRA'
  let body = ''
  let url = '/dashboard'

  if (event.data) {
    try {
      const payload = event.data.json()
      console.log('[SNIVRA SW] push payload', payload)

      // Support both flat { title, body, url } and nested { notification: { title, body } }
      if (payload.notification) {
        title = payload.notification.title || title
        body  = payload.notification.body  || body
        url   = payload.notification.url   || payload.url || url
      } else {
        title = payload.title || title
        body  = payload.body  || body
        url   = payload.url   || url
      }
    } catch {
      // Plaintext payload
      body = event.data.text()
    }
  }

  const options = {
    body,
    icon: '/snivra.jpeg',
    badge: '/snivra.jpeg',
    data: { url },
    vibrate: [200, 100, 200],
    requireInteraction: false,
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
      .then(() => console.log('[SNIVRA SW] showNotification OK'))
      .catch((err) => {
        console.error('[SNIVRA SW] showNotification failed', err)
      })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/dashboard'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})

