import { useEffect, useState } from 'react'
import { aiStatus, type AiStatus } from './ai'

/** Keep login and the shared understand/render slot current while the panel is open. */
export function useAiStatus() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  useEffect(() => {
    if (import.meta.env.PROD) return
    let alive = true
    let fetching = false
    const refresh = async () => {
      if (fetching) return
      fetching = true
      const next = await aiStatus()
      fetching = false
      if (alive) setStatus(next)
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2000)
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return status
}
