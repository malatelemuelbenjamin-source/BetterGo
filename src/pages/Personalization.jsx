import { useEffect, useState } from 'react'
import { Accessibility } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, Field, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

function applyAccessibility(settings) {
  document.documentElement.dataset.textScale = settings.textScale === 'default' ? '' : settings.textScale
  document.documentElement.dataset.contrast = settings.highContrast ? 'high' : ''
  document.documentElement.dataset.simplified = settings.simplifiedView ? 'on' : ''
  if (settings.reducedMotion) document.documentElement.dataset.motion = 'reduced'
  else delete document.documentElement.dataset.motion
}

export default function PersonalizationPage() {
  useDocumentTitle('Accessibility and personalization')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [form, setForm] = useState(null)
  const [needs, setNeeds] = useState([])

  const load = async () => {
    try {
      const result = await api.get('/account/personalization')
      setData(result)
      setForm(result.settings)
      setNeeds(result.settings.assistanceNeeds)
      applyAccessibility(result.settings)
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !form) return <div className="section-tight"><SkeletonList count={4} height={70} /></div>

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Accessibility and personalization"
        description="Adjust how BetterGo looks and tell it which assistance needs matter to you."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Accessibility and personalization' }]}
      />
      <Alert tone="info" title="Your choices stay yours">{data.note}</Alert>

      <div className="card">
        <h2 className="side-label">Display and accessibility</h2>
        <div className="grid grid-2">
          <Field label="Text size">
            <Select value={form.textScale} onChange={(e) => setForm({ ...form, textScale: e.target.value })}>
              {Object.entries(data.textScales).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Language">
            <Select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
              <option value="en">English</option>
              <option value="fil">Filipino</option>
            </Select>
          </Field>
        </div>
        <label className="row text-sm">
          <input type="checkbox" checked={form.highContrast} onChange={(e) => setForm({ ...form, highContrast: e.target.checked })} />
          High contrast colours
        </label>
        <label className="row text-sm">
          <input type="checkbox" checked={form.reducedMotion} onChange={(e) => setForm({ ...form, reducedMotion: e.target.checked })} />
          Reduce motion and animation
        </label>
        <label className="row text-sm">
          <input type="checkbox" checked={form.simplifiedView} onChange={(e) => setForm({ ...form, simplifiedView: e.target.checked })} />
          Simplified view with less decorative content
        </label>
        <label className="row text-sm">
          <input type="checkbox" checked={form.screenReaderHints} onChange={(e) => setForm({ ...form, screenReaderHints: e.target.checked })} />
          Show extra screen-reader guidance text
        </label>
        <label className="row text-sm">
          <input type="checkbox" checked={form.personalizationOptIn} onChange={(e) => setForm({ ...form, personalizationOptIn: e.target.checked })} />
          Show service suggestions based on my activity and declared needs
        </label>
        <Button
          icon={Accessibility}
          onClick={async () => {
            try {
              const result = await api.put('/account/personalization', form)
              setForm(result.settings)
              applyAccessibility(result.settings)
              toast.push(result.message)
              await load()
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Save accessibility settings
        </Button>
      </div>

      <div className="card">
        <h2 className="side-label">Self-declared assistance needs</h2>
        <p className="text-xs text-muted">Optional. These are not verified and do not decide eligibility for any service.</p>
        {Object.entries(data.needs).map(([value, label]) => (
          <label key={value} className="row text-sm">
            <input
              type="checkbox"
              checked={needs.includes(value)}
              onChange={(e) => setNeeds(e.target.checked ? [...needs, value] : needs.filter((entry) => entry !== value))}
            />
            {label}
          </label>
        ))}
        <Button
          variant="outline"
          onClick={async () => {
            try {
              const result = await api.put('/account/personalization/needs', { assistanceNeeds: needs })
              toast.push(result.message)
              await load()
            } catch (err) {
              toast.push(err.message, 'error')
            }
          }}
        >
          Save declared needs
        </Button>
      </div>

      <div className="card">
        <h2 className="side-label">Published accessibility information</h2>
        <p className="text-xs text-muted">{data.personalizedNote}</p>
        {data.services.length ? data.services.map((service) => (
          <div key={service.id} className="stack-tight">
            <div className="row-between">
              <strong>{service.title}</strong>
              {service.verificationStatus === 'verified' ? <Badge tone="success">office-confirmed</Badge> : <Badge tone="warning">not office-confirmed</Badge>}
            </div>
            <span className="text-xs text-muted">{service.featureLabels.join(' · ') || 'No accessibility features recorded'}</span>
            {service.notes ? <span className="text-xs text-muted">{service.notes}</span> : null}
          </div>
        )) : <p className="text-sm text-muted">No published service lists accessibility information yet.</p>}
        <p className="text-xs text-muted">Always confirm arrangements with the office before travelling; BetterGo does not guarantee them.</p>
      </div>
    </div>
  )
}
