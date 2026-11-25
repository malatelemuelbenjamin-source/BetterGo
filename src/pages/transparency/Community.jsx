import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, query } from '../../api'
import { useSeo } from '../../hooks'
import { useAuth } from '../../auth'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'
import TransparencyNav from './TransparencyNav'

const KIND_TITLE = { question: 'Community questions', discussion: 'Community discussions' }

function ThreadList({ rows, empty }) {
  if (!rows) return <SkeletonList count={2} height={70} />
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>
  return rows.map((thread) => (
    <div key={thread.reference} className="card">
      <div className="row-between">
        <div>
          <Link to={`/transparency/community/${thread.kind === 'question' ? 'questions' : 'discussions'}/${thread.reference}`}><strong>{thread.title}</strong></Link>
          <div className="text-xs text-muted">{thread.topicTitle || thread.topicSlug} · {thread.municipalityName || 'Provincial'} · {thread.author} · {String(thread.createdAt).slice(0, 10)}</div>
        </div>
        <div className="row">{thread.featured ? <Badge tone="success">Featured</Badge> : null}{thread.kind === 'question' ? <Badge tone={thread.answered ? 'success' : 'neutral'}>{thread.answered ? 'Answered' : 'Unanswered'}</Badge> : null}</div>
      </div>
      <p className="text-sm">{thread.body.length > 260 ? `${thread.body.slice(0, 260)}…` : thread.body}</p>
    </div>
  ))
}

