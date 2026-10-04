import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MEMORY_CONTEXT_HEADER, SYSTEM_PROMPT } from '../data/systemPrompt'
import { actionBridge, sequenceReply } from '../services/actionBridge'
import {
  confirmationReply,
  describeIntent,
  isAffirmative,
  isNegative,
  resolveFollowUp,
  routeCommand,
  type RoutedCommand,
} from '../services/commandRouter'
import { openJarvisApi, OpenJarvisApiError } from '../services/openJarvisApi'
import { BRAIN_CHANGED_EVENT, type BrainOutcome } from '../types/brain'
import type { ActionIntent } from '../types/actions'
import { PHASE_NODES, type ActivityEvent, type AiActivityState, type AiPhase, type NodeId } from '../types/ai'
import type { ChatRequestMessage, ConversationMessage } from '../types/chat'
import type { MemoryHit } from '../types/memory'
import type { MemoryController } from './useMemory'

/** How long RESPONSE / ERROR stay lit before the core returns to IDLE. */
const SETTLE_MS = 2500
/** How long MEMORY stays lit after an explicit store. */
const STORE_SETTLE_MS = 1800
/** How many past turns are sent back as context. */
const HISTORY_LIMIT = 12
const MAX_EVENTS = 8
/** How long a model-proposed desktop intent waits for the user's "sì". */
const CONFIRM_WINDOW_MS = 60_000
/** How long the previous desktop command stays relevant for corrections ("no, la cartella Ale"). */
const CONTEXT_WINDOW_MS = 3 * 60_000

interface UseConversationOptions {
  /** Model id to request. */
  model: string
  /** Whether the backend is reachable; sending is refused otherwise. */
  online: boolean
  /** Invoked when an assistant turn completes (status 'done') or fails (status 'error'). */
  onReply?: (message: ConversationMessage) => void
  /** Personal memory: explicit store + retrieval before each question. Optional. */
  memory?: MemoryController | null
}

export interface ConversationState {
  messages: ConversationMessage[]
  /** True while a request is in flight. */
  busy: boolean
  /** True while the real request/response/error should drive the visuals. */
  live: boolean
  /** Visual state derived from the real request lifecycle. */
  activity: AiActivityState
  send: (text: string) => void
  /** Proactive line from Jarvis (timer fired, …): shown in the log and spoken. */
  announce: (text: string, node?: NodeId) => void
}

function buildMemoryContext(hits: MemoryHit[]): string {
  const lines = hits.map((h, i) => `${i + 1}. ${h.content.replace(/\s+/g, ' ').trim()}`)
  return `${MEMORY_CONTEXT_HEADER}\n${lines.join('\n')}`
}

