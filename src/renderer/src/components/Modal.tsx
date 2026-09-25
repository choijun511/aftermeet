import React, { useEffect, useRef } from 'react'

export default function Modal({ label, onClose, children }: {
  label: string; onClose: () => void; children: React.ReactNode
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    root.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return <div className="modal" role="dialog" aria-modal="true" aria-label={label} ref={root} tabIndex={-1}
    onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key !== 'Tab') return
      const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')]
        .filter((el) => el.getClientRects().length > 0)
      const first = controls[0]; const last = controls[controls.length - 1]
      if (!first) { e.preventDefault(); root.current?.focus(); return }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { e.preventDefault(); first.focus() }
    }}>{children}</div>
}
