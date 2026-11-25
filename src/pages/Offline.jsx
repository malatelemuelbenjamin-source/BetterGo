import { useEffect, useState } from 'react'
import { Download, Printer, Trash2 } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, Field, Input, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

export default function OfflinePage() {
  useDocumentTitle('Offline service packs')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState([])
  const [form, setForm] = useState({ title: '', expiresAt: '' })
  const [open, setOpen] = useState(null)

  const load = async () => {
    try {
      setData(await api.get('/account/offline-packs'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="section-tight"><SkeletonList count={3} height={70} /></div>

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Offline service packs"
        description="Keep a printable snapshot of published service information for places with weak signal."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Offline service packs' }]}
      />
      <Alert tone="info" title="Snapshots, not live records">{data.note}</Alert>

      <div className="card">
        <h2 className="side-label">Create a pack</h2>
        <Field label="Pack name (optional)"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Health office visit" /></Field>
        <Field label="Re-check after (optional)"><Input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></Field>
        <fieldset>
          <legend className="field-label">Published services to include (up to 20)</legend>
          {data.availableServices.map((service) => (
            <label key={service.id} className="row text-sm">
              <input
                type="checkbox"
                checked={selected.includes(service.id)}
                onChange={(e) => setSelected(e.target.checked ? [...selected, service.id].slice(0, 20) : selected.filter((id) => id !== service.id))}
              />
              {service.title} · <span className="text-muted">{service.municipality}</span>
            </label>
          ))}
        </fieldset>
        <Button
          icon={Download}
          disabled={!selected.length}
          onClick={async () => {
            try {
              const result = await api.post('/account/offline-packs', {
                title: form.title || undefined,
                serviceIds: selected,
                expiresAt: form.expiresAt || undefined,
              })
              toast.push(result.message)
              setSelected([])
              setForm({ title: '', expiresAt: '' })
              setOpen(result.pack)
              await load()
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Create offline pack
        </Button>
      </div>

      <div className="card">
        <h2 className="side-label">Your packs</h2>
        {data.packs.length ? data.packs.map((pack) => (
          <div key={pack.id} className="stack-tight">
            <div className="row-between">
              <strong>{pack.title}</strong>
              <Badge tone={pack.status === 'ready' ? (pack.stale ? 'warning' : 'success') : 'neutral'}>{pack.status}</Badge>
            </div>
            <span className="text-xs text-muted">{pack.reference} · {pack.itemCount} service(s) · captured {pack.createdAt?.slice(0, 10)}</span>
            {pack.stale ? <span className="text-xs text-muted">{pack.staleServices} service(s) changed since this pack was made. Open the live pages before acting.</span> : null}
            <div className="row">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    setOpen((await api.get(`/account/offline-packs/${pack.id}`)).pack)
                  } catch (err) {
                    toast.push(err.message, 'error')
                  }
                }}
              >
                Open snapshot
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                onClick={async () => {
                  try {
                    const result = await api.del(`/account/offline-packs/${pack.id}`)
                    toast.push(result.message)
                    if (open?.id === pack.id) setOpen(null)
                    await load()
                  } catch (err) {
                    toast.push(err.message, 'error')
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        )) : <p className="text-sm text-muted">No offline packs yet.</p>}
      </div>

      {open ? (
        <div className="card">
          <div className="row-between">
            <h2 className="side-label">{open.title}</h2>
            <Button size="sm" variant="outline" icon={Printer} onClick={() => window.print()}>Print</Button>
          </div>
          <p className="text-xs text-muted">{open.note}</p>
          {open.snapshot.map((service) => (
            <div key={service.id} className="stack-tight">
              <strong>{service.title}</strong>
              <span className="text-xs text-muted">{service.municipality} · verification: {service.verificationStatus || 'not recorded'}</span>
              {service.description ? <p className="text-sm">{service.description}</p> : null}
              {service.requirements ? <p className="text-sm text-muted">Requirements as published: {service.requirements}</p> : null}
              {service.fees ? <p className="text-sm text-muted">Fees as published: {service.fees}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
