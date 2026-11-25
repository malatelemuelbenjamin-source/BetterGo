import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

/** Fetch JSON from the API with loading, error and reload state. */
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, loading: Boolean(path), error: null })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null })
      return undefined
    }
    let active = true
    setState((current) => ({ ...current, loading: true, error: null }))
    api
      .get(path)
      .then((data) => active && setState({ data, loading: false, error: null }))
      .catch((error) => active && setState({ data: null, loading: false, error }))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  return { ...state, reload }
}

export function useSeo({ title, description, noindex = false, canonical }) {
  useEffect(() => {
    if (title) document.title = `${title} | BetterGo Marinduque`
    const ensure = (selector, create) => {
      let element = document.head.querySelector(selector)
      if (!element) {
        element = create()
        document.head.appendChild(element)
      }
      return element
    }
    if (description) {
      ensure('meta[name="description"]', () => {
        const meta = document.createElement('meta')
        meta.setAttribute('name', 'description')
        return meta
      }).setAttribute('content', description.slice(0, 300))
    }
    ensure('meta[name="robots"]', () => {
      const meta = document.createElement('meta')
      meta.setAttribute('name', 'robots')
      return meta
    }).setAttribute('content', noindex ? 'noindex, nofollow' : 'index, follow')
    const href = canonical || `${window.location.origin}${window.location.pathname}`
    ensure('link[rel="canonical"]', () => {
      const link = document.createElement('link')
      link.setAttribute('rel', 'canonical')
      return link
    }).setAttribute('href', href)
    let og = document.head.querySelector('meta[property="og:title"]')
    if (!og) {
      og = document.createElement('meta')
      og.setAttribute('property', 'og:title')
      document.head.appendChild(og)
    }
    og.setAttribute('content', title ? `${title} | BetterGo Marinduque` : 'BetterGo Marinduque')
    return () => {
      if (title) document.title = 'BetterGo Marinduque | Public Information, Services and Transparency'
    }
  }, [title, description, noindex, canonical])
}

export function useDocumentTitle(title) {
  useEffect(() => {
    if (!title) return
    document.title = `${title} | BetterGo Marinduque`
    return () => {
      document.title = 'BetterGo Marinduque | Public Information, Services and Transparency'
    }
  }, [title])
}

/** Debounce a value, used for live search suggestions. */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
