import { useEffect, useState } from 'react'
import { Languages } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

export default function TranslationsPage() {
  useDocumentTitle('Language access')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [form, setForm] = useState({ serviceId: '', note: '' })

  const load = async () => {
    try {
      const result = await api.get('/account/translations')
      setData(result)
      if (!form.serviceId && result.availableServices[0]) setForm((current) => ({ ...current, serviceId: String(result.availableServices[0].id) }))
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
        title="Language access"
        description="Read Filipino translations and ask for help when information is not available in your language."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Language access' }]}
      />
      <Alert tone="info" title="English text is the service record">{data.note}</Alert>

      <div className="card">
        <h2 className="side-label">Request a Filipino translation</h2>
        <Field label="Published service">
          <Select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
            {data.availableServices.map((service) => <option key={service.id} value={service.id}>{service.title} · {service.municipality}</option>)}
          </Select>
        </Field>
        {!data.availableServices.length ? <p className="text-sm text-muted">Every published service already has a translation or a pending request from you.</p> : null}
        <Field label="What do you need translated? (optional)">
          <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        <Button
          icon={Languages}
          disabled={!form.serviceId}
          onClick={async () => {
            try {
              const result = await api.post('/account/translations/requests', {
                serviceId: Number(form.serviceId),
                language: 'fil',
                note: form.note || undefined,
              })
              toast.push(result.message)
              setForm({ serviceId: '', note: '' })
              await load()
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Send translation request
        </Button>

        {data.requests.length ? data.requests.map((request) => (
          <div key={request.id} className="stack-tight">
            <div className="row-between">
              <strong>{request.reference} · {request.serviceTitle}</strong>
              <Badge tone={request.status === 'completed' ? 'success' : request.status === 'pending' ? 'warning' : 'neutral'}>{request.statusLabel}</Badge>
            </div>
            <span className="text-xs text-muted">{request.languageLabel} · requested {request.createdAt?.slice(0, 10)}</span>
            {request.responseNote ? <span className="text-xs text-muted">Office note: {request.responseNote}</span> : null}
            {request.status === 'pending' ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    const result = await api.post(`/account/translations/requests/${request.id}/cancel`, {})
                    toast.push(result.message)
                    await load()
                  } catch (err) {
                    toast.push(err.message, 'error')
                  }
                }}
              >
                Cancel request
              </Button>
            ) : null}
          </div>
        )) : <p className="text-sm text-muted">No translation requests.</p>}
      </div>

      <div className="card">
        <h2 className="side-label">Available Filipino translations</h2>
        {data.translations.length ? data.translations.map((entry) => (
          <div key={entry.id} className="stack-tight">
            <div className="row-between">
              <strong>{entry.title}</strong>
              <Badge tone={entry.status === 'office_confirmed' ? 'success' : 'warning'}>{entry.status === 'office_confirmed' ? 'office-confirmed' : 'BetterGo reading aid'}</Badge>
            </div>
            <span className="text-xs text-muted">English service: {entry.serviceTitle}</span>
            {entry.summary ? <p className="text-sm">{entry.summary}</p> : null}
            {entry.requirements ? <p className="text-sm text-muted">Mga kinakailangan: {entry.requirements}</p> : null}
            {entry.fees ? <p className="text-sm text-muted">Bayarin: {entry.fees}</p> : null}
            {entry.procedure ? <p className="text-sm text-muted">Paraan: {entry.procedure}</p> : null}
            {entry.status !== 'office_confirmed' ? <p className="text-xs text-muted">Prepared for BetterGo. Confirm the English record and the office's own advice before acting.</p> : null}
          </div>
        )) : <p className="text-sm text-muted">No Filipino translations are published yet.</p>}
      </div>
    </div>
  )
}
