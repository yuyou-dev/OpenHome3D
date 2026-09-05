import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Native top-layer modal: background is inert, focus stays inside, Escape cancels. */
export default function PlanDialog({ title, label, onDismiss, children, actions, compact = false, className = '' }: {
  title: string
  label: string
  onDismiss: () => void
  children: ReactNode
  actions: ReactNode
  className?: string
  compact?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return createPortal(
    <dialog ref={ref} data-modal className={`plan-dialog${compact ? ' plan-dialog-compact' : ''} ${className}`}
      aria-label={label} aria-modal="true"
      onCancel={event => { event.preventDefault(); onDismiss() }}>
      <header className="plan-dialog-header"><h2 tabIndex={-1} autoFocus>{title}</h2></header>
      <div className="plan-dialog-body">{children}</div>
      <footer className="plan-dialog-actions">{actions}</footer>
    </dialog>, document.body,
  )
}
