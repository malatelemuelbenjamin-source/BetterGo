import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderPlus, Trash2, Pencil, ArrowUp, ArrowDown } from 'lucide-react'
import { api } from '../api'
import { Alert, Badge, Button, EmptyState, Field, Input, Modal, Select, SkeletonList, Textarea, useToast } from './ui'

const ICONS = ['folder', 'briefcase', 'home', 'education', 'health', 'travel', 'alert', 'document']

/**
 * Private named collections of saved public records (Prompt 63).
 * All reads and writes are owner-scoped by the API.
 */
export default function CollectionsPanel() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', description: '', icon: 'folder' })
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      setData(await api.get('/account/collections'))
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      if (editing) {
        await api.patch(`/account/collections/${editing.id}`, form)
        toast.push('Collection updated.')
      } else {
        await api.post('/account/collections', form)
        toast.push('Collection created.')
      }
      setCreating(false)
      setEditing(null)
      setForm({ name: '', description: '', icon: 'folder' })
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeCollection = async (collection) => {
    try {
      await api.del(`/account/collections/${collection.id}`)
      toast.push('Collection deleted.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const removeItem = async (collection, item) => {
    try {
      await api.del(`/account/collections/${collection.id}/items/item/${item.itemId}`)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const move = async (collection, index, delta) => {
    const items = [...collection.items]
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const swap = items[index]
    items[index] = items[target]
    items[target] = swap
    try {
      await api.post(`/account/collections/${collection.id}/reorder`, { itemIds: items.map((item) => item.itemId) })
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const moveToCollection = async (collection, item, targetId) => {
    try {
      await api.post(`/account/collections/${collection.id}/move`, { itemId: item.itemId, collectionId: Number(targetId) })
      toast.push('Moved.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  if (loading) return <SkeletonList count={2} height={120} />
  const collections = data?.results || []

  return (
    <div className="mt-4">
      <div className="row-between">
        <h2 style={{ fontSize: 'var(--text-h4)' }}>My collections</h2>
        <Button variant="outline" size="sm" icon={FolderPlus} onClick={() => { setEditing(null); setForm({ name: '', description: '', icon: 'folder' }); setCreating(true) }}>
          New collection
        </Button>
      </div>
      <p className="help">
        Collections group saved records however you like. They are private to your account — not visible to administrators, offices or other citizens.
      </p>

      {collections.length ? (
        <div className="grid grid-2 mt-3">
          {collections.map((collection) => (
            <div className="card" key={collection.id}>
              <div className="row-between">
                <h3 style={{ fontSize: '1rem', marginBottom: 0 }}>{collection.name}</h3>
                <Badge>{collection.item_count} saved</Badge>
              </div>
              {collection.description ? <p className="text-sm text-muted">{collection.description}</p> : null}

              {collection.items?.length ? (
                <ul className="collection-list">
                  {collection.items.map((item, index) => (
                    <li key={item.itemId}>
                      <div>
                        <span className="text-xs text-muted">{item.typeLabel}</span>
                        {item.available && item.url ? <Link to={item.url} style={{ display: 'block' }}>{item.title}</Link> : <strong>{item.title}</strong>}
                      </div>
                      <span className="row" style={{ gap: '0.2rem' }}>
                        <button type="button" className="icon-btn" onClick={() => move(collection, index, -1)} disabled={index === 0} aria-label={`Move ${item.title} up`}>↑</button>
                        <button type="button" className="icon-btn" onClick={() => move(collection, index, 1)} disabled={index === collection.items.length - 1} aria-label={`Move ${item.title} down`}>↓</button>
                        {collections.length > 1 ? (
                          <Select
                            aria-label={`Move ${item.title} to another collection`}
                            defaultValue=""
                            onChange={(event) => { if (event.target.value) moveToCollection(collection, item, event.target.value); event.target.value = '' }}
                          >
                            <option value="">Move to…</option>
                            {collections.filter((other) => other.id !== collection.id).map((other) => (
                              <option key={other.id} value={other.id}>{other.name}</option>
                            ))}
                          </Select>
                        ) : null}
                        <button type="button" className="icon-btn" onClick={() => removeItem(collection, item)} aria-label={`Remove ${item.title} from ${collection.name}`}>×</button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No items yet. Add saved records to this collection from the list below.</p>
              )}

              <div className="card-actions">
                <Button variant="ghost" size="sm" icon={Pencil} onClick={() => {
                  setEditing(collection)
                  setForm({ name: collection.name, description: collection.description || '', icon: collection.icon || 'folder' })
                  setCreating(true)
                }}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => removeCollection(collection)}>Delete collection</Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FolderPlus}
          title="No collections yet"
          description="Create a collection such as 'Business permits' or 'For my senior parent' and add saved records to it."
          action={<Button onClick={() => setCreating(true)}>Create a collection</Button>}
        />
      )}

      <Modal
        open={creating}
        onClose={() => { setCreating(false); setEditing(null) }}
        title={editing ? 'Edit collection' : 'New collection'}
        actions={
          <>
            <Button variant="outline" onClick={() => { setCreating(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={submit} loading={busy}>{editing ? 'Save changes' : 'Create collection'}</Button>
          </>
        }
      >
        <form onSubmit={submit}>
          <Field label="Name" htmlFor="collection-name" required>
            <Input id="collection-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={80} required />
          </Field>
          <Field label="Description (optional)" htmlFor="collection-description">
            <Textarea id="collection-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={300} style={{ minHeight: 70 }} />
          </Field>
          <Field label="Icon" htmlFor="collection-icon">
            <Select id="collection-icon" value={form.icon} onChange={(event) => setForm({ ...form, icon: event.target.value })}>
              {ICONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
            </Select>
          </Field>
        </form>
      </Modal>

      <Alert tone="info">
        Deleting a collection never deletes the public records inside it, and a bookmark is never an application or a government record.
      </Alert>
    </div>
  )
}
