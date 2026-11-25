import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { Lightbulb, MessageSquareHeart, Send, ThumbsUp } from 'lucide-react'
import { api, fmtDate } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Field, Input, Select, SkeletonList, Textarea, useToast } from '../components/ui'
import { PageHeader } from '../components/layout'
import { useAuth } from '../auth'

export function FeedbackPage() {
  useDocumentTitle('Feedback and surveys')
  const { user } = useAuth()
  const toast = useToast()
  const [categories, setCategories] = useState([])
  const [suggestions, setSuggestions] = useState(null)
  const [surveys, setSurveys] = useState(null)
  const [history, setHistory] = useState(null)
  const [own, setOwn] = useState(null)
  const [form, setForm] = useState({ category: 'website_usability', title: '', description: '', rating: '', anonymous: false })
  const [idea, setIdea] = useState({ category: 'feature_request', title: '', problem: '', proposal: '' })
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const [cats, board, open] = await Promise.all([api.get('/feedback/categories'), api.get('/feedback/suggestions'), api.get('/surveys')])
      setCategories(cats.categories)
      setSuggestions(board)
      setSurveys(open)
      if (user) {
        const [mine, myIdeas] = await Promise.all([api.get('/account/feedback'), api.get('/account/suggestions')])
        setHistory(mine.results)
        setOwn(myIdeas.results)
      }
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const submitFeedback = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const payload = { ...form }
      if (form.rating) payload.rating = Number(form.rating)
      else delete payload.rating
      const result = await api.post('/feedback', payload)
      toast.push(result.message)
      setForm({ category: 'website_usability', title: '', description: '', rating: '', anonymous: false })
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const submitIdea = async (event) => {
    event.preventDefault()
    try {
      const result = await api.post('/account/suggestions', idea)
      toast.push(result.message)
      setIdea({ category: 'feature_request', title: '', problem: '', proposal: '' })
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const vote = async (suggestion) => {
    try {
      const result = await api.post(`/feedback/suggestions/${suggestion.id}/vote`, {})
      toast.push(result.message)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Community"
        title="Feedback, ideas and surveys"
        description="Help improve BetterGo. This is platform feedback, not an official LGU complaint or consultation."
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Feedback' }]}
      />
      <div className="container section-tight">
        <div className="grid grid-2">
          <form className="card" onSubmit={submitFeedback}>
            <div className="row"><MessageSquareHeart size={18} /><strong>Send feedback</strong></div>
            <Field label="Category">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {categories.map((entry) => <option key={entry.key} value={entry.key}>{entry.name}</option>)}
              </Select>
            </Field>
            <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={5} maxLength={160} /></Field>
            <Field label="Description" hint="Do not include sensitive personal information.">
              <Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required minLength={20} maxLength={5000} />
            </Field>
            <Field label="Optional rating of this feature">
              <Select value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })}>
                <option value="">No rating</option>
                {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}
              </Select>
            </Field>
            {user ? null : (
              <label className="row" style={{ gap: '0.5rem' }}>
                <input type="checkbox" checked={form.anonymous} onChange={(e) => setForm({ ...form, anonymous: e.target.checked })} />
                <span className="text-sm">Send anonymously. We then cannot ask you follow-up questions or show this in your account history.</span>
              </label>
            )}
            <Button type="submit" icon={Send} disabled={busy}>{busy ? 'Sending…' : 'Submit feedback'}</Button>
            {user ? <p className="text-xs text-muted">Submitted as {user.email}. Signed-in feedback is visible only to authorised platform staff.</p> : <p className="text-xs text-muted">Signed-out submissions are accepted only when you choose anonymous feedback.</p>}
          </form>

          <div className="stack">
            <div className="card">
              <div className="row"><Lightbulb size={18} /><strong>Suggest an improvement</strong></div>
              {user ? (
                <form onSubmit={submitIdea}>
                  <Field label="Title"><Input value={idea.title} onChange={(e) => setIdea({ ...idea, title: e.target.value })} required minLength={5} /></Field>
                  <Field label="Problem to solve"><Textarea rows={2} value={idea.problem} onChange={(e) => setIdea({ ...idea, problem: e.target.value })} /></Field>
                  <Field label="Proposed improvement"><Textarea rows={3} value={idea.proposal} onChange={(e) => setIdea({ ...idea, proposal: e.target.value })} required minLength={20} /></Field>
                  <Button type="submit" variant="outline">Submit suggestion</Button>
                </form>
              ) : <p className="text-sm text-muted"><Link to="/login">Sign in</Link> to submit a feature suggestion and vote on others.</p>}
            </div>

            <div className="card">
              <h2 className="side-label">Public suggestions</h2>
              {!suggestions ? <SkeletonList count={2} height={50} /> : suggestions.results.length ? suggestions.results.map((row) => (
                <div key={row.id} className="card" style={{ marginBottom: '0.5rem' }}>
                  <div className="row-between"><strong>{row.title}</strong><Badge tone="info">{row.statusLabel}</Badge></div>
                  <p className="text-sm text-muted">{row.proposal}</p>
                  <div className="row">
                    <Button size="sm" variant="ghost" icon={ThumbsUp} onClick={() => vote(row)} disabled={!user}>{row.votes} votes</Button>
                    <span className="text-xs text-muted">{row.category_name}</span>
                  </div>
                </div>
              )) : <p className="text-sm text-muted">No published suggestions yet. Moderators publish selected proposals.</p>}
              <p className="text-xs text-muted">{suggestions?.note}</p>
            </div>
          </div>
        </div>

        <div className="card mt-4">
          <h2 className="side-label">Open surveys</h2>
          {!surveys ? <SkeletonList count={2} height={50} /> : surveys.results.length ? (
            <div className="grid grid-2">
              {surveys.results.map((survey) => (
                <Link key={survey.slug} to={`/feedback/surveys/${survey.slug}`} className="card">
                  <div className="row-between"><strong>{survey.title}</strong><Badge tone="info">{survey.category || 'Survey'}</Badge></div>
                  <p className="text-sm text-muted">{survey.description}</p>
                  <span className="text-xs text-muted">{survey.municipality_name || 'Province-wide'} {survey.closes_at ? `· closes ${fmtDate(survey.closes_at)}` : ''}</span>
                </Link>
              ))}
            </div>
          ) : <EmptyState icon={Lightbulb} title="No surveys are open" description="Published BetterGo community surveys appear here while they accept responses." />}
        </div>

        {user ? (
          <div className="grid grid-2 mt-4">
            <div className="card">
              <h2 className="side-label">My feedback</h2>
              {!history ? <SkeletonList count={2} height={40} /> : history.length ? history.map((row) => (
                <div key={row.reference} className="text-sm" style={{ marginBottom: '0.5rem' }}>
                  <div className="row-between"><strong>{row.title}</strong><Badge tone="neutral">{row.statusLabel}</Badge></div>
                  {row.admin_response ? <p className="text-muted">Response: {row.admin_response}</p> : null}
                </div>
              )) : <p className="text-sm text-muted">You have not submitted identified feedback.</p>}
            </div>
            <div className="card">
              <h2 className="side-label">My suggestions</h2>
              {!own ? <SkeletonList count={2} height={40} /> : own.length ? own.map((row) => (
                <div key={row.reference} className="text-sm" style={{ marginBottom: '0.5rem' }}>
                  <div className="row-between"><strong>{row.title}</strong><Badge tone="neutral">{row.statusLabel}</Badge></div>
                  {row.admin_note ? <p className="text-muted">{row.admin_note}</p> : null}
                </div>
              )) : <p className="text-sm text-muted">You have not submitted a suggestion.</p>}
            </div>
          </div>
        ) : null}

        <Alert tone="info" title="What happens to feedback">
          Feedback is reviewed by the BetterGo platform team. Voluntary ratings and survey answers are not a representative sample of Marinduque residents and are never presented as government performance ratings.
        </Alert>
      </div>
    </>
  )
}

