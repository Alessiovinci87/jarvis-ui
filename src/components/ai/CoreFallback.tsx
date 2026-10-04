import { NODES } from '../../data/network'
import type { NodeId } from '../../types/ai'

interface CoreFallbackProps {
  activeNodes: ReadonlySet<NodeId>
}

/** Pure-CSS version shown when WebGL is unavailable. */
export function CoreFallback({ activeNodes }: CoreFallbackProps) {
  return (
    <div className="fallback" role="img" aria-label="Jarvis core">
      <div className="fallback__ring fallback__ring--a" />
      <div className="fallback__ring fallback__ring--b" />
      <div className="fallback__ring fallback__ring--c" />
      <div className="fallback__core" />
      {NODES.map((n) => {
        const [x, y] = n.position
        const cls = activeNodes.has(n.id) ? 'fallback__node fallback__node--active' : 'fallback__node'
        return (
          <span
            key={n.id}
            className={cls}
            style={{ left: `calc(50% + ${x * 9}vmin)`, top: `calc(50% - ${y * 9}vmin)` }}
          >
            {n.label}
          </span>
        )
      })}
    </div>
  )
}
