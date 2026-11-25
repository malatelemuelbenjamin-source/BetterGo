import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, LifeBuoy, Search } from 'lucide-react'
import { api } from '../api'
import { useDocumentTitle } from '../hooks'
import { Alert, Badge, Button, EmptyState, Input, SkeletonList } from '../components/ui'
import { PageHeader } from '../components/layout'
import { useAuth } from '../auth'

/** Public help centre (Prompt 69). Only published articles are shown. */
export default function HelpPage() {
  useDocumentTitle('Help centre')
  const { user } = useAuth()
  const [categories, setCategories] = useState([])
  const [articles, setArticles] = useState(null)
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')
  const [article, setArticle] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async (term = q, key = category) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (term) params.set('q', term)
      if (key) params.set('category', key)
      const [cats, list] = await Promise.all([api.get('/help/categories'), api.get(`/help/articles?${params.toString()}`)])
      setCategories(cats.categories)
      setArticles(list)
    } catch {
      setArticles({ results: [], total: 0 })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openArticle = async (slug) => {
    try {
      setArticle((await api.get(`/help/articles/${slug}`)).article)
    } catch {
      setArticle(null)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="BetterGo support"
        title="Help centre"
        description="Guides and answers about using the BetterGo platform. BetterGo support is not a government office."
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Help' }]}
        actions={
          <div className="row">
            {user ? <Link className="btn btn-primary" to="/dashboard/support">My support tickets</Link> : <Link className="btn btn-primary" to="/login">Sign in for support</Link>}
          </div>
        }
      />
      <div className="container section-tight">
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault()
            load()
          }}
        >
          <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search help articles" aria-label="Search help articles" />
          <Button type="submit" icon={Search}>Search</Button>
        </form>

        <div className="row mt-3" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
          <button type="button" className={`pill ${!category ? 'is-active' : ''}`} onClick={() => { setCategory(''); load(q, '') }}>All topics</button>
          {categories.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`pill ${category === entry.key ? 'is-active' : ''}`}
              aria-pressed={category === entry.key}
              onClick={() => { setCategory(entry.key); load(q, entry.key) }}
            >
              {entry.name} ({entry.article_count})
            </button>
          ))}
        </div>

        <div className="grid grid-2 mt-4">
          <div>
            {loading ? <SkeletonList count={4} height={60} /> : articles?.results?.length ? (
              <div className="stack">
                {articles.results.map((row) => (
                  <button key={row.slug} type="button" className="card" style={{ textAlign: 'left' }} onClick={() => openArticle(row.slug)}>
                    <div className="row-between">
                      <strong>{row.title}</strong>
                      <Badge tone="neutral">{row.category_name || 'Help'}</Badge>
                    </div>
                    {row.summary ? <p className="text-sm text-muted">{row.summary}</p> : null}
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={BookOpen}
                title="No published articles match"
                description="Help articles appear here once they are reviewed and published. You can still submit a support ticket."
                action={<Link className="btn btn-outline" to={user ? '/dashboard/support' : '/login'}>Contact support</Link>}
              />
            )}
          </div>
          <div className="card">
            {article ? (
              <>
                <Badge tone="info">{article.categoryName || 'Help'}</Badge>
                <h2>{article.title}</h2>
                <p className="text-sm text-muted">{article.summary}</p>
                <p style={{ whiteSpace: 'pre-wrap' }}>{article.body}</p>
                <p className="text-xs text-muted">Last updated {article.updatedAt ? new Date(article.updatedAt).toLocaleDateString() : 'not recorded'}</p>
              </>
            ) : (
              <>
                <div className="row"><LifeBuoy size={18} /><strong>Need more help?</strong></div>
                <p className="text-sm text-muted">Choose an article to read it here, or submit a BetterGo support ticket so the platform team can help.</p>
                <p className="text-sm text-muted">For emergencies, contact verified emergency services directly. BetterGo support is not an emergency channel.</p>
                {user ? <Link className="btn btn-outline btn-sm" to="/dashboard/support">Submit a support ticket</Link> : <Link className="btn btn-outline btn-sm" to="/login">Sign in to submit a ticket</Link>}
              </>
            )}
          </div>
        </div>

        <Alert tone="info" title="What this help centre is">
          These guides explain BetterGo features only. They do not state government requirements, fees or processing times, and a support ticket is not an official LGU complaint.
        </Alert>
      </div>
    </>
  )
}