export default function Community({ mode = 'hub' }) {
  const { reference } = useParams()
  const [search] = useSearchParams()
  const { user } = useAuth()
  const toast = useToast()
  const [overview, setOverview] = useState(null)
  const [topics, setTopics] = useState([])
  const [entities, setEntities] = useState([])
  const [threads, setThreads] = useState(null)
  const [detail, setDetail] = useState(null)
  const [experts, setExperts] = useState(null)
  const [guidelines, setGuidelines] = useState(null)
  const [filters, setFilters] = useState({ q: '', topic: search.get('topic') || '', answered: '' })
  const [form, setForm] = useState({ kind: mode === 'discussions' ? 'discussion' : 'question', title: '', body: '', topicSlug: 'budget-basics', municipalityId: '', recordReference: '', sourceUrl: '', sourceTitle: '' })
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const kind = mode === 'discussions' ? 'discussion' : mode === 'questions' ? 'question' : null

  useSeo({
    title: mode === 'experts' ? 'Community contributors' : mode === 'guidelines' ? 'Community guidelines' : mode === 'detail' ? detail?.thread?.title || 'Community discussion' : KIND_TITLE[kind] || 'Transparency community',
    description: 'Ask questions and discuss published Marinduque financial records with cited public sources. Moderated, independent community conversation — not official government responses.',
    noindex: mode === 'detail' && !detail,
  })

  useEffect(() => {
    setError(null)
    api.get('/transparency/finance/entities').then((body) => setEntities(body.entities)).catch(() => {})
    if (mode === 'hub') api.get('/transparency/community/overview').then((body) => { setOverview(body); setTopics(body.topics) }).catch((err) => setError(err.message))
    if (mode === 'questions' || mode === 'discussions') api.get('/transparency/community/topics').then((body) => setTopics(body.topics)).catch(() => {})
    if (mode === 'topics') api.get('/transparency/community/topics').then((body) => setTopics(body.topics)).catch((err) => setError(err.message))
    if (mode === 'experts') api.get('/transparency/community/experts').then(setExperts).catch((err) => setError(err.message))
    if (mode === 'guidelines') api.get('/transparency/community/guidelines').then(setGuidelines).catch((err) => setError(err.message))
    if (mode === 'detail') api.get(`/transparency/community/threads/${reference}`).then(setDetail).catch((err) => setError(err.message))
  }, [mode, reference])

  useEffect(() => {
    if (!kind) return
    api.get(`/transparency/community/threads${query({ ...filters, kind, limit: 20 })}`).then(setThreads).catch((err) => setError(err.message))
  }, [kind, filters])

  const submitThread = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const body = await api.post('/transparency/community/threads', {
        ...form,
        municipalityId: form.municipalityId ? Number(form.municipalityId) : null,
        recordReference: form.recordReference || '',
        sourceUrl: form.sourceUrl || undefined,
        sourceTitle: form.sourceTitle || undefined,
      })
      toast.push(body.message)
      setForm({ ...form, title: '', body: '', recordReference: '', sourceUrl: '', sourceTitle: '' })
    } catch (err) { toast.push(err.message, 'error') } finally { setBusy(false) }
  }

  const submitAnswer = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const body = await api.post(`/transparency/community/threads/${reference}/posts`, { body: answer })
      toast.push(body.message)
      setAnswer('')
    } catch (err) { toast.push(err.message, 'error') } finally { setBusy(false) }
  }

  const report = async (targetType, targetId) => {
    const details = window.prompt('Briefly describe the problem (optional). Reason: inaccurate information, harassment, privacy, impersonation, spam or unsafe content.')
    if (details === null) return
    try {
      const body = await api.post('/transparency/community/reports', { targetType, targetId, reason: 'other', details: details.slice(0, 1500) })
      toast.push(`${body.message} Reference ${body.reference}.`)
    } catch (err) { toast.push(err.message, 'error') }
  }

  const header = (
    <>
      <PageHeader
        eyebrow="Transparency"
        title={mode === 'experts' ? 'Community contributors' : mode === 'guidelines' ? 'Community guidelines' : mode === 'detail' ? detail?.thread?.title || 'Community discussion' : KIND_TITLE[kind] || 'Transparency community'}
        description="Independent, moderated civic discussion about published financial records. Community content is not an official government response."
        breadcrumbs={[{ label: 'Transparency', to: '/transparency' }, { label: 'Community', to: '/transparency/community' }, ...(mode !== 'hub' ? [{ label: mode }] : [])]}
      />
      <TransparencyNav />
    </>
  )

  if (error) return <div className="section-tight">{header}<Alert tone="error" title="Community could not load">{error}</Alert></div>

  if (mode === 'guidelines') {
    return (
      <div className="section-tight">
        {header}
        {!guidelines ? <SkeletonList count={2} height={70} /> : (
          <>
            <Alert tone="info" title="Independent discussion">{guidelines.disclaimer}</Alert>
            <div className="grid grid-2">
              {guidelines.guidelines.map((item) => <div className="card" key={item.title}><h2 className="side-label">{item.title}</h2><p className="text-sm">{item.detail}</p></div>)}
            </div>
            <div className="card"><h2 className="side-label">Moderation and appeals</h2><p className="text-sm">{guidelines.moderation}</p></div>
          </>
        )}
      </div>
    )
  }

  if (mode === 'experts') {
    return (
      <div className="section-tight">
        {header}
        {!experts ? <SkeletonList count={2} height={70} /> : (
          <>
            <Alert tone="info" title="Verification is separate from participation">Expertise is self-declared unless a moderator has reviewed recorded credentials. A contributor does not represent an LGU, COA or other institution unless verified authorisation is recorded.</Alert>
            {!experts.experts.length ? <div className="card"><p className="text-sm text-muted">No public contributor profile has been created yet.</p></div> : experts.experts.map((expert) => (
              <div className="card" key={expert.displayName}><div className="row-between"><strong>{expert.displayName}</strong><Badge tone={expert.verificationStatus === 'verified' ? 'success' : 'neutral'}>{expert.verificationLabel}</Badge></div><p className="text-sm">{expert.bio || 'No public biography provided.'}</p><div className="text-xs text-muted">Areas: {(expert.expertise || []).join(', ') || 'Not stated'}. {expert.credentials || 'No credentials recorded.'}</div></div>
            ))}
            {user ? <ContributorForm toast={toast} /> : <Link className="btn btn-primary btn-sm" to={`/login?next=${encodeURIComponent('/transparency/community/experts')}`}>Sign in to create a contributor profile</Link>}
          </>
        )}
      </div>
    )
  }

  if (mode === 'detail') {
    if (!detail) return <div className="section-tight">{header}<SkeletonList count={3} height={80} /></div>
    return (
      <div className="section-tight">
        {header}
        <Alert tone="info" title="Community conversation">This is an independent public discussion, not an official government response. Popularity does not make an answer factually correct.</Alert>
        <div className="card">
          <div className="row-between"><strong>{detail.thread.title}</strong><Badge tone="neutral">{detail.thread.topicTitle}</Badge></div>
          <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{detail.thread.body}</p>
          <div className="text-xs text-muted">{detail.thread.author} · {String(detail.thread.createdAt).slice(0, 10)} · {detail.thread.municipalityName || 'Provincial'}{detail.thread.recordReference ? <> · <Link to={`/transparency/finance/record/${detail.thread.recordReference}`}>{detail.thread.recordReference}</Link></> : null}</div>
          {detail.thread.sources?.length ? <div className="stack-tight" style={{ marginTop: '0.75rem' }}>{detail.thread.sources.map((source) => <div key={source.id} className="text-xs"><a href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a> · {source.institution || 'Institution unavailable'} · <Badge tone={source.verificationStatus === 'verified' ? 'success' : 'neutral'}>{source.verificationLabel}</Badge></div>)}</div> : null}
          <div className="pill-group" style={{ marginTop: '0.75rem' }}>{user ? <Button variant="ghost" size="sm" onClick={() => report('thread', detail.thread.id)}>Report this discussion</Button> : null}</div>
        </div>
        <div className="card">
          <h2 className="side-label">Answers ({detail.posts.length})</h2>
          {!detail.posts.length ? <p className="text-sm text-muted">No published answer yet.</p> : detail.posts.map((post) => (
            <div key={post.id} style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
              <div className="text-xs text-muted">{post.author} · {String(post.createdAt).slice(0, 10)}</div>
              <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{post.body}</p>
              {post.sources?.length ? post.sources.map((source) => <div key={source.id} className="text-xs"><a href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a> · <Badge tone={source.verificationStatus === 'verified' ? 'success' : 'neutral'}>{source.verificationLabel}</Badge></div>) : null}
              {user ? <Button variant="ghost" size="sm" onClick={() => report('post', post.id)}>Report this answer</Button> : null}
            </div>
          ))}
          {user ? (
            <form onSubmit={submitAnswer} className="stack-tight" style={{ marginTop: '1rem' }}>
              <Field label="Add an answer" required help="Cite a public source where possible. Do not include personal information or unsupported accusations."><Textarea required minLength={10} maxLength={5000} rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} /></Field>
              <Button type="submit" loading={busy}>Submit for moderation</Button>
            </form>
          ) : <Link className="btn btn-outline btn-sm" to={`/login?next=${encodeURIComponent(`/transparency/community/discussions/${reference}`)}`}>Sign in to answer</Link>}
        </div>
      </div>
    )
  }

  if (mode === 'hub') {
    return (
      <div className="section-tight">
        {header}
        {!overview ? <SkeletonList count={3} height={80} /> : (
          <>
            <Alert tone="info" title="Independent community space">{overview.note} Submissions are moderated and never presented as official government statements.</Alert>
            <div className="grid grid-4">
              <div className="card"><div className="side-label">Published questions</div><strong>{overview.counts.questions}</strong></div>
              <div className="card"><div className="side-label">Published discussions</div><strong>{overview.counts.discussions}</strong></div>
              <div className="card"><div className="side-label">Unanswered questions</div><strong>{overview.counts.unanswered}</strong></div>
              <div className="card"><div className="side-label">Contributors</div><strong>{overview.counts.contributors}</strong></div>
            </div>
            <div className="card">
              <div className="row-between"><h2 className="side-label">Topics</h2><div className="pill-group"><Link className="pill" to="/transparency/community/questions">Questions</Link><Link className="pill" to="/transparency/community/discussions">Discussions</Link><Link className="pill" to="/transparency/community/experts">Contributors</Link><Link className="pill" to="/transparency/community/guidelines">Guidelines</Link></div></div>
              <div className="grid grid-3">{overview.topics.map((topic) => <Link key={topic.slug} to={`/transparency/community/questions?topic=${topic.slug}`} className="stack-tight" style={{ textDecoration: 'none' }}><strong>{topic.title}</strong><span className="text-xs text-muted">{topic.threads} published thread(s)</span><span className="text-xs text-muted">{topic.description}</span></Link>)}</div>
            </div>
            <div className="card"><h2 className="side-label">Recent moderated discussions</h2><ThreadList rows={overview.recent} empty="No community discussion has been published yet." /></div>
            <p className="text-xs text-muted">{overview.guidelines.join(' ')}</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="section-tight">
      {header}
      <Alert tone="info" title="Read before posting">Questions and discussions are moderated. Do not include personal data, confidential documents, harassment or unsupported accusations. A question is not an official inquiry or formal complaint.</Alert>
      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input className="input" aria-label="Search discussions" placeholder="Search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          <select className="input" aria-label="Topic" value={filters.topic} onChange={(e) => setFilters({ ...filters, topic: e.target.value })}><option value="">All topics</option>{topics.map((topic) => <option key={topic.slug} value={topic.slug}>{topic.title}</option>)}</select>
          {kind === 'question' ? <select className="input" aria-label="Answered status" value={filters.answered} onChange={(e) => setFilters({ ...filters, answered: e.target.value })}><option value="">All questions</option><option value="no">Unanswered</option><option value="yes">Answered</option></select> : null}
        </div>
      </div>
      <ThreadList rows={threads} empty="No published item matches this filter." />

      <div className="card">
        <h2 className="side-label">Ask a public question or start a discussion</h2>
        {!user ? <Alert tone="warning" title="Sign in required">Posting requires an authenticated account so moderation and appeals can be handled privately.</Alert> : (
          <form className="stack-tight" onSubmit={submitThread}>
            <div className="grid grid-2">
              <Field label="Type"><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="question">Question</option><option value="discussion">Discussion</option></Select></Field>
              <Field label="Topic"><Select value={form.topicSlug} onChange={(e) => setForm({ ...form, topicSlug: e.target.value })}>{topics.map((topic) => <option key={topic.slug} value={topic.slug}>{topic.title}</option>)}</Select></Field>
            </div>
            <Field label="Title" required><Input required minLength={8} maxLength={180} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Question or discussion" required help="At least 20 characters. Cite public sources, not personal information."><Textarea required minLength={20} maxLength={5000} rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
            <div className="grid grid-2">
              <Field label="Municipality (optional)"><Select value={form.municipalityId} onChange={(e) => setForm({ ...form, municipalityId: e.target.value })}><option value="">Provincial / all</option>{entities.filter((entity) => entity.id).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</Select></Field>
              <Field label="Published record reference (optional)"><Input value={form.recordReference} onChange={(e) => setForm({ ...form, recordReference: e.target.value })} placeholder="BG-FIN-…" /></Field>
            </div>
            <div className="grid grid-2">
              <Field label="Public source link (optional)"><Input type="url" value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="https://" /></Field>
              <Field label="Source title (optional)"><Input maxLength={180} value={form.sourceTitle} onChange={(e) => setForm({ ...form, sourceTitle: e.target.value })} /></Field>
            </div>
            <Button type="submit" loading={busy}>Submit for moderation</Button>
          </form>
        )}
      </div>
    </div>
  )
}

function ContributorForm({ toast }) {
  const [form, setForm] = useState({ displayName: '', bio: '', expertise: '', credentialsText: '' })
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const body = await api.put('/transparency/community/contributors/me', { ...form, expertise: form.expertise.split(',').map((item) => item.trim()).filter(Boolean) })
      toast.push(body.message)
    } catch (err) { toast.push(err.message, 'error') } finally { setBusy(false) }
  }
  return (
    <form className="card stack-tight" onSubmit={submit}>
      <h2 className="side-label">Your public contributor profile</h2>
      <Field label="Display name" required><Input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
      <Field label="Public biography"><Textarea rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></Field>
      <Field label="Areas of expertise (comma separated)" help="Self-declared. These do not imply institutional representation."><Input value={form.expertise} onChange={(e) => setForm({ ...form, expertise: e.target.value })} /></Field>
      <Field label="Credentials (optional)" help="Only recorded for moderator review; never verified automatically."><Textarea rows={2} value={form.credentialsText} onChange={(e) => setForm({ ...form, credentialsText: e.target.value })} /></Field>
      <Button type="submit" loading={busy}>Save public profile</Button>
    </form>
  )
}
