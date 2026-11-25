import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { Button } from './ui'

/**
 * One search-with-suggestions control for the header, the search page and the
 * service directory. Suggestions come from `/api/search/suggest`, which covers
 * services, categories, forms, service FAQs, offices and announcements.
 */
export function SearchAutocomplete({
  initialValue = '',
  onSubmit,
  inputId = 'global-search-input',
  label = 'Search public information',
  placeholder = 'Search services, categories, forms, FAQs and offices…',
  buttonLabel = 'Search',
  autoFocus = false,
  onNavigate,
}) {
  const navigate = useNavigate()
  const [term, setTerm] = useState(initialValue)
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const listId = `${inputId}-suggestions`

  useEffect(() => setTerm(initialValue), [initialValue])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    const value = term.trim()
    if (value.length < 2) {
      setSuggestions([])
      setLoading(false)
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search/suggest?q=${encodeURIComponent(value)}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (response.ok) {
          const data = await response.json()
          setSuggestions(data.suggestions || [])
        }
      } catch {
        /* aborted or offline: suggestions are optional */
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 200)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [term])

  useEffect(() => {
    const onClick = (event) => wrapRef.current && !wrapRef.current.contains(event.target) && setOpen(false)
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const items = useMemo(
    () => suggestions.map((item) => ({ kind: item.category, label: item.label, to: item.url, meta: item.meta })),
    [suggestions],
  )

  const choose = (item) => {
    setOpen(false)
    onNavigate?.(item)
    navigate(item.to)
  }

  const submit = (value = term) => {
    const trimmed = String(value || '').trim()
    if (trimmed.length < 2) return
    setOpen(false)
    onSubmit?.(trimmed)
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((current) => Math.min(items.length - 1, current + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(-1, current - 1))
    } else if (event.key === 'Enter' && open && active >= 0 && items[active]) {
      event.preventDefault()
      choose(items[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1, width: '100%' }}>
      <form
        role="search"
        className="search-box"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="search-field">
          <Search size={18} aria-hidden="true" style={{ color: 'var(--text-muted)', flex: 'none' }} />
          <label className="sr-only" htmlFor={inputId}>{label}</label>
          <input
            ref={inputRef}
            id={inputId}
            value={term}
            onChange={(event) => {
              setTerm(event.target.value)
              setOpen(true)
              setActive(-1)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            maxLength={120}
            autoComplete="off"
            role="combobox"
            aria-expanded={open && items.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
          />
          {term ? (
            <button type="button" className="btn-icon" onClick={() => setTerm('')} aria-label="Clear search">
              <X size={16} />
            </button>
          ) : null}
          <Button type="submit">{buttonLabel}</Button>
        </div>
      </form>
      {open && term.trim().length >= 2 ? (
        <div className="search-suggestions" id={listId} role="listbox" aria-label="Search suggestions">
          {loading && items.length === 0 ? <div className="dropdown-item text-sm text-muted">Searching…</div> : null}
          {!loading && items.length === 0 ? (
            <div className="dropdown-item text-sm text-muted">No suggestions. Press Enter to search everything.</div>
          ) : null}
          {items.map((item, index) => (
            <Link
              key={`${item.kind}-${item.to}-${index}`}
              to={item.to}
              role="option"
              aria-selected={active === index}
              className="search-suggestion"
              onMouseEnter={() => setActive(index)}
              onClick={(event) => {
                event.preventDefault()
                choose(item)
              }}
              style={active === index ? { background: 'var(--surface-2)' } : undefined}
            >
              <span className="badge badge-neutral">{item.kind}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.meta ? <span className="text-xs text-muted">{item.meta}</span> : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