export function useConversation({ model, online, onReply, memory }: UseConversationOptions): ConversationState {
  const onReplyRef = useRef(onReply)
  useEffect(() => {
    onReplyRef.current = onReply
  }, [onReply])
  const memoryRef = useRef(memory)
  useEffect(() => {
    memoryRef.current = memory
  }, [memory])

  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const messagesRef = useRef<ConversationMessage[]>([])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  const [phase, setPhase] = useState<AiPhase>('IDLE')
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [busy, setBusy] = useState(false)
  const nextId = useRef(1)
  const settleTimer = useRef<number | undefined>(undefined)
  /** Intent proposed by the model and waiting for an explicit "sì". Expires. */
  const pendingIntent = useRef<{ intent: ActionIntent; expires: number } | null>(null)
  /** Last desktop command that ran (or was proposed): lets "nooo, la cartella Ale" be read as a correction. */
  const lastIntent = useRef<{ intent: ActionIntent; at: number } | null>(null)

  const pushEvent = useCallback((message: string, node: NodeId | null) => {
    setEvents((prev) => {
      const event: ActivityEvent = {
        id: nextId.current++,
        timestamp: Date.now(),
        message,
        node,
      }
      return [event, ...prev].slice(0, MAX_EVENTS)
    })
  }, [])

  const settle = useCallback((to: AiPhase, ms = SETTLE_MS) => {
    setPhase(to)
    window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => setPhase('IDLE'), ms)
  }, [])

  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  /**
   * Second brain first: notes, facts, reminders, lists and memory questions are
   * understood and stored by the bridge (deterministic rules, local model only to
   * extract a structure). Resolves to the outcome, or null when the bridge is not
   * reachable / the sentence is not for the brain, so the caller can move on.
   */
  const askBrain = useCallback(
    async (text: string): Promise<BrainOutcome | null> => {
      const mem = memoryRef.current
      if (mem && mem.status.status === 'unavailable') return null
      try {
        const out = await actionBridge.brain(text, true)
        if (!out.handled) return null
        pushEvent(`brain: ${out.kind}/${out.op}${out.source === 'model' ? ' (model)' : ''}`, 'MEMORY')
        if (out.op === 'add' || out.op === 'remove' || out.op === 'clear' || out.op === 'cancel' || out.op === 'done') {
          void mem?.refresh()
          // HUD (OGGI) and the Memoria drawer refresh right away, not at the next poll.
          window.dispatchEvent(new CustomEvent(BRAIN_CHANGED_EVENT, { detail: { kind: out.kind, op: out.op } }))
        }
        return out
      } catch {
        return null
      }
    },
    [pushEvent],
  )

  /** Reply from the brain: shown, spoken, lights MEMORY. No model, no OpenJarvis. */
  const finishBrain = useCallback(
    (userMessage: ConversationMessage, out: BrainOutcome) => {
      const reply: ConversationMessage = {
        id: nextId.current++,
        role: 'assistant',
        content: out.reply,
        timestamp: Date.now(),
        status: 'done',
      }
      setMessages((prev) => [...prev, userMessage, reply])
      settle(out.op === 'add' ? 'MEMORY_STORE' : 'MEMORY', out.op === 'add' ? STORE_SETTLE_MS : SETTLE_MS)
      onReplyRef.current?.(reply)
    },
    [settle],
  )

  /**
   * Ordinary conversation turn. `pending` must already be in the message list.
   * Memory retrieval → system prompt → OpenJarvis chat → reply (spoken for voice turns).
   */
  const runChat = useCallback(
    async (userMessage: ConversationMessage, pending: ConversationMessage) => {
      const text = userMessage.content
      setBusy(true)
      window.clearTimeout(settleTimer.current)
      // History sent to the backend: prior completed turns + the new user line.
      const history: ChatRequestMessage[] = [...messagesRef.current.filter((m) => m.id !== pending.id), userMessage]
        .filter((m) => m.status !== 'pending' && m.status !== 'error')
        .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i)
        .slice(-HISTORY_LIMIT)
        .map((m) => ({ role: m.role, content: m.content }))
      const mem = memoryRef.current
      const canRetrieve = !!mem && mem.status.status === 'available'
      try {
        // 1) Memory retrieval (only when the backend memory is available).
        let hits: MemoryHit[] = []
        if (canRetrieve && mem) {
          setPhase('MEMORY')
          pushEvent('memory retrieval', 'MEMORY')
          hits = await mem.retrieve(text)
          pushEvent(
            hits.length > 0 ? `memory: ${hits.length} match${hits.length > 1 ? 'es' : ''}` : 'memory: no match',
            'MEMORY',
          )
        }
        // 2) Reasoning: SYSTEM → MEMORY CONTEXT → conversation.
        setPhase('REASONING')
        pushEvent('processing request', 'REASONING')
        const payload: ChatRequestMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]
        if (hits.length > 0) payload.push({ role: 'system', content: buildMemoryContext(hits) })
        payload.push(...history)

        const res = await openJarvisApi.sendChatMessage(payload, { model })
        const choice = res.choices[0]
        const content = choice?.message.content?.trim() ?? ''
        const reply: ConversationMessage = {
          ...pending,
          content: content || '(empty response)',
          timestamp: Date.now(),
          status: 'done',
          usage: res.usage,
        }
        setMessages((prev) => prev.map((m) => (m.id === pending.id ? reply : m)))
        onReplyRef.current?.(reply)
        const tokens = res.usage && res.usage.completion_tokens > 0 ? ` (${res.usage.completion_tokens} tok)` : ''
        pushEvent(`response generated${tokens}`, 'VOICE')
        settle('RESPONSE')
      } catch (err: unknown) {
        const detail =
          err instanceof OpenJarvisApiError ? (err.status ? `error ${err.status}` : 'request failed') : 'request failed'
        const message = err instanceof Error ? err.message : String(err)
        const failed: ConversationMessage = { ...pending, content: message, timestamp: Date.now(), status: 'error' }
        setMessages((prev) => prev.map((m) => (m.id === pending.id ? failed : m)))
        onReplyRef.current?.(failed)
        pushEvent(detail, 'SYSTEM')
        settle('ERROR')
      } finally {
        setBusy(false)
      }
    },
    [model, pushEvent, settle],
  )

  /**
   * Desktop command path (VOICE/TEXT → router → TOOLS → bridge → reply).
   * Deterministic matches never call the model. A `maybe` asks the model for a
   * structured intent from the closed list; whatever comes back is re-validated.
   */
  const runCommand = useCallback(
    async (
      userMessage: ConversationMessage,
      routed: Exclude<RoutedCommand, { kind: 'none' }> | { kind: 'confirmed'; intent: ActionIntent },
    ) => {
      const ackId = nextId.current++
      const pending: ConversationMessage = {
        id: ackId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        status: 'pending',
      }
      setMessages((prev) => [...prev, userMessage, pending])
      setBusy(true)
      window.clearTimeout(settleTimer.current)

      const finish = (content: string, status: 'done' | 'error', phase: AiPhase, ms = SETTLE_MS) => {
        const reply: ConversationMessage = { ...pending, content, timestamp: Date.now(), status }
        setMessages((prev) => prev.map((m) => (m.id === ackId ? reply : m)))
        setBusy(false)
        settle(phase, ms)
        onReplyRef.current?.(reply)
      }

      if (routed.kind === 'refused') {
        pushEvent(`command refused: ${routed.reason}`, 'SYSTEM')
        finish(routed.reply, 'done', 'ERROR')
        return
      }

      let intents: ActionIntent[]
      if (routed.kind === 'action') {
        pushEvent('command recognized', 'REASONING')
        intents = [routed.intent]
      } else if (routed.kind === 'sequence') {
        pushEvent(`command recognized: ${routed.intents.length} steps`, 'REASONING')
        intents = routed.intents
      } else if (routed.kind === 'confirmed') {
        pushEvent('command confirmed', 'REASONING')
        intents = [routed.intent]
      } else {
        // Free-form phrasing: the bridge's classifier (Ollama direct, compact prompt) picks
        // one allowlisted intent. Whatever it proposes is *always* read back and waits for
        // the user's "sì": the model understands, Alessio decides, the bridge acts.
        setPhase('REASONING')
        pushEvent('interpreting command', 'REASONING')
        let proposed: ActionIntent | null = null
        try {
          const last = lastIntent.current
          const context = last && Date.now() - last.at < CONTEXT_WINDOW_MS ? describeIntent(last.intent) : null
          const res = await actionBridge.intent(routed.text, context ? `${context.tool} ${context.target}` : undefined)
          proposed = res.intent
          pushEvent(`classifier: ${res.model} (${res.seconds}s)`, 'REASONING')
        } catch {
          proposed = null
        }
        if (!proposed) {
          // Not a desktop command after all: answer it as conversation.
          pushEvent('no matching command: chat', 'REASONING')
          await runChat(userMessage, pending)
          return
        }
        pendingIntent.current = { intent: proposed, expires: Date.now() + CONFIRM_WINDOW_MS }
        lastIntent.current = { intent: proposed, at: Date.now() }
        pushEvent(`proposed: ${proposed.action} ${proposed.target} (awaiting confirmation)`, 'REASONING')
        finish(confirmationReply(proposed), 'done', 'RESPONSE')
        return
      }

      setPhase('TOOLS')
      lastIntent.current = { intent: intents[intents.length - 1], at: Date.now() }
      const replies: string[] = []
      let allOk = true
      for (const intent of intents) {
        const { tool, target } = describeIntent(intent)
        pushEvent(`tool: ${tool}`, 'TOOLS')
        pushEvent(`target: ${target}`, 'TOOLS')
        const outcome = await actionBridge.run(intent)
        pushEvent(outcome.ok ? 'action completed' : `action failed: ${outcome.code ?? 'error'}`, outcome.ok ? 'TOOLS' : 'SYSTEM')
        replies.push(outcome.reply)
        if (!outcome.ok) {
          allOk = false
          break // do not continue a chain after a failed step
        }
      }
      const reply = replies.length > 1 ? sequenceReply(replies) : (replies[0] ?? 'Fatto.')
      finish(reply, allOk ? 'done' : 'error', allOk ? 'RESPONSE' : 'ERROR')
    },
    [pushEvent, settle, runChat],
  )

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text || busy) return

      const now = Date.now()
      const userMessage: ConversationMessage = {
        id: nextId.current++,
        role: 'user',
        content: text,
        timestamp: now,
        status: 'done',
      }

      // A model-proposed intent waits for an explicit yes; anything else drops it.
      const awaiting = pendingIntent.current
      pendingIntent.current = null
      if (awaiting && awaiting.expires > Date.now()) {
        if (isAffirmative(text)) {
          void runCommand(userMessage, { kind: 'confirmed', intent: awaiting.intent })
          return
        }
        if (isNegative(text)) {
          pushEvent('command cancelled', 'SYSTEM')
          const reply: ConversationMessage = {
            id: nextId.current++,
            role: 'assistant',
            content: 'Ok, lasciamo stare.',
            timestamp: Date.now(),
            status: 'done',
          }
          setMessages((prev) => [...prev, userMessage, reply])
          settle('RESPONSE')
          onReplyRef.current?.(reply)
          return
        }
      }

      // Correction of the previous desktop command ("nooo, la cartella Ale"): same action, new target.
      const last = lastIntent.current
      if (last && Date.now() - last.at < CONTEXT_WINDOW_MS) {
        const fixed = resolveFollowUp(text, last.intent)
        if (fixed) {
          pushEvent('correction understood', 'REASONING')
          void runCommand(userMessage, { kind: 'action', intent: fixed, matched: text })
          return
        }
      }

      // Order: second brain (notes/reminders/lists/memory) → desktop commands → chat.
      // Hard refusals from the deny-list come first regardless: they must never reach anything.
      const routed = routeCommand(text)
      if (routed.kind === 'refused') {
        void runCommand(userMessage, routed)
        return
      }

      const dispatch = async () => {
        // Deterministic desktop commands are instant and unambiguous: run them straight away.
        if (routed.kind === 'action' || routed.kind === 'sequence') {
          await runCommand(userMessage, routed)
          return
        }
        setBusy(true)
        setPhase('MEMORY')
        const brain = await askBrain(text)
        setBusy(false)
        if (brain) {
          finishBrain(userMessage, brain)
          return
        }
        if (routed.kind !== 'none') {
          await runCommand(userMessage, routed)
          return
        }
        if (!online) {
          pushEvent('backend offline: request not sent', 'SYSTEM')
          const reply: ConversationMessage = {
            id: nextId.current++,
            role: 'assistant',
            content: 'Il modello non è raggiungibile adesso. Appunti, promemoria e liste funzionano comunque.',
            timestamp: Date.now(),
            status: 'error',
          }
          setMessages((prev) => [...prev, userMessage, reply])
          settle('ERROR')
          onReplyRef.current?.(reply)
          return
        }
        const pending: ConversationMessage = {
          id: nextId.current++,
          role: 'assistant',
          content: '',
          timestamp: now,
          status: 'pending',
        }
        setMessages((prev) => [...prev, userMessage, pending])
        await runChat(userMessage, pending)
      }
      void dispatch()
    },
    [busy, online, pushEvent, settle, askBrain, finishBrain, runCommand, runChat],
  )

  const announce = useCallback(
    (text: string, node: NodeId = 'TOOLS') => {
      const reply: ConversationMessage = {
        id: nextId.current++,
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
        status: 'done',
      }
      setMessages((prev) => [...prev, reply])
      pushEvent('proactive: announcement', node)
      settle('RESPONSE')
      onReplyRef.current?.({ ...reply, proactive: true })
    },
    [pushEvent, settle],
  )

  const activity = useMemo<AiActivityState>(
    () => ({ phase, activeNodes: new Set<NodeId>(PHASE_NODES[phase]), events }),
    [phase, events],
  )

  return { messages, busy, live: phase !== 'IDLE', activity, send, announce }
}
