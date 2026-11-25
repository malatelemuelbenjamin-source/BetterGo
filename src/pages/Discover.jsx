import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Compass, Search, Sparkles } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Input, Select, SkeletonList, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'

function ServiceCard({ service, onSave, saved }) {
  return (
    <div className="card">
      <div className="row-between">
        <Link to={service.url}><strong>{service.title}</strong></Link>
        <Badge tone="neutral">{service.capabilityLabel}</Badge>
      </div>
      {service.summary ? <p className="text-sm text-muted">{service.summary}</p> : null}
      <div className="card-meta">
        {service.categoryName ? <span>{service.categoryName}</span> : null}
        {service.municipalityName ? <span>{service.municipalityName}</span> : null}
        {service.officeName ? <span>{service.officeName}</span> : null}
      </div>
      {service.reason ? <p className="text-xs" style={{ color: 'var(--muted)' }}>{service.reason}</p> : null}
      <div className="row">
        <Link className="btn btn-ghost btn-sm" to={service.url}>View service</Link>
        {onSave ? <Button size="sm" variant="ghost" onClick={() => onSave(service)}>{saved ? 'Saved' : 'Save'}</Button> : null}
      </div>
    </div>
  )
}

export default function DiscoverPage() {
  useDocumentTitle('Discover services')
  const toast = useToast()
  const [overview, setOverview] = useState(null)
  const [results, setResults] = useState(null)
  const [filters, setFilters] = useState({ q: '', category: '', municipalityId: '', online: '' })
  const [finder, setFinder] = useState(null)
  const [finderAnswers, setFinderAnswers] = useState({})
  const [finderResults, setFinderResults] = useState(null)

  const loadOverview = async () => {
    try {
      setOverview(await api.get('/account/discovery'))
      const finderData = await api.get('/account/discovery/finder')
      setFinder(finderData)
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => {
    loadOverview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const search = async (event) => {
    event?.preventDefault()
    try {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
      setResults(await api.get(`/account/discovery/services?${params.toString()}`))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const save = async (service) => {
    try {
      await api.post('/account/saved', { contentType: 'service', contentId: service.id })
      toast.push('Saved to your private list.')
      await loadOverview()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const togglePersonalization = async () => {
    try {
      await api.put('/account/discovery/preferences', { personalizationEnabled: !overview.preferences.personalizationEnabled })
      await loadOverview()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const runFinder = async () => {
    try {
      const payload = {}
      if (finderAnswers.category) payload.category = finderAnswers.category
      if (finderAnswers.municipality) payload.municipalityId = Number(finderAnswers.municipality)
      if (finderAnswers.preference) payload.preference = finderAnswers.preference
      setFinderResults(await api.post('/account/discovery/finder', payload))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  if (!overview) return <div className="section-tight"><SkeletonList count={5} height={70} /></div>

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Account"
        title="Discover services"
        description="Find published government service information and BetterGo features that match your municipality and interests."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Discover services' }]}
        actions={<Button variant="outline" icon={Sparkles} onClick={togglePersonalization}>{overview.preferences.personalizationEnabled ? 'Turn off personalization' : 'Turn on personalization'}</Button>}
      />

      <form className="card" onSubmit={search}>
        <div className="grid grid-4">
          <Input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Search services" aria-label="Search services" />
          <Select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} aria-label="Category">
            <option value="">All categories</option>
            {overview.categories.map((entry) => <option key={entry.slug} value={entry.slug}>{entry.name}</option>)}
          </Select>
          <Select value={filters.municipalityId} onChange={(e) => setFilters({ ...filters, municipalityId: e.target.value })} aria-label="Municipality">
            <option value="">All municipalities</option>
            {overview.municipalities.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </Select>
          <Select value={filters.online} onChange={(e) => setFilters({ ...filters, online: e.target.value })} aria-label="Online availability">
            <option value="">Any application method</option>
            <option value="1">Online option recorded</option>
          </Select>
        </div>
        <Button type="submit" icon={Search}>Search published services</Button>
      </form>

      {results ? (
        <div className="mt-4">
          <h2 className="side-label">{results.total} matching services</h2>
          {results.results.length ? <div className="grid grid-2">{results.results.map((service) => <ServiceCard key={service.id} service={service} onSave={save} />)}</div> : (
            <EmptyState icon={Compass} title="No published service matched" description="Try a different term or category. A missing result does not mean a service is unavailable; confirm with the responsible office." />
          )}
          <p className="text-xs text-muted">{results.note}</p>
        </div>
      ) : null}

      {overview.preferences.personalizationEnabled && overview.recommendations.length ? (
        <div className="mt-4">
          <h2 className="side-label">Recommended for you</h2>
          <div className="grid grid-2">{overview.recommendations.map((service) => <ServiceCard key={service.id} service={service} onSave={save} />)}</div>
        </div>
      ) : null}

      <div className="grid grid-2 mt-4">
        <div>
          <h2 className="side-label">Guided service finder</h2>
          <div className="card">
            {finder?.questions.map((question) => (
              <label className="field" key={question.key}>
                <span className="field-label">{question.label}</span>
                <Select value={finderAnswers[question.key] || ''} onChange={(e) => setFinderAnswers({ ...finderAnswers, [question.key]: e.target.value })}>
                  <option value="">No preference</option>
                  {(question.options || []).map((option) => <option key={String(option.value)} value={option.value}>{option.label}</option>)}
                </Select>
              </label>
            ))}
            <Button onClick={runFinder}>Show matching services</Button>
            <p className="text-xs text-muted">{finder?.note}</p>
          </div>
          {finderResults ? (
            <div className="stack mt-3">
              {finderResults.results.length ? finderResults.results.map((service) => <ServiceCard key={service.id} service={service} onSave={save} />) : <p className="text-sm text-muted">No published service matched those answers.</p>}
            </div>
          ) : null}
        </div>

        <div className="stack">
          {overview.recentlyViewed.length ? (
            <div className="card">
              <h2 className="side-label">Recently viewed</h2>
              {overview.recentlyViewed.map((row) => <div className="row-between text-sm" key={row.entity_id}><span>{row.entity_label}</span><span className="text-muted">{row.viewed_at?.slice(0, 10)}</span></div>)}
              <Link className="btn btn-ghost btn-sm" to="/dashboard/privacy-center">Manage history in the privacy centre</Link>
            </div>
          ) : null}
          {overview.saved.length ? (
            <div className="card">
              <h2 className="side-label">Saved services</h2>
              {overview.saved.map((row) => <div key={row.id}><Link to={`/services/${row.slug}`}>{row.title}</Link></div>)}
            </div>
          ) : null}
          {overview.popular.length ? (
            <div className="card">
              <h2 className="side-label">Popular on BetterGo</h2>
              {overview.popular.map((row) => (
                <div key={row.id} className="text-sm">
                  <Link to={`/services/${row.slug}`}>{row.title}</Link>
                  <span className="text-muted"> · {row.views} recorded views</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <Alert tone="info" title="What recommendations mean">{overview.note}</Alert>
    </div>
  )
}
