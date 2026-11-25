import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { api, fmtDate, fmtDateTime, fmtNumber, query } from '../../api'
import { useApi, useDocumentTitle } from '../../hooks'
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Pagination,
  Select,
  SkeletonList,
  StatusBadge,
  Tabs,
  Textarea,
  useToast,
} from '../../components/ui'
import { PageHeader } from '../../components/layout'
import { StatCard } from '../../components/cards'
import { useAuth } from '../../auth'

/* -------------------------------- Overview ------------------------------- */
export function AdminOverview() {
  useDocumentTitle('Administration overview')
  const { data, loading, error } = useApi('/admin/overview')
  const [params] = useSearchParams()
  const denied = params.get('denied')

  if (loading) return <SkeletonList count={4} height={110} />
  if (error) return <Alert tone="error">Could not load the dashboard: {error.message}</Alert>

  const cards = data.cards
  const scopeInfo = data.scopeInfo || { provinceWide: true, municipalityNames: [] }
  const scopeName = scopeInfo.municipalityNames.join(', ')

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Dashboard overview"
        description={
          scopeInfo.provinceWide
            ? 'Live counts from published and draft records across the province. Nothing here is estimated.'
            : `Live counts for ${scopeName || 'your municipality'} only. Nothing here is estimated.`
        }
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Overview' }]}
      />
      {denied ? <Alert tone="warning" title="Access restricted">That section requires a permission your account does not have.</Alert> : null}
      {!scopeInfo.provinceWide ? (
        <Alert tone="info" title={`Scoped to ${scopeName || 'your municipality'}`}>
          You can create and edit records for your municipality only. Province-wide records are visible for reference but are
          read-only, because a change there would affect every town. Provincial administrators manage them.
        </Alert>
      ) : null}

      <div className="grid grid-4 mt-4">
        <StatCard
          label="Registered users"
          value={fmtNumber(cards.users)}
          hint={scopeInfo.provinceWide ? `${cards.activeUsers} active` : `${cards.activeUsers} active in your municipality`}
          icon={Users}
        />
        <StatCard label="Published announcements" value={fmtNumber(cards.publishedAnnouncements)} hint={`${cards.draftAnnouncements} awaiting publication`} icon={FileText} />
        <StatCard label="Published services" value={fmtNumber(cards.publishedServices)} hint={`${cards.offices} offices published`} icon={FileText} />
        <StatCard
          label="Pending submissions"
          value={fmtNumber(cards.pendingSubmissions + cards.pendingCorrections)}
          hint={scopeInfo.provinceWide ? `${cards.pendingDataRequests} privacy requests` : 'Citizen reports in your municipality'}
          icon={AlertTriangle}
        />
      </div>

      <div className="grid grid-4 mt-3">
        <StatCard
          label="Municipalities"
          value={cards.municipalities}
          hint={scopeInfo.provinceWide ? 'All six, province-wide' : 'In your assigned scope'}
        />
        <StatCard label="Transparency records" value={fmtNumber(cards.transparencyRecords)} hint={`${cards.publishedDocuments} documents`} />
        <StatCard label="Emergency contacts" value={fmtNumber(cards.emergencyContacts)} hint="Published records only" />
        <StatCard label="Suspended accounts" value={fmtNumber(cards.suspendedUsers)} hint={`${cards.unverifiedUsers} unverified emails`} />
      </div>

      <div className="grid grid-2 mt-5">
        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-2)' }}>Content awaiting review</h2>
          {data.workflowQueue?.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Type</th><th>Title</th><th>Status</th></tr></thead>
                <tbody>
                  {data.workflowQueue.map((item) => (
                    <tr key={`${item.type}-${item.id}`}>
                      <td style={{ textTransform: 'capitalize' }}>{item.type}</td>
                      <td>{item.title}</td>
                      <td><StatusBadge status={item.publication_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">Nothing is waiting for review.</p>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-2)' }}>Recent administrative activity</h2>
          {data.recentAudit?.length ? (
            <ul className="timeline">
              {data.recentAudit.map((entry) => (
                <li key={entry.id}>
                  <div className="text-sm">{entry.action.replace(/[._]/g, ' ')}</div>
                  <div className="text-xs text-muted">{entry.actor || 'system'} · {fmtDateTime(entry.created_at)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No audit entries visible to your role.</p>
          )}
          <Link className="btn btn-outline btn-sm mt-3" to="/admin/audit-logs">View audit logs</Link>
        </div>
      </div>

      <div className="card mt-4">
        <h2 style={{ fontSize: 'var(--text-h4)', marginBottom: 'var(--space-2)' }}>
          {scopeInfo.provinceWide ? 'Content coverage by municipality' : `Content coverage in ${scopeName || 'your municipality'}`}
        </h2>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Municipality</th><th style={{ textAlign: 'right' }}>Announcements</th><th style={{ textAlign: 'right' }}>Services</th><th style={{ textAlign: 'right' }}>Offices</th></tr></thead>
            <tbody>
              {data.contentByMunicipality.map((row) => (
                <tr key={row.slug}>
                  <td>{row.name}</td>
                  <td style={{ textAlign: 'right' }}>{row.announcements}</td>
                  <td style={{ textAlign: 'right' }}>{row.services}</td>
                  <td style={{ textAlign: 'right' }}>{row.offices}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="help mt-2">
          Counts reflect published records assigned to each municipality. Province-wide records are not attributed to a municipality
          {scopeInfo.provinceWide ? '.' : ', and they are not shown in your scoped view.'}
        </p>
      </div>
    </>
  )
}

/* -------------------------------- Analytics ------------------------------ */
export function AdminAnalytics() {
  useDocumentTitle('Analytics')
  const [days, setDays] = useState('30')
  const { data, loading } = useApi(`/admin/analytics?days=${days}`)

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Analytics"
        description="Aggregated operational metrics from real records. No personal data is exposed."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Analytics' }]}
        actions={
          <Select value={days} onChange={(event) => setDays(event.target.value)} aria-label="Reporting period" style={{ minWidth: 160 }}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 12 months</option>
          </Select>
        }
      />
      {loading ? <SkeletonList count={2} height={180} /> : (
        <>
          <div className="grid grid-2 mt-4">
            <div className="card">
              <h2 style={{ fontSize: 'var(--text-h4)' }}>Registrations</h2>
              {data.registrations?.length ? (
                <div className="bar-list mt-2">
                  {data.registrations.map((row) => {
                    const max = Math.max(...data.registrations.map((r) => r.total), 1)
                    return (
                      <div className="bar-row" key={row.day}>
                        <span>{row.day}</span>
                        <div className="bar-track"><div className="bar-fill" style={{ width: `${(row.total / max) * 100}%` }} /></div>
                        <span>{row.total}</span>
                      </div>
                    )
                  })}
                </div>
              ) : <p className="text-sm text-muted">No registrations in this period.</p>}
            </div>
            <div className="card">
              <h2 style={{ fontSize: 'var(--text-h4)' }}>Announcements published</h2>
              {data.announcementsPublished?.length ? (
                <div className="bar-list mt-2">
                  {data.announcementsPublished.map((row) => {
                    const max = Math.max(...data.announcementsPublished.map((r) => r.total), 1)
                    return (
                      <div className="bar-row" key={row.day}>
                        <span>{row.day}</span>
                        <div className="bar-track"><div className="bar-fill" style={{ width: `${(row.total / max) * 100}%` }} /></div>
                        <span>{row.total}</span>
                      </div>
                    )
                  })}
                </div>
              ) : <p className="text-sm text-muted">No announcements published in this period.</p>}
            </div>
          </div>
          <div className="grid grid-2 mt-4">
            <div className="card">
              <h2 style={{ fontSize: 'var(--text-h4)' }}>Citizen reports by status</h2>
              {data.reportsByStatus?.length ? (
                <table className="data mt-2">
                  <thead><tr><th>Status</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                  <tbody>
                    {data.reportsByStatus.map((row) => (
                      <tr key={row.status}><td style={{ textTransform: 'capitalize' }}>{row.status.replace(/_/g, ' ')}</td><td style={{ textAlign: 'right' }}>{row.total}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted mt-2">No citizen reports in this period.</p>
              )}
            </div>
            <div className="card">
              <h2 style={{ fontSize: 'var(--text-h4)' }}>Published services by category</h2>
              <table className="data mt-2">
                <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Published</th></tr></thead>
                <tbody>
                  {data.servicesByCategory?.map((row) => (
                    <tr key={row.name}><td>{row.name}</td><td style={{ textAlign: 'right' }}>{row.total}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="help mt-3">{data.note}</p>
        </>
      )}
    </>
  )
}

/* --------------------------------- Users --------------------------------- */
export function AdminUsers() {
  useDocumentTitle('Users')
  const [params, setParams] = useSearchParams()
  const [term, setTerm] = useState(params.get('q') || '')
  const page = Number(params.get('page') || 1)
  const { data: lookups } = useApi('/lookups')
  const { data, loading, reload } = useApi(
    `/admin/users${query({ q: params.get('q') || '', status: params.get('status') || '', role: params.get('role') || '', municipality: params.get('municipality') || '', page, limit: 20 })}`,
  )

  const setParam = (key, value) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'page') next.delete('page')
      return next
    })
  }

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="User management"
        description="Accounts within your scope. Password hashes, tokens and sessions are never exposed."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Users' }]}
      />
      <div className="card">
        <form className="toolbar" style={{ marginBottom: 0 }} onSubmit={(event) => { event.preventDefault(); setParam('q', term.trim()) }}>
          <input className="input grow" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search by name or email" aria-label="Search users" />
          <Select value={params.get('status') || ''} onChange={(event) => setParam('status', event.target.value)} aria-label="Account status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="pending_verification">Pending verification</option>
            <option value="suspended">Suspended</option>
            <option value="disabled">Disabled</option>
          </Select>
          <Select value={params.get('role') || ''} onChange={(event) => setParam('role', event.target.value)} aria-label="Role">
            <option value="">Any role</option>
            <option value="citizen">Citizen</option>
            <option value="government_employee">Government employee</option>
            <option value="municipal_admin">Municipal administrator</option>
            <option value="provincial_admin">Provincial administrator</option>
            <option value="content_editor">Content editor</option>
            <option value="super_admin">Super administrator</option>
          </Select>
          <Select value={params.get('municipality') || ''} onChange={(event) => setParam('municipality', event.target.value)} aria-label="Municipality">
            <option value="">All municipalities</option>
            {(lookups?.municipalities || []).map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
          </Select>
          <Button type="submit" icon={Search}>Filter</Button>
        </form>
      </div>

      {loading ? <SkeletonList count={3} height={100} /> : (
        <div className="table-wrap mt-4">
          <table className="data">
            <thead>
              <tr><th>User</th><th>Municipality</th><th>Roles</th><th>Status</th><th>Verified</th><th>Registered</th><th /></tr>
            </thead>
            <tbody>
              {(data?.results || []).map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong style={{ display: 'block' }}>{user.name}</strong>
                    <span className="text-xs text-muted break-word">{user.email}</span>
                  </td>
                  <td>{user.municipality_name || '—'}</td>
                  <td className="text-xs">{user.roles ? user.roles.split(',').join(', ').replace(/_/g, ' ') : '—'}</td>
                  <td><StatusBadge status={user.account_status} /></td>
                  <td>{user.email_verified_at ? <Badge tone="success">Yes</Badge> : <Badge tone="warning">No</Badge>}</td>
                  <td className="nowrap text-xs">{fmtDate(user.created_at)}</td>
                  <td style={{ textAlign: 'right' }}><Link className="btn btn-ghost btn-sm" to={`/admin/users/${user.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.results?.length ? <div style={{ padding: '2rem' }}><EmptyState icon={Users} title="No users match these filters" /></div> : null}
        </div>
      )}
      {data ? <Pagination page={data.page} totalPages={data.totalPages} onChange={(next) => setParam('page', String(next))} /> : null}
    </>
  )
}

export function AdminUserDetail() {
  const { id } = useParams()
  const { data, loading, reload } = useApi(`/admin/users/${id}`)
  const { data: rolesData } = useApi('/admin/roles')
  const { data: lookups } = useApi('/lookups')
  const { user: me, can } = useAuth()
  const toast = useToast()
  const [roleForm, setRoleForm] = useState({ roleSlug: '', municipalityId: '', reason: '' })
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  useDocumentTitle(data?.user?.name || 'User')

  if (loading) return <SkeletonList count={2} height={200} />
  if (!data?.user) return <Alert tone="error">User not found or outside your scope.</Alert>

  const target = data.user

  const act = async (path, body, message) => {
    setBusy(true)
    try {
      await api.post(path, body)
      toast.push(message)
      reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="User"
        title={target.name}
        description={target.email}
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Users', to: '/admin/users' }, { label: target.name }]}
        actions={<StatusBadge status={target.account_status} />}
      />

      <div className="grid grid-2 mt-4">
        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Account</h2>
          <dl className="detail-list mt-2">
            <div className="detail-item"><dt>Email</dt><dd className="break-word">{target.email}</dd></div>
            <div className="detail-item"><dt>Mobile</dt><dd>{target.phone || 'Not provided'}</dd></div>
            <div className="detail-item"><dt>Municipality</dt><dd>{target.municipality_name || 'Not set'}</dd></div>
            <div className="detail-item"><dt>Email verified</dt><dd>{target.email_verified_at ? fmtDate(target.email_verified_at) : 'No'}</dd></div>
            <div className="detail-item"><dt>Registered</dt><dd>{fmtDate(target.created_at)}</dd></div>
            <div className="detail-item"><dt>Last sign-in</dt><dd>{target.last_login_at ? fmtDateTime(target.last_login_at) : 'Never'}</dd></div>
          </dl>

          {can('users.suspend') || can('users.activate') ? (
            <div className="row mt-4">
              {target.account_status !== 'suspended' ? (
                <Button variant="danger" size="sm" onClick={() => setConfirm({ type: 'suspend' })}>Suspend account</Button>
              ) : (
                <Button variant="success" size="sm" onClick={() => setConfirm({ type: 'activate' })}>Reactivate account</Button>
              )}
            </div>
          ) : null}
          <p className="help mt-2">Administrators can never view or recover a user's password.</p>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Role assignments</h2>
          <div className="stack-sm mt-2">
            {data.roles.map((role) => (
              <div key={role.id} className="row-between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                <div>
                  <strong style={{ fontSize: '0.875rem' }}>{role.name}</strong>
                  <div className="text-xs text-muted">
                    {role.municipality_name || 'Global scope'} · assigned {fmtDate(role.assigned_at)}
                    {role.expires_at ? ` · expires ${fmtDate(role.expires_at)}` : ''}
                  </div>
                </div>
                <div className="row" style={{ gap: '0.35rem' }}>
                  <Badge tone={role.status === 'active' ? 'success' : 'neutral'}>{role.status}</Badge>
                  {role.status === 'active' && can('users.assign_roles') ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirm({ type: 'revoke', assignment: role })}
                      disabled={Number(target.id) === Number(me?.id) && role.slug === 'super_admin'}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {can('users.assign_roles') ? (
            <form
              className="mt-3"
              onSubmit={(event) => {
                event.preventDefault()
                act(`/admin/users/${target.id}/roles`, { roleSlug: roleForm.roleSlug, municipalityId: roleForm.municipalityId || null, reason: roleForm.reason }, 'Role assigned.')
                setRoleForm({ roleSlug: '', municipalityId: '', reason: '' })
              }}
            >
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>Assign a role</h3>
              <div className="form-grid">
                <Field label="Role" htmlFor="role-slug" required>
                  <Select id="role-slug" value={roleForm.roleSlug} onChange={(event) => setRoleForm({ ...roleForm, roleSlug: event.target.value })} required>
                    <option value="">Select a role</option>
                    {(rolesData?.results || []).map((role) => <option key={role.slug} value={role.slug}>{role.name}</option>)}
                  </Select>
                </Field>
                <Field label="Municipality scope" htmlFor="role-muni" help="Required for municipal administrator.">
                  <Select id="role-muni" value={roleForm.municipalityId} onChange={(event) => setRoleForm({ ...roleForm, municipalityId: event.target.value })}>
                    <option value="">Global / not applicable</option>
                    {(lookups?.municipalities || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                </Field>
                <Field label="Reason" htmlFor="role-reason" className="field-full">
                  <Input id="role-reason" value={roleForm.reason} onChange={(event) => setRoleForm({ ...roleForm, reason: event.target.value })} maxLength={500} placeholder="Recorded in the audit log" />
                </Field>
              </div>
              <Button type="submit" size="sm" loading={busy}>Assign role</Button>
            </form>
          ) : (
            <p className="help mt-3">You do not have permission to assign roles.</p>
          )}
        </div>
      </div>

      <div className="card mt-4">
        <h2 style={{ fontSize: 'var(--text-h4)' }}>Account activity</h2>
        <ul className="timeline mt-2">
          {data.activity.map((item, index) => (
            <li key={index}>
              <div className="text-sm">{item.action.replace(/[._]/g, ' ')}</div>
              <div className="text-xs text-muted">{fmtDateTime(item.created_at)} · {item.result}</div>
            </li>
          ))}
        </ul>
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={
          confirm?.type === 'suspend' ? 'Suspend this account?' : confirm?.type === 'activate' ? 'Reactivate this account?' : 'Revoke this role?'
        }
        message={
          confirm?.type === 'suspend'
            ? 'The user cannot sign in while suspended. Their records and submissions are preserved.'
            : confirm?.type === 'activate'
              ? 'The user will be able to sign in again immediately.'
              : 'Permissions from this assignment stop applying immediately. The last super administrator cannot be removed.'
        }
        confirmLabel={confirm?.type === 'activate' ? 'Reactivate' : confirm?.type === 'suspend' ? 'Suspend' : 'Revoke'}
        tone={confirm?.type === 'activate' ? 'success' : 'danger'}
        busy={busy}
        onConfirm={() => {
          if (confirm.type === 'suspend') act(`/admin/users/${target.id}/status`, { status: 'suspended', reason: 'Suspended by administrator' }, 'Account suspended.')
          else if (confirm.type === 'activate') act(`/admin/users/${target.id}/status`, { status: 'active' }, 'Account reactivated.')
          else
            api
              .del(`/admin/users/${target.id}/roles/${confirm.assignment.id}`)
              .then(() => { toast.push('Role revoked.'); reload() })
              .catch((err) => toast.push(err.message, 'error'))
              .finally(() => { setBusy(false); setConfirm(null) })
        }}
      />
    </>
  )
}

/* --------------------------------- Roles --------------------------------- */
export function AdminRoles() {
  useDocumentTitle('Roles and permissions')
  const { data, loading, reload } = useApi('/admin/roles')
  const { can } = useAuth()
  const toast = useToast()
  const [selected, setSelected] = useState(null)
  const [draft, setDraft] = useState([])
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('roles')
  const [loadingPerms, setLoadingPerms] = useState(false)

  // Load the role's current permission set before editing it.
  useEffect(() => {
    if (!selected) return undefined
    let active = true
    setLoadingPerms(true)
    api
      .get(`/admin/roles/${selected}/permissions`)
      .then((result) => active && setDraft(result.permissionSlugs || []))
      .catch((err) => active && toast.push(err.message, 'error'))
      .finally(() => active && setLoadingPerms(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const role = data?.results?.find((item) => item.id === selected)

  const toggle = (slug) => {
    setDraft((current) => (current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug]))
  }

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Roles and permissions"
        description="Least-privilege role matrix. Changes take effect immediately and are written to the audit log."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Roles' }]}
      />
      <Tabs tabs={[{ value: 'roles', label: 'Roles' }, { value: 'permissions', label: 'Permission catalogue' }]} value={tab} onChange={setTab} />

      {loading ? <SkeletonList count={3} height={100} /> : tab === 'roles' ? (
        <div className="grid grid-3 mt-3">
          {(data?.results || []).map((item) => (
            <div key={item.id} className="card">
              <div className="row-between">
                <Badge tone={item.slug === 'super_admin' ? 'danger' : item.is_system_role ? 'info' : 'neutral'}>{item.is_system_role ? 'System role' : 'Custom'}</Badge>
                <span className="text-xs text-muted">{item.user_count} users</span>
              </div>
              <h3 style={{ fontSize: '1rem', marginTop: '0.35rem' }}>{item.name}</h3>
              <p>{item.description}</p>
              <div className="card-meta"><span>{item.permission_count} permissions</span></div>
              <div className="card-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelected(item.id)
                    setDraft([])
                  }}
                >
                  Manage permissions
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="stack mt-3">
          {(data?.groups || []).map((group) => (
            <div key={group.module} className="card">
              <h3 style={{ fontSize: 'var(--text-h4)' }}>{group.module}</h3>
              <div className="grid grid-4 mt-2">
                {group.items.map((permission) => (
                  <div key={permission.slug} className="text-sm">
                    <code style={{ fontSize: '0.72rem' }}>{permission.slug}</code>
                    <div className="text-xs text-muted">{permission.name}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(role)}
        onClose={() => setSelected(null)}
        title={role ? `Permissions · ${role.name}` : ''}
        wide
        actions={
          <>
            <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
            <Button
              loading={busy}
              disabled={!can('permissions.manage') || role?.slug === 'super_admin' || loadingPerms}
              onClick={async () => {
                setBusy(true)
                try {
                  await api.put(`/admin/roles/${role.id}/permissions`, { permissionSlugs: draft })
                  toast.push('Permissions updated.')
                  setSelected(null)
                  reload()
                } catch (err) {
                  toast.push(err.message, 'error')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Save permissions
            </Button>
          </>
        }
      >
        {role?.slug === 'super_admin' ? (
          <Alert tone="warning">Super administrator permissions are fixed at system level and cannot be reduced here.</Alert>
        ) : null}
        {!can('permissions.manage') ? <Alert tone="info">You can review permissions but not change them.</Alert> : null}
        <div className="stack mt-2">
          {(data?.groups || []).map((group) => (
            <fieldset key={group.module} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.75rem' }}>
              <legend className="text-xs" style={{ fontWeight: 700, padding: '0 0.35rem' }}>{group.module}</legend>
              <div className="grid grid-2">
                {group.items.map((permission) => (
                  <label key={permission.slug} className="checkbox-row" style={{ marginBottom: '0.35rem' }}>
                    <input
                      type="checkbox"
                      checked={draft.includes(permission.slug)}
                      onChange={() => toggle(permission.slug)}
                      disabled={role?.slug === 'super_admin'}
                    />
                    <span>
                      <span style={{ fontSize: '0.8rem' }}>{permission.name}</span>
                      <span className="help" style={{ display: 'block' }}>{permission.slug}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <p className="help mt-2">
          Saving replaces the role's permission set. Users with this role lose removed permissions immediately.
        </p>
      </Modal>
    </>
  )
}

/* ------------------------------- Audit logs ------------------------------ */
export function AdminAuditLogs() {
  useDocumentTitle('Audit logs')
  const [params, setParams] = useSearchParams()
  const page = Number(params.get('page') || 1)
  const [term, setTerm] = useState('')
  const { data, loading } = useApi(`/admin/audit-logs${query({ q: params.get('q') || '', module: params.get('module') || '', page, limit: 25 })}`)
  const { can } = useAuth()

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Audit logs"
        description="Append-only record of administrative actions. Entries cannot be edited or deleted from the dashboard."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Audit logs' }]}
        actions={
          can('audit_logs.export') ? (
            <a className="btn btn-outline" href="/api/admin/audit-logs/export"><Download size={15} aria-hidden="true" /> Export CSV</a>
          ) : null
        }
      />
      <div className="card">
        <form className="toolbar" style={{ marginBottom: 0 }} onSubmit={(event) => { event.preventDefault(); setParams(term ? { q: term } : {}) }}>
          <input className="input grow" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search action or module" aria-label="Search audit logs" />
          <Button type="submit">Filter</Button>
        </form>
      </div>
      {loading ? <SkeletonList count={2} height={140} /> : (
        <div className="table-wrap mt-4">
          <table className="data">
            <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Module</th><th>Result</th><th>IP</th></tr></thead>
            <tbody>
              {(data?.results || []).map((row) => (
                <tr key={row.id}>
                  <td className="nowrap text-xs">{fmtDateTime(row.created_at)}</td>
                  <td>{row.actor || 'system'}<div className="text-xs text-muted">{row.actor_email}</div></td>
                  <td className="text-xs">{row.action}</td>
                  <td className="text-xs">{row.module}</td>
                  <td><Badge tone={row.result === 'success' ? 'success' : 'danger'}>{row.result}</Badge></td>
                  <td className="text-xs">{row.ip_address || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.results?.length ? <div style={{ padding: '2rem' }}><EmptyState title="No audit entries match" /></div> : null}
        </div>
      )}
      {data ? <Pagination page={data.page} totalPages={data.totalPages} onChange={(next) => setParams({ page: String(next) })} /> : null}
    </>
  )
}

/* -------------------------------- Settings ------------------------------- */
export function AdminSettings() {
  useDocumentTitle('System settings')
  const { data, loading, reload } = useApi('/admin/settings')
  const toast = useToast()
  const [values, setValues] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (data?.results) setValues(Object.fromEntries(data.results.map((setting) => [setting.setting_key, setting.setting_value ?? ''])))
  }, [data])

  const groups = [...new Set((data?.results || []).map((setting) => setting.setting_group))]

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="System settings"
        description="Typed platform configuration. Values are validated and every change is audited. Secrets are never stored in these fields."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Settings' }]}
        actions={
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const settings = (data?.results || [])
                  .filter((setting) => String(values[setting.setting_key] ?? '') !== String(setting.setting_value ?? ''))
                  .map((setting) => ({ key: setting.setting_key, value: values[setting.setting_key] ?? '' }))
                if (!settings.length) {
                  toast.push('No changes to save.', 'info')
                  return
                }
                await api.put('/admin/settings', { settings })
                toast.push('Settings saved.')
                reload()
              } catch (err) {
                toast.push(err.message, 'error')
              } finally {
                setBusy(false)
              }
            }}
          >
            Save changes
          </Button>
        }
      />
      {loading ? <SkeletonList count={3} height={140} /> : (
        <div className="stack mt-4">
          {groups.map((group) => (
            <div key={group} className="card">
              <h2 style={{ fontSize: 'var(--text-h4)', textTransform: 'capitalize' }}>{group}</h2>
              <div className="form-grid mt-2">
                {(data.results || []).filter((setting) => setting.setting_group === group).map((setting) => (
                  <Field
                    key={setting.setting_key}
                    label={setting.description || setting.setting_key}
                    htmlFor={setting.setting_key}
                    help={`${setting.setting_key} · ${setting.is_public ? 'public' : 'administrator only'}`}
                    className={setting.setting_type === 'string' && (values[setting.setting_key] || '').length > 60 ? 'field-full' : ''}
                  >
                    {setting.setting_type === 'boolean' ? (
                      <Select
                        id={setting.setting_key}
                        value={String(values[setting.setting_key] ?? 'false')}
                        onChange={(event) => setValues({ ...values, [setting.setting_key]: event.target.value })}
                      >
                        <option value="true">Enabled</option>
                        <option value="false">Disabled</option>
                      </Select>
                    ) : setting.setting_key.includes('description') || setting.setting_key.includes('notice') || setting.setting_key.includes('tagline') ? (
                      <Textarea
                        id={setting.setting_key}
                        value={values[setting.setting_key] ?? ''}
                        onChange={(event) => setValues({ ...values, [setting.setting_key]: event.target.value })}
                        style={{ minHeight: 80 }}
                      />
                    ) : (
                      <Input
                        id={setting.setting_key}
                        type={setting.setting_type === 'number' ? 'number' : 'text'}
                        value={values[setting.setting_key] ?? ''}
                        onChange={(event) => setValues({ ...values, [setting.setting_key]: event.target.value })}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </div>
          ))}
          <Alert tone="info" title="Secrets are not settings">
            API keys, session secrets and provider credentials must be supplied through server environment variables or the deployment's
            secret manager. They are never editable here and never returned to the browser.
          </Alert>
        </div>
      )}
    </>
  )
}

/* -------------------------------- Reports -------------------------------- */
export function AdminReports() {
  useDocumentTitle('Citizen reports')
  const [tab, setTab] = useState('reports')
  const { data, loading, reload } = useApi(tab === 'reports' ? '/admin/reports' : '/admin/corrections')
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const { data: lookups } = useApi('/lookups')

  const update = async (patch) => {
    setBusy(true)
    try {
      await api.patch(tab === 'reports' ? `/admin/reports/${selected.id}` : `/admin/corrections/${selected.id}`, patch)
      toast.push('Updated.')
      setSelected(null)
      reload()
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Participation"
        title="Reports and corrections"
        description="Citizen submissions and public correction reports. Submissions do not create official government cases."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Reports' }]}
      />
      <Tabs
        tabs={[{ value: 'reports', label: 'Citizen reports' }, { value: 'corrections', label: 'Correction reports' }]}
        value={tab}
        onChange={(value) => { setTab(value); setSelected(null) }}
      />

      {loading ? <SkeletonList count={2} height={120} /> : (
        <div className="table-wrap">
          <table className="data">
            {tab === 'reports' ? (
              <>
                <thead><tr><th>Reference</th><th>Type</th><th>Subject</th><th>Municipality</th><th>Status</th><th>Submitted</th><th /></tr></thead>
                <tbody>
                  {(data?.results || []).map((report) => (
                    <tr key={report.id}>
                      <td className="nowrap text-xs">{report.reference}</td>
                      <td style={{ textTransform: 'capitalize' }}>{report.kind}</td>
                      <td>{report.subject}</td>
                      <td>{report.municipality_name || '—'}</td>
                      <td><StatusBadge status={report.status} /></td>
                      <td className="nowrap text-xs">{fmtDate(report.created_at)}</td>
                      <td style={{ textAlign: 'right' }}><Button variant="ghost" size="sm" onClick={() => setSelected(report)}>Review</Button></td>
                    </tr>
                  ))}
                </tbody>
              </>
            ) : (
              <>
                <thead><tr><th>Reference</th><th>Target</th><th>Field</th><th>Status</th><th>Submitted</th><th /></tr></thead>
                <tbody>
                  {(data?.results || []).map((report) => (
                    <tr key={report.id}>
                      <td className="nowrap text-xs">{report.reference}</td>
                      <td>{report.target_label || report.target_type}</td>
                      <td className="text-xs">{report.field || '—'}</td>
                      <td><StatusBadge status={report.status} /></td>
                      <td className="nowrap text-xs">{fmtDate(report.created_at)}</td>
                      <td style={{ textAlign: 'right' }}><Button variant="ghost" size="sm" onClick={() => setSelected(report)}>Review</Button></td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
          {!data?.results?.length ? <div style={{ padding: '2rem' }}><EmptyState icon={CheckCircle2} title="Nothing to review" description="New submissions appear here." /></div> : null}
        </div>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `Review ${selected.reference}` : ''}
        actions={
          selected ? (
            <>
              <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
              <Button
                variant="success"
                loading={busy}
                onClick={() =>
                  update(
                    tab === 'reports'
                      ? { status: 'resolved', resolution: 'Reviewed by an administrator.' }
                      : { status: 'resolved', notes: 'Correction reviewed by an administrator.' },
                  )
                }
              >
                Mark resolved
              </Button>
            </>
          ) : null
        }
      >
        {selected ? (
          <>
            <dl className="detail-list">
              <div className="detail-item"><dt>Type</dt><dd>{selected.kind || selected.target_type}</dd></div>
              <div className="detail-item"><dt>Status</dt><dd><StatusBadge status={selected.status} /></dd></div>
              {selected.municipality_name ? <div className="detail-item"><dt>Municipality</dt><dd>{selected.municipality_name}</dd></div> : null}
              {selected.contact_email ? <div className="detail-item"><dt>Contact</dt><dd className="break-word">{selected.contact_email}</dd></div> : null}
            </dl>
            <h3 style={{ fontSize: 'var(--text-h4)', marginTop: '1rem' }}>{selected.subject || selected.target_label}</h3>
            <p className="text-sm text-muted" style={{ whiteSpace: 'pre-line' }}>{selected.description}</p>
            <Alert tone="warning" title="Privacy">
              Only use submitter contact details to respond to this submission. Do not publish personal information.
            </Alert>
            <div className="row mt-3">
              <Button
                variant="outline"
                size="sm"
                loading={busy}
                onClick={() => update(tab === 'reports' ? { status: 'under_review' } : { status: 'under_review' })}
              >
                Mark under review
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={busy}
                onClick={() => update(tab === 'reports' ? { status: 'archived' } : { status: 'rejected', notes: 'Not actionable' })}
              >
                Archive
              </Button>
            </div>
          </>
        ) : null}
      </Modal>
    </>
  )
}

/* -------------------------------- Privacy -------------------------------- */
export function AdminPrivacy() {
  useDocumentTitle('Privacy management')
  const [tab, setTab] = useState('requests')
  const { data: requests, loading: loadingRequests, reload: reloadRequests } = useApi(tab === 'requests' ? '/admin/data-requests' : null)
  const { data: incidents, reload: reloadIncidents } = useApi(tab === 'incidents' ? '/admin/privacy-incidents' : null)
  const { data: retention, reload: reloadRetention } = useApi(tab === 'retention' ? '/admin/retention-rules' : null)
  const { data: security, loading: loadingSecurity } = useApi(tab === 'security' ? '/admin/security-reports' : null)
  const [selected, setSelected] = useState(null)
  const [incidentForm, setIncidentForm] = useState({ description: '', severity: 'medium' })
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  return (
    <>
      <PageHeader
        eyebrow="Privacy"
        title="Privacy management"
        description="Data subject requests, consent oversight, retention rules and privacy incidents. Restricted to authorised roles."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Privacy' }]}
      />
      <Tabs
        tabs={[
          { value: 'requests', label: 'Data requests' },
          { value: 'incidents', label: 'Privacy incidents' },
          { value: 'security', label: 'Security reports' },
          { value: 'retention', label: 'Retention rules' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'requests' ? (
        loadingRequests ? <SkeletonList count={2} height={120} /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Reference</th><th>Requester</th><th>Type</th><th>Status</th><th>Submitted</th><th /></tr></thead>
              <tbody>
                {(requests?.results || []).map((request) => (
                  <tr key={request.id}>
                    <td className="nowrap text-xs">{request.reference}</td>
                    <td>{request.account_name || request.requester_name}<div className="text-xs text-muted break-word">{request.requester_email}</div></td>
                    <td style={{ textTransform: 'capitalize' }}>{request.category.replace(/_/g, ' ')}</td>
                    <td><StatusBadge status={request.status} /></td>
                    <td className="nowrap text-xs">{fmtDate(request.created_at)}</td>
                    <td style={{ textAlign: 'right' }}><Button variant="ghost" size="sm" onClick={() => setSelected(request)}>Review</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!requests?.results?.length ? <div style={{ padding: '2rem' }}><EmptyState icon={ShieldCheck} title="No data requests" /></div> : null}
          </div>
        )
      ) : null}

      {tab === 'incidents' ? (
        <>
          <div className="card mb-4">
            <h2 style={{ fontSize: 'var(--text-h4)' }}>Record an incident</h2>
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                setBusy(true)
                try {
                  await api.post('/admin/privacy-incidents', incidentForm)
                  toast.push('Incident recorded privately.')
                  setIncidentForm({ description: '', severity: 'medium' })
                  reloadIncidents()
                } catch (err) {
                  toast.push(err.message, 'error')
                } finally {
                  setBusy(false)
                }
              }}
            >
              <div className="form-grid">
                <Field label="Description" htmlFor="incident-desc" required className="field-full">
                  <Textarea id="incident-desc" value={incidentForm.description} onChange={(event) => setIncidentForm({ ...incidentForm, description: event.target.value })} required minLength={10} maxLength={4000} />
                </Field>
                <Field label="Severity" htmlFor="incident-sev">
                  <Select id="incident-sev" value={incidentForm.severity} onChange={(event) => setIncidentForm({ ...incidentForm, severity: event.target.value })}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </Select>
                </Field>
              </div>
              <Button type="submit" size="sm" loading={busy}>Record incident</Button>
            </form>
            <Alert tone="warning" title="Not every incident is a breach">
              Assess reporting obligations under RA 10173 and NPC rules separately. Incident records are never public.
            </Alert>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Reference</th><th>Severity</th><th>Status</th><th>Discovered</th><th /></tr></thead>
              <tbody>
                {(incidents?.results || []).map((incident) => (
                  <tr key={incident.id}>
                    <td className="text-xs nowrap">{incident.reference}</td>
                    <td><Badge tone={incident.severity === 'critical' || incident.severity === 'high' ? 'danger' : 'warning'}>{incident.severity}</Badge></td>
                    <td style={{ textTransform: 'capitalize' }}>{incident.status.replace(/_/g, ' ')}</td>
                    <td className="text-xs nowrap">{fmtDateTime(incident.discovered_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          try {
                            await api.patch(`/admin/privacy-incidents/${incident.id}`, { status: 'under_investigation' })
                            toast.push('Incident updated.')
                            reloadIncidents()
                          } catch (err) {
                            toast.push(err.message, 'error')
                          }
                        }}
                      >
                        Investigate
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!incidents?.results?.length ? <div style={{ padding: '2rem' }}><EmptyState title="No incidents recorded" /></div> : null}
          </div>
        </>
      ) : null}

      {tab === 'security' ? (
        loadingSecurity ? <SkeletonList count={2} height={120} /> : (
          <div className="stack">
            {(security?.results || []).map((report) => (
              <div className="card" key={report.id}>
                <div className="row-between">
                  <Badge>{report.reference}</Badge>
                  <span className="text-xs text-muted">{fmtDateTime(report.created_at)}</span>
                </div>
                <h3 style={{ fontSize: '1rem', marginTop: '0.35rem' }}>{report.title}</h3>
                <p className="text-sm text-muted" style={{ whiteSpace: 'pre-line' }}>{report.description}</p>
                {report.affected_area ? <div className="card-meta"><span>Affected: {report.affected_area}</span></div> : null}
                <Alert tone="warning">Security reports are confidential. Never publish them or share details outside authorised personnel.</Alert>
              </div>
            ))}
            {!security?.results?.length ? <EmptyState icon={ShieldCheck} title="No security reports" description="Reports submitted through the public channel appear here." /> : null}
          </div>
        )
      ) : null}

      {tab === 'retention' ? (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Data category</th><th>Purpose</th><th>Retention</th><th>Legal basis</th><th>Approval</th><th /></tr></thead>
            <tbody>
              {(retention?.results || []).map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.data_category}</td>
                  <td className="text-xs">{rule.purpose}</td>
                  <td className="text-xs">{rule.retention_period}</td>
                  <td className="text-xs">{rule.legal_basis}</td>
                  <td><Badge tone={rule.approval_status === 'approved' ? 'success' : 'warning'}>{rule.approval_status}</Badge></td>
                  <td style={{ textAlign: 'right' }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          await api.patch(`/admin/retention-rules/${rule.id}`, { approvalStatus: 'approved' })
                          toast.push('Retention rule marked approved.')
                          reloadRetention()
                        } catch (err) {
                          toast.push(err.message, 'error')
                        }
                      }}
                    >
                      Approve
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `Data request ${selected.reference}` : ''}
        actions={
          selected ? (
            <>
              <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
              <Button
                variant="success"
                loading={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await api.patch(`/admin/data-requests/${selected.id}`, {
                      status: 'completed',
                      resolution: 'Request reviewed and completed by an administrator.',
                    })
                    toast.push('Request completed.')
                    setSelected(null)
                    reloadRequests()
                  } catch (err) {
                    toast.push(err.message, 'error')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Mark completed
              </Button>
            </>
          ) : null
        }
      >
        {selected ? (
          <>
            <dl className="detail-list">
              <div className="detail-item"><dt>Type</dt><dd style={{ textTransform: 'capitalize' }}>{selected.category.replace(/_/g, ' ')}</dd></div>
              <div className="detail-item"><dt>Status</dt><dd><StatusBadge status={selected.status} /></dd></div>
              <div className="detail-item"><dt>Requester</dt><dd className="break-word">{selected.requester_email}</dd></div>
              <div className="detail-item"><dt>Submitted</dt><dd>{fmtDateTime(selected.created_at)}</dd></div>
            </dl>
            <p className="text-sm text-muted mt-3" style={{ whiteSpace: 'pre-line' }}>{selected.description}</p>
            <Alert tone="warning" title="Verify identity first">
              Confirm the requester's identity proportionately before releasing or changing personal information.
            </Alert>
          </>
        ) : null}
      </Modal>
    </>
  )
}

/* ----------------------------- Municipalities ---------------------------- */
export function AdminMunicipalities() {
  useDocumentTitle('Municipalities')
  const { data, loading, reload } = useApi('/admin/municipalities')
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const { can } = useAuth()

  const open = (municipality) => {
    setSelected(municipality)
    setForm({
      description: municipality.description || '',
      overview: municipality.overview || '',
      officialWebsite: municipality.official_website || '',
      email: municipality.email || '',
      phone: municipality.phone || '',
      officeAddress: municipality.office_address || '',
      population: municipality.population || '',
      sourceReference: municipality.source_reference || '',
      sourceUrl: municipality.source_url || '',
      verificationStatus: municipality.verification_status || 'pending',
    })
  }

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Municipalities"
        description="Municipality information, scope and content coverage. Municipal administrators can only edit their own municipality."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Municipalities' }]}
      />
      {loading ? <SkeletonList count={3} height={110} /> : (
        <div className="grid grid-3 mt-3">
          {(data?.results || []).map((municipality) => (
            <div key={municipality.id} className="card">
              <div className="row-between">
                <Badge>{municipality.municipal_code || 'No code'}</Badge>
                <Badge tone={municipality.verification_status === 'verified' ? 'success' : 'warning'}>{municipality.verification_status}</Badge>
              </div>
              <h3 style={{ fontSize: '1rem', marginTop: '0.35rem' }}>{municipality.name}</h3>
              <p>{municipality.description}</p>
              <div className="card-meta">
                <span>{municipality.announcements} announcements</span>
                <span>{municipality.services} services</span>
                <span>{municipality.offices} offices</span>
                <span>{municipality.administrators} admins</span>
              </div>
              <div className="card-actions">
                {can('municipalities.manage') ? <Button variant="outline" size="sm" onClick={() => open(municipality)}>Edit information</Button> : null}
                <Link className="btn btn-ghost btn-sm" to={`/municipalities/${municipality.slug}`}>View public page</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.name} information` : ''}
        wide
        actions={
          <>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await api.patch(`/admin/municipalities/${selected.id}`, {
                    ...form,
                    population: form.population === '' ? null : form.population,
                  })
                  toast.push('Municipality updated.')
                  setSelected(null)
                  reload()
                } catch (err) {
                  toast.push(err.message, 'error')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Alert tone="info">
          Only publish verified public information. Population figures require a reliable published source. Never invent contact details.
        </Alert>
        <div className="form-grid mt-3">
          <Field label="Description" htmlFor="muni-desc" className="field-full">
            <Textarea id="muni-desc" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={2000} />
          </Field>
          <Field label="Overview" htmlFor="muni-overview" className="field-full">
            <Textarea id="muni-overview" value={form.overview} onChange={(event) => setForm({ ...form, overview: event.target.value })} maxLength={5000} />
          </Field>
          <Field label="Official website" htmlFor="muni-web">
            <Input id="muni-web" value={form.officialWebsite} onChange={(event) => setForm({ ...form, officialWebsite: event.target.value })} placeholder="https://" maxLength={500} />
          </Field>
          <Field label="Public email" htmlFor="muni-email">
            <Input id="muni-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} maxLength={200} />
          </Field>
          <Field label="Public telephone" htmlFor="muni-phone">
            <Input id="muni-phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} maxLength={40} />
          </Field>
          <Field label="Office address" htmlFor="muni-address">
            <Input id="muni-address" value={form.officeAddress} onChange={(event) => setForm({ ...form, officeAddress: event.target.value })} maxLength={300} />
          </Field>
          <Field label="Population" htmlFor="muni-pop" help="Leave empty unless a reliable source is cited.">
            <Input id="muni-pop" type="number" value={form.population} onChange={(event) => setForm({ ...form, population: event.target.value })} />
          </Field>
          <Field label="Verification status" htmlFor="muni-verif">
            <Select id="muni-verif" value={form.verificationStatus} onChange={(event) => setForm({ ...form, verificationStatus: event.target.value })}>
              <option value="pending">Pending</option>
              <option value="verified">Verified</option>
              <option value="unverified">Unverified</option>
            </Select>
          </Field>
          <Field label="Source reference" htmlFor="muni-source">
            <Input id="muni-source" value={form.sourceReference} onChange={(event) => setForm({ ...form, sourceReference: event.target.value })} maxLength={500} />
          </Field>
          <Field label="Source URL" htmlFor="muni-source-url">
            <Input id="muni-source-url" value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} placeholder="https://" maxLength={500} />
          </Field>
        </div>
      </Modal>
    </>
  )
}

/* ------------------------------- Admin profile --------------------------- */
export function AdminProfile() {
  useDocumentTitle('Administrator profile')
  const { user, profile, roles } = useAuth()

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="My administrator profile"
        description="Your own account details and assigned scopes."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Profile' }]}
        actions={<Link className="btn btn-outline" to="/dashboard/profile/edit">Edit profile</Link>}
      />
      <div className="grid grid-2 mt-4">
        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Account</h2>
          <dl className="detail-list mt-2">
            <div className="detail-item"><dt>Name</dt><dd>{user?.name}</dd></div>
            <div className="detail-item"><dt>Email</dt><dd className="break-word">{user?.email}</dd></div>
            <div className="detail-item"><dt>Municipality</dt><dd>{profile?.municipality_name || 'Not set'}</dd></div>
            <div className="detail-item"><dt>Status</dt><dd><StatusBadge status={user?.accountStatus} /></dd></div>
          </dl>
          <div className="row mt-3">
            <Link className="btn btn-outline btn-sm" to="/dashboard/account">Change password</Link>
            <Link className="btn btn-outline btn-sm" to="/dashboard/preferences">Preferences</Link>
          </div>
        </div>
        <div className="card">
          <h2 style={{ fontSize: 'var(--text-h4)' }}>Assigned roles</h2>
          <div className="row mt-2">
            {roles?.map((role) => <Badge key={role} tone="info">{role.replace(/_/g, ' ')}</Badge>)}
          </div>
          <p className="help mt-3">
            Role assignments cannot be changed from this page. Another authorised administrator must make changes, which are audited.
          </p>
        </div>
      </div>
      <Alert tone="info" title="Least privilege">
        Administrators can only act within their assigned scope. Hiding a button never replaces a backend permission check.
      </Alert>
    </>
  )
}
