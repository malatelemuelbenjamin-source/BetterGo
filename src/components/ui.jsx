import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  Loader2,
  X,
} from 'lucide-react'
import { STATUS_LABELS, VERIFICATION_LABELS } from '../api'

/* --------------------------------- Button -------------------------------- */
export function Button({ variant = 'primary', size, loading, icon: Icon, children, className = '', ...props }) {
  const classes = ['btn', `btn-${variant}`, size ? `btn-${size}` : '', className].filter(Boolean).join(' ')
  return (
    <button className={classes} disabled={props.disabled || loading} {...props}>
      {loading ? <span className="spin" aria-hidden="true" /> : Icon ? <Icon size={16} aria-hidden="true" /> : null}
      {children}
    </button>
  )
}

/* -------------------------------- Feedback ------------------------------- */
export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="spin" aria-hidden="true" /> <span>{label}</span>
    </div>
  )
}

export function Alert({ tone = 'info', title, children, action }) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'success' ? CheckCircle2 : tone === 'warning' ? AlertCircle : Info
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        {title ? <strong style={{ display: 'block' }}>{title}</strong> : null}
        {children}
        {action}
      </div>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="empty-state">
      {Icon ? (
        <div className="empty-icon" aria-hidden="true">
          <Icon size={24} />
        </div>
      ) : null}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  )
}

export function SkeletonList({ count = 3, height = 120 }) {
  return (
    <div className="grid grid-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="skeleton" style={{ height }} />
      ))}
    </div>
  )
}

/* --------------------------------- Badges -------------------------------- */
export function Badge({ tone = 'neutral', children, icon: Icon }) {
  return (
    <span className={`badge badge-${tone}`}>
      {Icon ? <Icon size={12} aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

export function StatusBadge({ status }) {
  const meta = STATUS_LABELS[status] || { label: status || 'Unknown', tone: 'neutral' }
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}

export function VerificationBadge({ status }) {
  const meta = VERIFICATION_LABELS[status] || { label: status || 'Unknown', tone: 'neutral' }
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}

/* ---------------------------------- Form --------------------------------- */
export function Field({ label, htmlFor, required, help, error, children, className = '' }) {
  const fallbackId = useId()
  const id = htmlFor || fallbackId
  return (
    <div className={`field ${className}`}>
      {label ? (
        <label className="label" htmlFor={id}>
          {label} {required ? <span className="req" aria-hidden="true">*</span> : null}
          {required ? <span className="sr-only">(required)</span> : null}
        </label>
      ) : null}
      {typeof children === 'function' ? children({ id, invalid: Boolean(error) }) : children}
      {help ? <span className="help">{help}</span> : null}
      {error ? (
        <span className="error-text" role="alert">
          <AlertCircle size={12} aria-hidden="true" /> {error}
        </span>
      ) : null}
    </div>
  )
}

export function Input({ id, invalid, className = '', ...props }) {
  return <input id={id} className={`input ${className}`} aria-invalid={invalid || undefined} {...props} />
}

export function Select({ id, invalid, children, className = '', ...props }) {
  return (
    <select id={id} className={`select ${className}`} aria-invalid={invalid || undefined} {...props}>
      {children}
    </select>
  )
}

export function Textarea({ id, invalid, className = '', ...props }) {
  return <textarea id={id} className={`textarea ${className}`} aria-invalid={invalid || undefined} {...props} />
}

export function PasswordInput({ id, invalid, ...props }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="password-wrap">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        className="input"
        aria-invalid={invalid || undefined}
        {...props}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  )
}

export function Checkbox({ id, label, description, ...props }) {
  return (
    <div className="checkbox-row">
      <input id={id} type="checkbox" {...props} />
      <label htmlFor={id}>
        <span>{label}</span>
        {description ? <span className="help" style={{ display: 'block' }}>{description}</span> : null}
      </label>
    </div>
  )
}

/* ------------------------------- Pagination ------------------------------ */
export function Pagination({ page, totalPages, onChange }) {
  if (!totalPages || totalPages <= 1) return null
  const pages = []
  const start = Math.max(1, page - 2)
  const end = Math.min(totalPages, start + 4)
  for (let index = Math.max(1, Math.min(start, totalPages - 4)); index <= end; index += 1) pages.push(index)
  return (
    <nav className="pagination" aria-label="Pagination">
      <button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Previous page">Previous</button>
      {pages.map((p) => (
        <button key={p} type="button" onClick={() => onChange(p)} aria-current={p === page ? 'page' : undefined} aria-label={`Page ${p}`}>
          {p}
        </button>
      ))}
      <button type="button" onClick={() => onChange(page + 1)} disabled={page >= totalPages} aria-label="Next page">Next</button>
      <span className="text-xs text-muted" style={{ marginLeft: '0.35rem' }}>Page {page} of {totalPages}</span>
    </nav>
  )
}

/* --------------------------------- Modal --------------------------------- */
export function Modal({ open, onClose, title, children, actions, wide }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={ref}
        style={wide ? { width: 'min(940px, 100%)' } : undefined}
      >
        <div className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        {children}
        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', tone = 'danger', onConfirm, onClose, busy }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      actions={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-muted">{message}</p>
    </Modal>
  )
}

/* --------------------------------- Toasts -------------------------------- */
const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((message, tone = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((current) => [...current, { id, message, tone }])
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6000)
  }, [])
  const value = { push }
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            {toast.tone === 'error' ? <AlertCircle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) return { push: () => {} }
  return context
}

/* ---------------------------------- Tabs --------------------------------- */
export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          className="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function LoadingButton({ loading, children, ...props }) {
  return (
    <Button loading={loading} {...props}>
      {children}
    </Button>
  )
}

export function IconSpinner() {
  return <Loader2 size={16} className="spin" aria-hidden="true" />
}
