import { Link } from 'react-router-dom'
import { AlertTriangle, FileText } from 'lucide-react'
import { fmtDate } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import { Alert, Badge, EmptyState, SkeletonList } from '../components/ui'
import { PageHeader } from '../components/layout'
import { Markdown } from './Info'

const RELATED = [
  { to: '/privacy-policy', label: 'Privacy Policy' },
  { to: '/terms-of-use', label: 'Terms of Use' },
  { to: '/data-privacy', label: 'Data Privacy' },
  { to: '/cookie-policy', label: 'Cookie Policy' },
  { to: '/disclaimer', label: 'Disclaimer' },
  { to: '/acceptable-use-policy', label: 'Acceptable Use' },
  { to: '/security', label: 'Security' },
  { to: '/data-requests', label: 'Data requests' },
]

export function LegalPage({ docType, title, aliasNote }) {
  const { data, loading, error } = useApi(`/legal/${docType}`)
  useDocumentTitle(title)
  const document = data?.document

  return (
    <>
      <PageHeader
        eyebrow="Legal &amp; privacy"
        title={document?.title || title}
        description={document ? `Version ${document.version} · Last updated ${fmtDate(document.updated_at)}` : undefined}
        icon={FileText}
        breadcrumbs={[{ label: title }]}
      />

      <div className="container section-tight">
        {loading ? (
          <SkeletonList count={2} height={240} />
        ) : error || !document ? (
          <EmptyState
            icon={FileText}
            title="Document not available"
            description="This document has not been published yet."
            action={<Link className="btn btn-primary" to="/about">About BetterGo</Link>}
          />
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2.2fr) minmax(0, 1fr)', alignItems: 'start' }}>
            <div>
              {!data.inForce ? (
                <Alert tone="warning" title="Draft — awaiting professional legal review">
                  This document is published for transparency but is not yet in force. It requires review by a qualified Philippine privacy
                  or legal professional before it is treated as an approved policy. Version {document.version}
                  {document.effective_date ? ` · effective ${fmtDate(document.effective_date)}` : ' · no effective date set'}.
                </Alert>
              ) : null}

              {aliasNote ? (
                <div className="mt-3">
                  <Alert tone="info" title="Related document">
                    {aliasNote}
                  </Alert>
                </div>
              ) : null}

              <article className="card mt-3">
                <div className="row" style={{ gap: '0.4rem', marginBottom: 'var(--space-4)' }}>
                  <Badge tone={data.inForce ? 'success' : 'warning'}>{data.inForce ? 'In force' : 'Draft'}</Badge>
                  <Badge>Version {document.version}</Badge>
                  <Badge>Updated {fmtDate(document.updated_at)}</Badge>
                  {document.effective_date ? <Badge>Effective {fmtDate(document.effective_date)}</Badge> : null}
                </div>
                <Markdown text={document.content} />
              </article>

              <div className="card mt-4">
                <h2 style={{ fontSize: 'var(--text-h4)' }}>Version history</h2>
                <div className="table-wrap mt-2">
                  <table className="data">
                    <thead><tr><th>Version</th><th>Status</th><th>Effective date</th><th>Created</th></tr></thead>
                    <tbody>
                      {(data.versions || []).map((version) => (
                        <tr key={`${version.version}-${version.created_at}`}>
                          <td>{version.version}</td>
                          <td style={{ textTransform: 'capitalize' }}>{version.status?.replace(/_/g, ' ')}</td>
                          <td>{version.effective_date ? fmtDate(version.effective_date) : '—'}</td>
                          <td>{fmtDate(version.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="help mt-2">Previous versions are preserved. Consent records are never retroactively altered.</p>
              </div>
            </div>

            <aside className="stack" style={{ gap: 'var(--space-4)' }}>
              <div className="card">
                <h3 style={{ fontSize: 'var(--text-h4)' }}>Related documents</h3>
                <ul className="link-list">
                  {RELATED.filter((item) => item.to !== `/${docType.replace(/_/g, '-')}`).map((item) => (
                    <li key={item.to}><Link to={item.to}>{item.label}</Link></li>
                  ))}
                </ul>
              </div>
              <div className="meta-panel">
                <AlertTriangle size={16} aria-hidden="true" style={{ color: 'var(--warning)' }} />
                <p className="text-sm mt-2">
                  Legal documents on this platform are technical drafts. BetterGo Marinduque does not claim legal certification or full
                  regulatory compliance without an appropriate independent legal assessment.
                </p>
              </div>
              <div className="card">
                <h3 style={{ fontSize: 'var(--text-h4)' }}>Questions?</h3>
                <p className="text-sm text-muted">
                  Submit a privacy question or data request through the request centre.
                </p>
                <Link className="btn btn-outline btn-sm" to="/data-requests">Data request centre</Link>
              </div>
            </aside>
          </div>
        )}
      </div>
    </>
  )
}
