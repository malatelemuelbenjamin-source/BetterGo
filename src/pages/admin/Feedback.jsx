import { useEffect, useState } from 'react'
import { MessageSquare, Plus, Vote } from 'lucide-react'
import { api, fmtDateTime } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, EmptyState, Field, Input, Select, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

const TABS = [['feedback', 'Feedback'], ['suggestions', 'Suggestions'], ['surveys', 'Surveys'], ['analytics', 'Analytics']]
const QUESTION_TYPES = ['short_text', 'long_text', 'single_choice', 'multiple_choice', 'dropdown', 'rating', 'yes_no', 'date', 'ranking']

export function AdminFeedback() {
  useDocumentTitle('Feedback and surveys')
  const toast = useToast()
  const [tab, setTab] = useState('feedback')
  const [data, setData] = useState(null)
  const [statuses, setStatuses] = useState({})
  const [response, setResponse] = useState({})
  const [surveyDraft, setSurveyDraft] = useState({
    title: '',
    description: '',
    privacyNotice: 'Responses are voluntary and stored on BetterGo.',
    allowAnonymous: false,
    questions: [{ key: 'experience', label: 'How would you rate this experience?', type: 'rating', required: true }],
  })
  const [results, setResults] = useState({})

  const load = async () => {
    try {
      if (tab === 'feedback') {
        const list = await api.get('/admin/feedback')
        setData(list)
        setStatuses(list.statuses)
      }
      if (tab === 'suggestions') setData(await api.get('/admin/suggestions'))
      if (tab === 'surveys') setData(await api.get('/admin/surveys'))
      if (tab === 'analytics') setData(await api.get('/admin/feedback/analytics'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => {
    setData(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const moderate = async (row, patch) => {
    try {
      await api.patch(`/admin/feedback/${row.reference}`, patch)
      toast.push('Feedback updated.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const moderateSuggestion = async (row, patch) => {
    try {
      await api.patch(`/admin/suggestions/${row.id}`, patch)
      toast.push('Suggestion updated.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const createSurvey = async (event) => {
    event.preventDefault()
    try {
      await api.post('/admin/surveys', surveyDraft)
      toast.push('Survey created as a draft.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const surveyAction = async (row, action) => {
    try {
      await api.post(`/admin/surveys/${row.id}/${action}`, {})
      toast.push(action === 'publish' ? 'Survey published.' : 'Survey closed.')
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const showResults = async (row) => {
    try {
      setResults((current) => ({ ...current, [row.id]: { loading: true } }))
      const payload = await api.get(`/admin/surveys/${row.id}/results`)
      setResults((current) => ({ ...current, [row.id]: payload }))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Feedback and surveys"
        description="Moderate BetterGo platform feedback, publish selected suggestions and run independent community surveys."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Feedback and surveys' }]}
      />

      <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
        {TABS.map(([key, label]) => (
          <button key={key} type="button" className={`pill ${tab === key ? 'is-active' : ''}`} onClick={() => setTab(key)} aria-pressed={tab === key}>{label}</button>
        ))}
      </div>

      {!data ? <SkeletonList count={3} height={60} /> : null}

      {tab === 'feedback' && data ? (
        <div className="stack mt-4">
          <Alert tone="info" title="Anonymous records">{data.note}</Alert>
          {data.results.length ? data.results.map((row) => (
            <div className="card" key={row.reference}>
              <div className="row-between">
                <strong>{row.title}</strong>
                <div className="row">
                  <Badge tone="neutral">{row.category_name}</Badge>
                  <Badge tone="info">{row.statusLabel}</Badge>
                </div>
              </div>
              <p className="text-sm">{row.description}</p>
              <div className="card-meta">
                <span>{row.reference}</span>
                <span>{row.anonymous ? 'Anonymous' : row.citizen_email}</span>
                <span>{row.municipality_name || 'No municipality'}</span>
                <span>{fmtDateTime(row.created_at)}</span>
                {row.rating ? <span>{row.rating} / 5</span> : null}
              </div>
              {row.admin_response ? <p className="text-sm text-muted">Response: {row.admin_response}</p> : null}
              <div className="grid grid-2">
                <Field label="Status">
                  <Select value={response[`${row.reference}:status`] || row.status} onChange={(e) => setResponse({ ...response, [`${row.reference}:status`]: e.target.value })}>
                    {Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </Select>
                </Field>
                <Field label="Private response to citizen">
                  <Input value={response[`${row.reference}:text`] || ''} onChange={(e) => setResponse({ ...response, [`${row.reference}:text`]: e.target.value })} />
                </Field>
              </div>
              <Button
                size="sm"
                icon={MessageSquare}
                onClick={() => moderate(row, { status: response[`${row.reference}:status`] || row.status, response: response[`${row.reference}:text`] || undefined })}
              >
                Save moderation
              </Button>
            </div>
          )) : <EmptyState icon={MessageSquare} title="No feedback in scope" description="Feedback submitted by citizens appears here." />}
        </div>
      ) : null}

      {tab === 'suggestions' && data ? (
        <div className="stack mt-4">
          {data.results.length ? data.results.map((row) => (
            <div className="card" key={row.id}>
              <div className="row-between">
                <strong>{row.title}</strong>
                <div className="row"><Badge tone="neutral">{row.votes} votes</Badge><Badge tone="info">{row.status}</Badge></div>
              </div>
              <p className="text-sm">{row.proposal}</p>
              <div className="card-meta"><span>{row.reference}</span><span>{row.citizen_email}</span><span>{row.public ? 'Public' : 'Private'}</span></div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <Select value={row.status} onChange={(e) => moderateSuggestion(row, { status: e.target.value })} aria-label={`Status for ${row.title}`}>
                  {Object.entries(data.statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
                <Input placeholder="Moderator note (required to decline/archive)" onBlur={(e) => { if (e.target.value) moderateSuggestion(row, { note: e.target.value, status: row.status }) }} />
                <Button size="sm" variant={row.public ? 'ghost' : 'outline'} icon={Vote} onClick={() => moderateSuggestion(row, { public: !row.public })}>
                  {row.public ? 'Unpublish' : 'Publish'}
                </Button>
              </div>
            </div>
          )) : <EmptyState icon={Vote} title="No suggestions" description="Citizen feature suggestions appear here for moderation." />}
        </div>
      ) : null}

      {tab === 'surveys' && data ? (
        <div className="stack mt-4">
          <Alert tone="info" title="Independent surveys">{data.note}</Alert>
          <form className="card" onSubmit={createSurvey}>
            <h2 className="side-label">Create a survey draft</h2>
            <Field label="Title"><Input value={surveyDraft.title} onChange={(e) => setSurveyDraft({ ...surveyDraft, title: e.target.value })} required minLength={5} /></Field>
            <Field label="Description"><Textarea rows={2} value={surveyDraft.description} onChange={(e) => setSurveyDraft({ ...surveyDraft, description: e.target.value })} /></Field>
            <Field label="Privacy notice"><Textarea rows={2} value={surveyDraft.privacyNotice} onChange={(e) => setSurveyDraft({ ...surveyDraft, privacyNotice: e.target.value })} /></Field>
            <label className="row" style={{ gap: '0.4rem' }}>
              <input type="checkbox" checked={surveyDraft.allowAnonymous} onChange={(e) => setSurveyDraft({ ...surveyDraft, allowAnonymous: e.target.checked })} />
              Allow anonymous responses where the respondent is signed in
            </label>
            {surveyDraft.questions.map((question, index) => (
              <div className="card" key={index}>
                <div className="grid grid-2">
                  <Field label="Question label">
                    <Input value={question.label} onChange={(e) => setSurveyDraft({
                      ...surveyDraft,
                      questions: surveyDraft.questions.map((item, i) => (i === index ? { ...item, label: e.target.value } : item)),
                    })} />
                  </Field>
                  <Field label="Type">
                    <Select value={question.type} onChange={(e) => setSurveyDraft({
                      ...surveyDraft,
                      questions: surveyDraft.questions.map((item, i) => (i === index ? { ...item, type: e.target.value } : item)),
                    })}>
                      {QUESTION_TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
                    </Select>
                  </Field>
                </div>
                {['single_choice', 'multiple_choice', 'dropdown'].includes(question.type) ? (
                  <Field label="Options (comma separated)">
                    <Input
                      value={(question.options || []).join(', ')}
                      onChange={(e) => setSurveyDraft({
                        ...surveyDraft,
                        questions: surveyDraft.questions.map((item, i) => (i === index ? { ...item, options: e.target.value.split(',').map((value) => value.trim()).filter(Boolean) } : item)),
                      })}
                    />
                  </Field>
                ) : null}
                <label className="row" style={{ gap: '0.4rem' }}>
                  <input type="checkbox" checked={Boolean(question.required)} onChange={(e) => setSurveyDraft({
                    ...surveyDraft,
                    questions: surveyDraft.questions.map((item, i) => (i === index ? { ...item, required: e.target.checked } : item)),
                  })} />
                  Required
                </label>
                {surveyDraft.questions.length > 1 ? (
                  <Button size="sm" variant="ghost" onClick={() => setSurveyDraft({ ...surveyDraft, questions: surveyDraft.questions.filter((_, i) => i !== index) })}>Remove question</Button>
                ) : null}
              </div>
            ))}
            <div className="row">
              <Button type="button" variant="outline" icon={Plus} onClick={() => setSurveyDraft({
                ...surveyDraft,
                questions: [...surveyDraft.questions, { key: `question_${surveyDraft.questions.length + 1}`, label: '', type: 'short_text', required: false }],
              })}>Add question</Button>
              <Button type="submit">Create draft</Button>
            </div>
          </form>

          {data.results.map((row) => (
            <div className="card" key={row.id}>
              <div className="row-between"><strong>{row.title}</strong><Badge tone={row.status === 'published' ? 'success' : 'neutral'}>{row.status}</Badge></div>
              <div className="card-meta"><span>{row.question_count} questions</span><span>{row.response_count} responses</span><span>{row.municipality_name || 'Province-wide'}</span></div>
              <div className="row">
                {row.status === 'draft' ? <Button size="sm" onClick={() => surveyAction(row, 'publish')}>Publish</Button> : null}
                {row.status === 'published' ? <Button size="sm" variant="outline" onClick={() => surveyAction(row, 'close')}>Close</Button> : null}
                <Button size="sm" variant="ghost" onClick={() => showResults(row)}>View results</Button>
              </div>
              {results[row.id] ? (
                results[row.id].loading ? <p className="text-sm text-muted">Loading…</p> : results[row.id].suppressed ? (
                  <Alert tone="warning" title="Results withheld">{results[row.id].note}</Alert>
                ) : (
                  <div>
                    <p className="text-sm">Total responses: {results[row.id].total}</p>
                    {results[row.id].results.map((question) => (
                      <div key={question.key} className="text-sm">
                        <strong>{question.label}</strong>
                        <ul>{question.distribution.map((entry, index) => <li key={index}>{entry.value}: {entry.total}</li>)}</ul>
                      </div>
                    ))}
                    <p className="text-xs text-muted">{results[row.id].note}</p>
                  </div>
                )
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'analytics' && data ? (
        <div className="stack mt-4">
          <div className="grid grid-3">
            <div className="card stat-card"><span className="stat-label">Feedback</span><div className="stat-value">{data.feedback.total}</div></div>
            <div className="card stat-card"><span className="stat-label">Anonymous</span><div className="stat-value">{data.feedback.anonymous}</div></div>
            <div className="card stat-card"><span className="stat-label">Average rating</span><div className="stat-value">{data.feedback.averageRating ?? '—'}</div></div>
          </div>
          <div className="card">
            <h2 className="side-label">By category</h2>
            {data.byCategory.map((row) => <div className="row-between" key={row.category}><span>{row.category}</span><strong>{row.total}</strong></div>)}
          </div>
          <div className="card">
            <h2 className="side-label">Surveys</h2>
            {data.surveys.map((row) => <div className="row-between" key={row.slug}><span>{row.title}</span><strong>{row.responses}</strong></div>)}
          </div>
          <p className="text-sm text-muted">{data.note}</p>
        </div>
      ) : null}
    </div>
  )
}
