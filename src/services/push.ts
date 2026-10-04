/**
 * Web Push subscription for this device (phone or PC browser where Jarvis is open/installed).
 * Needs a secure context (https over the tailnet, or localhost) and notification permission.
 */

import { BRIDGE_BASE_URL } from './actionBridge'

export type PushState = 'unsupported' | 'insecure' | 'denied' | 'off' | 'on'

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  if (!window.isSecureContext) return 'insecure'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

function deviceLabel(): string {
  const ua = navigator.userAgent
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'altro'
  return `${os} · ${new Date().toLocaleDateString('it-IT')}`
}

/** Asks permission, subscribes this browser and registers the subscription with the bridge. */
export async function enablePush(): Promise<PushState> {
  const state = await pushState()
  if (state === 'unsupported' || state === 'insecure' || state === 'denied') return state
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const reg = await navigator.serviceWorker.ready
  const keyRes = await fetch(`${BRIDGE_BASE_URL}/push/public-key`)
  if (!keyRes.ok) throw new Error('bridge: chiave push non disponibile')
  const { public_key } = (await keyRes.json()) as { public_key: string }
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(public_key) }))
  const json = sub.toJSON()
  const res = await fetch(`${BRIDGE_BASE_URL}/push/subscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, label: deviceLabel() }),
  })
  if (!res.ok) throw new Error(`bridge: iscrizione rifiutata (${res.status})`)
  return 'on'
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await fetch(`${BRIDGE_BASE_URL}/push/unsubscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined)
    await sub.unsubscribe()
  }
  return 'off'
}

export async function testPush(): Promise<number> {
  const res = await fetch(`${BRIDGE_BASE_URL}/push/test`, { method: 'POST' })
  const data = (await res.json()) as { sent: number }
  return data.sent
}
