import { useEffect, useState } from 'react'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Button, useToast } from './ui'

/**
 * One bookmark control for every saveable public record (Prompt 63).
 * Saving is always for the signed-in citizen; signed-out visitors are pointed
 * at sign-in instead of being given a control that cannot work.
 */
export default function SaveButton({ contentType, slug, contentId, size = 'sm', label = 'Save' }) {
  const { user } = useAuth()
  const toast = useToast()
  const [saved, setSaved] = useState(false)
  const [resolvedId, setResolvedId] = useState(contentId || null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return undefined
    let active = true
    const query = new URLSearchParams({ contentType, ...(slug ? { slug } : { contentId: String(contentId) }) })
    api.get(`/account/saved/status?${query.toString()}`)
      .then((result) => {
        if (!active) return
        setSaved(Boolean(result.saved))
        if (result.contentId) setResolvedId(result.contentId)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [user, contentType, slug, contentId])

  if (!user) return null

  const toggle = async () => {
    setBusy(true)
    try {
      if (saved) {
        await api.del(`/account/saved/${contentType}/${resolvedId}`)
        setSaved(false)
        toast.push('Removed from your saved items.')
      } else {
        const result = await api.post('/account/saved', { contentType, ...(resolvedId ? { contentId: resolvedId } : { slug }) })
        setSaved(true)
        if (result.contentId) setResolvedId(result.contentId)
        toast.push('Saved to your private list.')
      }
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant={saved ? 'primary' : 'outline'}
      size={size}
      icon={saved ? BookmarkCheck : Bookmark}
      onClick={toggle}
      loading={busy}
      aria-pressed={saved}
    >
      {saved ? 'Saved' : label}
    </Button>
  )
}
