import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Eye, FolderPlus, Plus, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { api, fmtDate, fmtDateTime } from '../api'
import { useApi, useDocumentTitle } from '../hooks'
import { useLang } from '../i18n'
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  SkeletonList,
  Textarea,
  useToast,
} from '../components/ui'
import { PageHeader } from '../components/layout'

const MAX_BYTES = 10 * 1024 * 1024

const expiryState = (expiresAt) => {
  if (!expiresAt) return null
  const days = Math.round((new Date(`${expiresAt}T23:59:59`).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { label: 'Expired (your own date)', tone: 'warning' }
  if (days <= 60) return { label: `Expires in ${days} day${days === 1 ? '' : 's'}`, tone: 'info' }
  return null
}

const bytes = (value) => {
  if (!value) return '0 KB'
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(value / 1024))} KB`
}

export function VaultPage() {
  const { t } = useLang()
  useDocumentTitle(t('p4.documentsTitle', 'My documents'))
  const [params, setParams] = useState({ q: '', category: '', sort: 'newest' })
  const { data, loading, reload } = useApi(
    `/account/documents?q=${encodeURIComponent(params.q)}&category=${params.category}&sort=${params.sort}`,
  )
  const { data: security, reload: reloadSecurity } = useApi('/account/documents/security')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState(null)
  const [meta, setMeta] = useState({ title: '', category: 'other', expiresAt: '', description: '', folderId: '' })
  const [detail, setDetail] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [share, setShare] = useState({ recipientLabel: '', purpose: '' })
  const [folderName, setFolderName] = useState('')
  const toast = useToast()

  const usedPercent = useMemo(() => {
    const used = data?.storage?.usedBytes || 0
    return Math.min(100, Math.round((used / (data?.storage?.limitBytes || 1)) * 100))
  }, [data])

  const refresh = async () => {
    await Promise.all([reload(), reloadSecurity()])
  }

  const submitUpload = async (event) => {
    event.preventDefault()
    if (!file) return
    if (file.size > MAX_BYTES) {
      toast.push('Documents must be 10 MB or smaller.', 'error')
      return
    }
    setBusy(true)
    try {
      const search = new URLSearchParams({ category: meta.category, title: meta.title || file.name.replace(/\.[^.]+$/, '') })
      if (meta.expiresAt) search.set('expiresAt', meta.expiresAt)
      if (meta.description) search.set('description', meta.description)
      if (meta.folderId) search.set('folderId', meta.folderId)
      await api.postFile(`/account/documents?${search.toString()}`, file)
      toast.push('Document stored in your private vault.')
      setUploading(false)
      setFile(null)
      setMeta({ title: '', category: 'other', expiresAt: '', description: '', folderId: '' })
      await refresh()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (document) => {
    if (!window.confirm(`Delete “${document.title}” from your vault? This cannot be undone.`)) return
    setBusy(true)
    try {
      await api.del(`/account/documents/${document.id}`)
      toast.push('Document deleted.')
      setDetail(null)
      await refresh()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const createFolder = async (event) => {
    event.preventDefault()
    if (!folderName.trim()) return
    try {
      await api.post('/account/documents/folders', { name: folderName.trim() })
      setFolderName('')
      toast.push('Folder created.')
      await refresh()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const addShare = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api.post(`/account/documents/${detail.document.id}/shares`, { ...share, consent: true })
      toast.push('Sharing permission recorded. Nothing was transmitted.')
      setSharing(false)
      setShare({ recipientLabel: '', purpose: '' })
      const refreshed = await api.get(`/account/documents/${detail.document.id}`)
      setDetail(refreshed)
      await refresh()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (shareId) => {
    try {
      await api.del(`/account/documents/${detail.document.id}/shares/${shareId}`)
      const refreshed = await api.get(`/account/documents/${detail.document.id}`)
      setDetail(refreshed)
      await refresh()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const openDetail = async (document) => {
    try {
      setDetail(await api.get(`/account/documents/${document.id}`))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow={t('dash.eyebrowAccount', 'Account')}
        title={t('p4.documentsTitle', 'My documents')}
        description="Private files you can reuse on BetterGo forms. BetterGo does not verify or certify them."
        breadcrumbs={[{ label: t('dash.breadcrumb', 'Dashboard'), to: '/dashboard' }, { label: t('p4.documentsTitle', 'My documents') }]}
        actions={<Button icon={Upload} onClick={() => setUploading(true)}>Add document</Button>}
      />

      {data ? (
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-label">Documents</div><div className="stat-value">{data.total}</div></div>
          <div className="stat-card">
            <div className="stat-label">Storage</div>
            <div className="stat-value">{bytes(data.storage.usedBytes)}</div>
            <div className="text-xs text-muted">{usedPercent}% of {bytes(data.storage.limitBytes)}</div>
          </div>
          <div className="stat-card"><div className="stat-label">Expiring soon</div><div className="stat-value">{security?.expiringSoon?.length || 0}</div></div>
          <div className="stat-card"><div className="stat-label">Active shares</div><div className="stat-value">{security?.shares?.length || 0}</div></div>
        </div>
      ) : null}

      <div className="card mt-4">
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <Input value={params.q} onChange={(event) => setParams({ ...params, q: event.target.value })} placeholder="Search your documents" aria-label="Search documents" style={{ flex: '1 1 220px' }} />
          <Select value={params.category} onChange={(event) => setParams({ ...params, category: event.target.value })} aria-label="Category" style={{ maxWidth: 220 }}>
            <option value="">Every category</option>
            {Object.entries(data?.categories || {}).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select value={params.sort} onChange={(event) => setParams({ ...params, sort: event.target.value })} aria-label="Sort" style={{ maxWidth: 180 }}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="expiring">Expiring first</option>
            <option value="title">By title</option>
          </Select>
        </div>
      </div>

      {loading ? (
        <SkeletonList count={3} height={70} />
      ) : data?.results?.length ? (
        <div className="table-wrap mt-4">
          <table className="data">
            <thead><tr><th>Document</th><th>Category</th><th>Expiry</th><th>Size</th><th>Added</th><th /></tr></thead>
            <tbody>
              {data.results.map((document) => {
                const expiry = expiryState(document.expiresAt)
                return (
                  <tr key={document.id}>
                    <td>
                      <button type="button" className="link-btn" onClick={() => openDetail(document)}>{document.title}</button>
                      <div className="text-xs text-muted">{document.originalFilename} · v{document.version}</div>
                    </td>
                    <td>{document.categoryLabel}</td>
                    <td>{expiry ? <Badge tone={expiry.tone}>{expiry.label}</Badge> : document.expiresAt ? fmtDate(document.expiresAt) : '—'}</td>
                    <td className="nowrap">{bytes(document.fileSize)}</td>
                    <td className="nowrap">{fmtDate(document.createdAt)}</td>
                    <td className="nowrap">
                      <a className="btn btn-ghost btn-sm" href={`/api/account/documents/${document.id}/file`} target="_blank" rel="noreferrer" title="Preview"><Eye size={14} /></a>
                      <a className="btn btn-ghost btn-sm" href={`/api/account/documents/${document.id}/file?download=1`} title="Download"><Download size={14} /></a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={Upload}
          title={params.q || params.category ? 'No documents match those filters' : t('p4.noDocuments', 'You have not added any documents.')}
          description="Upload a PDF, JPG or PNG. Files stay private to your account and are never published."
          action={<Button onClick={() => setUploading(true)}>Add your first document</Button>}
        />
      )}

      <div className="grid grid-2 mt-4" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Folders</h2>
          <form className="row" style={{ gap: '0.4rem' }} onSubmit={createFolder}>
            <Input value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="New folder name" aria-label="New folder name" maxLength={60} />
            <Button type="submit" variant="outline" size="sm" icon={FolderPlus}>Create</Button>
          </form>
          {data?.folders?.length ? (
            <ul className="stack-sm mt-3">
              {data.folders.map((folder) => (
                <li key={folder.id} className="row-between">
                  <span>{folder.name}</span>
                  <span className="text-xs text-muted">{fmtDate(folder.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted mt-3">No folders yet. Folders only organise files; deleting one never deletes documents.</p>}
        </div>

        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}><ShieldCheck size={16} /> Document security</h2>
          {security?.recentActivity?.length ? (
            <ul className="timeline mt-2">
              {security.recentActivity.slice(0, 6).map((event, index) => (
                <li key={index}>
                  <div className="text-sm">{event.event_type.replace(/_/g, ' ')} — {event.document_title}</div>
                  {event.detail ? <div className="text-xs text-muted">{event.detail}</div> : null}
                  <div className="text-xs text-muted">{fmtDateTime(event.created_at)}</div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted mt-2">No document activity yet.</p>}
          {security?.shares?.length ? (
            <>
              <h3 style={{ fontSize: '1rem' }}>Active sharing permissions</h3>
              <ul className="stack-sm">
                {security.shares.map((item) => (
                  <li key={item.id} className="row-between">
                    <span className="text-sm">{item.document_title} → {item.recipient_label}</span>
                    <Button size="sm" variant="ghost" onClick={async () => {
                      try {
                        await api.del(`/account/documents/${item.document_id}/shares/${item.id}`)
                        await refresh()
                      } catch (err) { toast.push(err.message, 'error') }
                    }}>Revoke</Button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="help">BetterGo does not share vault files with any office. A recorded permission is internal only.</p>
        </div>
      </div>

      <Modal open={uploading} onClose={() => setUploading(false)} title="Add a document" actions={<><Button variant="outline" onClick={() => setUploading(false)}>Cancel</Button><Button onClick={submitUpload} loading={busy} disabled={!file}>Upload</Button></>}>
        <form onSubmit={submitUpload}>
          <Field label="File" htmlFor="vault-file" required help="PDF, JPG or PNG. Up to 10 MB. The file type is checked, not just the extension.">
            <input id="vault-file" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => {
              const chosen = event.target.files?.[0] || null
              setFile(chosen)
              if (chosen && !meta.title) setMeta((current) => ({ ...current, title: chosen.name.replace(/\.[^.]+$/, '') }))
            }} />
          </Field>
          <Field label="Title" htmlFor="vault-title" required>
            <Input id="vault-title" value={meta.title} onChange={(event) => setMeta({ ...meta, title: event.target.value })} maxLength={160} />
          </Field>
          <Field label="Category" htmlFor="vault-category" help="Labels only — BetterGo does not verify the document.">
            <Select id="vault-category" value={meta.category} onChange={(event) => setMeta({ ...meta, category: event.target.value })}>
              {Object.entries(data?.categories || {}).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Expiry date (optional)" htmlFor="vault-expiry" help="Your own note. BetterGo does not decide legal validity.">
            <Input id="vault-expiry" type="date" value={meta.expiresAt} onChange={(event) => setMeta({ ...meta, expiresAt: event.target.value })} />
          </Field>
          <Field label="Folder (optional)" htmlFor="vault-folder">
            <Select id="vault-folder" value={meta.folderId} onChange={(event) => setMeta({ ...meta, folderId: event.target.value })}>
              <option value="">Unfiled</option>
              {(data?.folders || []).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </Select>
          </Field>
          <Field label="Description (optional)" htmlFor="vault-description">
            <Textarea id="vault-description" value={meta.description} onChange={(event) => setMeta({ ...meta, description: event.target.value })} maxLength={500} style={{ minHeight: 60 }} />
          </Field>
        </form>
      </Modal>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.document.title || 'Document'} actions={detail ? <><Button variant="outline" onClick={() => setSharing(true)}>Record sharing</Button><Button variant="danger" icon={Trash2} onClick={() => remove(detail.document)} loading={busy}>Delete</Button></> : null}>
        {detail ? (
          <div>
            <dl className="detail-list">
              <div><dt>File</dt><dd>{detail.document.originalFilename} · {bytes(detail.document.fileSize)}</dd></div>
              <div><dt>Category</dt><dd>{detail.document.categoryLabel}</dd></div>
              <div><dt>Issuer (your note)</dt><dd>{detail.document.issuer || 'Not provided'}</dd></div>
              <div><dt>Expiry (your note)</dt><dd>{detail.document.expiresAt ? fmtDate(detail.document.expiresAt) : 'Not provided'}</dd></div>
              <div><dt>Added</dt><dd>{fmtDateTime(detail.document.createdAt)}</dd></div>
              <div><dt>Version</dt><dd>{detail.document.version}</dd></div>
            </dl>
            {detail.applications.length ? (
              <>
                <h3 style={{ fontSize: '1rem' }}>Used in BetterGo records</h3>
                <ul className="stack-sm">
                  {detail.applications.map((application) => (
                    <li key={application.reference}><Link to={`/dashboard/applications/${application.reference}`}>{application.reference}</Link> · {application.status.replace(/_/g, ' ')}</li>
                  ))}
                </ul>
                <p className="help">A document attached to an active record cannot be deleted until that record is closed.</p>
              </>
            ) : null}
            {detail.shares.length ? (
              <>
                <h3 style={{ fontSize: '1rem' }}>Sharing permissions</h3>
                <ul className="stack-sm">
                  {detail.shares.map((item) => (
                    <li key={item.id} className="row-between">
                      <span className="text-sm">{item.recipient_label} — {item.purpose}</span>
                      <Button size="sm" variant="ghost" onClick={() => revoke(item.id)}>Revoke</Button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <p className="help">{detail.note}</p>
            <div className="row mt-3" style={{ gap: '0.4rem' }}>
              <a className="btn btn-outline btn-sm" href={`/api/account/documents/${detail.document.id}/file`} target="_blank" rel="noreferrer">Preview</a>
              <a className="btn btn-outline btn-sm" href={`/api/account/documents/${detail.document.id}/file?download=1`}>Download</a>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={sharing} onClose={() => setSharing(false)} title="Record a sharing permission" actions={<><Button variant="outline" onClick={() => setSharing(false)}>Cancel</Button><Button onClick={addShare} loading={busy} disabled={share.purpose.trim().length < 5 || share.recipientLabel.trim().length < 3}>Record</Button></>}>
        <Alert tone="warning" title="Nothing is transmitted">
          Recording a permission does not send this file anywhere. BetterGo has no enabled external document transmission.
        </Alert>
        <Field label="Intended recipient" htmlFor="share-recipient" required>
          <Input id="share-recipient" value={share.recipientLabel} onChange={(event) => setShare({ ...share, recipientLabel: event.target.value })} maxLength={160} placeholder="e.g. Boac Planning Office" />
        </Field>
        <Field label="Purpose" htmlFor="share-purpose" required>
          <Textarea id="share-purpose" value={share.purpose} onChange={(event) => setShare({ ...share, purpose: event.target.value })} maxLength={300} style={{ minHeight: 70 }} />
        </Field>
      </Modal>

      <Alert tone="info" title="Not a government document repository">
        Files here are copies you uploaded. BetterGo does not certify, authenticate or verify them, and expiry dates are your own notes.
      </Alert>
      <p className="help mt-3"><Plus size={12} /> To use a document on a form, open the service's BetterGo form and choose it from the vault.</p>
    </div>
  )
}