export function SurveyPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [answers, setAnswers] = useState({})
  const [anonymous, setAnonymous] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get(`/surveys/${slug}`).then(setData).catch((err) => toast.push(err.message, 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await api.post(`/account/surveys/${slug}/responses`, { answers, anonymous })
      toast.push(result.message)
      navigate('/feedback')
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <div className="container section-tight"><SkeletonList count={4} height={60} /></div>

  return (
    <>
      <PageHeader
        eyebrow="BetterGo community survey"
        title={data.survey.title}
        description={data.survey.description}
        breadcrumbs={[{ label: 'Feedback', to: '/feedback' }, { label: 'Survey' }]}
      />
      <div className="container section-tight">
        <form className="card" onSubmit={submit}>
          {data.survey.intro ? <p>{data.survey.intro}</p> : null}
          {data.survey.privacyNotice ? <Alert tone="info" title="Privacy notice">{data.survey.privacyNotice}</Alert> : null}
          {data.survey.questions.map((question) => (
            <Field key={question.id} label={`${question.label}${question.required ? ' *' : ''}`}>
              {['short_text', 'date'].includes(question.question_type) ? (
                <Input
                  type={question.question_type === 'date' ? 'date' : 'text'}
                  required={Boolean(question.required)}
                  value={answers[question.question_key] || ''}
                  onChange={(e) => setAnswers({ ...answers, [question.question_key]: e.target.value })}
                />
              ) : null}
              {question.question_type === 'long_text' ? (
                <Textarea rows={4} required={Boolean(question.required)} value={answers[question.question_key] || ''} onChange={(e) => setAnswers({ ...answers, [question.question_key]: e.target.value })} />
              ) : null}
              {['single_choice', 'dropdown', 'yes_no'].includes(question.question_type) ? (
                <Select required={Boolean(question.required)} value={answers[question.question_key] || ''} onChange={(e) => setAnswers({ ...answers, [question.question_key]: e.target.value })}>
                  <option value="">Choose an answer</option>
                  {(question.question_type === 'yes_no' ? ['yes', 'no'] : question.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                </Select>
              ) : null}
              {question.question_type === 'multiple_choice' ? (
                <div className="stack">
                  {(question.options || []).map((option) => {
                    const selected = answers[question.question_key] || []
                    return (
                      <label key={option} className="row" style={{ gap: '0.4rem' }}>
                        <input
                          type="checkbox"
                          checked={selected.includes(option)}
                          onChange={(e) => setAnswers({
                            ...answers,
                            [question.question_key]: e.target.checked ? [...selected, option] : selected.filter((item) => item !== option),
                          })}
                        />
                        {option}
                      </label>
                    )
                  })}
                </div>
              ) : null}
              {question.question_type === 'rating' ? (
                <Select required={Boolean(question.required)} value={answers[question.question_key] || ''} onChange={(e) => setAnswers({ ...answers, [question.question_key]: e.target.value })}>
                  <option value="">Choose a rating</option>
                  {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}
                </Select>
              ) : null}
              {question.question_type === 'ranking' ? (
                <Textarea rows={3} required={Boolean(question.required)} value={answers[question.question_key] || ''} onChange={(e) => setAnswers({ ...answers, [question.question_key]: e.target.value })} placeholder="List your order, one item per line" />
              ) : null}
            </Field>
          ))}
          {data.survey.allowAnonymous ? (
            <label className="row" style={{ gap: '0.5rem' }}>
              <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              <span className="text-sm">Submit anonymously. The response will not be linked to your account.</span>
            </label>
          ) : null}
          <Button type="submit" icon={Send} disabled={busy}>{busy ? 'Submitting…' : 'Submit response'}</Button>
        </form>
        <Alert tone="info" title="Independent survey">{data.disclaimer}</Alert>
      </div>
    </>
  )
}
