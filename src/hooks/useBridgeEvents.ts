import { useEffect, useRef } from 'react'
import { actionBridge } from '../services/actionBridge'
import type { BridgeReminderEvent } from '../types/brain'

export interface BridgeTimerEvent {
  type: 'timer'
  id: number
  label: string
  kind: 'timer' | 'alarm'
}

interface Options {
  /** Called when a timer/alarm set through Jarvis fires. */
  onTimer: (event: BridgeTimerEvent) => void
  /** Called when a reminder from the second brain comes due. */
  onReminder?: (event: BridgeReminderEvent) => void
}

/**
 * Listens to the bridge's `/events` stream (Server-Sent Events). Reconnection is
 * handled by EventSource itself; when the bridge is down the stream just stays
 * silent, nothing else in the UI depends on it.
 */
export function useBridgeEvents({ onTimer, onReminder }: Options): void {
  const onTimerRef = useRef(onTimer)
  const onReminderRef = useRef(onReminder)
  useEffect(() => {
    onTimerRef.current = onTimer
    onReminderRef.current = onReminder
  }, [onTimer, onReminder])

  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const source = new EventSource(actionBridge.eventsUrl())
    source.addEventListener('timer', (ev) => {
      try {
        onTimerRef.current(JSON.parse((ev as MessageEvent<string>).data) as BridgeTimerEvent)
      } catch {
        /* malformed event: ignore */
      }
    })
    source.addEventListener('reminder', (ev) => {
      try {
        onReminderRef.current?.(JSON.parse((ev as MessageEvent<string>).data) as BridgeReminderEvent)
      } catch {
        /* malformed event: ignore */
      }
    })
    return () => source.close()
  }, [])
}
