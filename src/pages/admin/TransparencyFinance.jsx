import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDocumentTitle } from '../../hooks'
import { Alert, Badge, Button, Field, Input, Select, SkeletonList, Textarea, useToast } from '../../components/ui'
import { PageHeader } from '../../components/layout'

const emptyRecord = {
  recordType: 'budget',
  title: '',
  description: '',
  governmentLevel: 'municipal',
  municipalityId: '',
  fiscalYear: new Date().getFullYear(),
  periodType: 'annual',
  periodLabel: `FY ${new Date().getFullYear()}`,
  categoryKey: 'general_public_services',
  officialClassification: '',
  department: '',
  counterparty: '',
  amountPesos: '',
  amountKind: 'approved',
  sourceInstitution: '',
  sourceTitle: '',
  sourceUrl: '',
  sourcePublishedOn: '',
  limitations: '',
  identifier: '',
  location: '',
  titleNumber: '',
  stage: '',
  programName: '',
  rateDescription: '',
  assessmentBasis: '',
  arrangement: '',
  quantity: '',
  quantityLabel: '',
  principalPesos: '',
  outstandingPesos: '',
  interestRate: '',
  termStart: '',
  termEnd: '',
  maturityDate: '',
}

const LABELS = {
  draft: 'Draft',
  awaiting_source: 'Awaiting source',
  under_review: 'Under review',
  verified: 'Verified',
  approved: 'Approved',
  published: 'Published',
  requires_correction: 'Requires correction',
  archived: 'Archived',
}

export function AdminTransparencyFinance() {
  useDocumentTitle('Financial transparency administration')
  const toast = useToast()
  const [data, setData] = useState(null)
  const [form, setForm] = useState(emptyRecord)
  const [importText, setImportText] = useState('')
  const [importMeta, setImportMeta] = useState({ recordType: 'budget', governmentLevel: 'municipal', municipalityId: '', filename: 'import.json' })
  const [period, setPeriod] = useState({ governmentLevel: 'municipal', municipalityId: '', fiscalYear: new Date().getFullYear(), periodType: 'annual', periodLabel: `FY ${new Date().getFullYear()}` })

  const load = async () => {
    try {
      setData(await api.get('/admin/transparency/finance'))
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    try {
      const amountCents = Math.round(Number(form.amountPesos || 0) * 100)
      const optionalNumber = (value) => (value === '' || value === undefined ? undefined : Number(value))
      const optionalText = (value) => (value === '' ? undefined : value)
      const result = await api.post('/admin/transparency/finance/records', {
        ...form,
        municipalityId: form.governmentLevel === 'municipal' && form.municipalityId ? Number(form.municipalityId) : null,
        fiscalYear: Number(form.fiscalYear),
        amountCents,
        amountPesos: undefined,
        description: form.description || undefined,
        sourceUrl: form.sourceUrl || undefined,
        sourcePublishedOn: form.sourcePublishedOn || undefined,
        principalCents: form.principalPesos === '' ? undefined : Math.round(Number(form.principalPesos) * 100),
        outstandingBalanceCents: form.outstandingPesos === '' ? undefined : Math.round(Number(form.outstandingPesos) * 100),
        interestRate: optionalNumber(form.interestRate),
        quantity: optionalNumber(form.quantity),
        quantityLabel: optionalText(form.quantityLabel),
        identifier: optionalText(form.identifier),
        location: optionalText(form.location),
        titleNumber: optionalText(form.titleNumber),
        stage: optionalText(form.stage),
        programName: optionalText(form.programName),
        rateDescription: optionalText(form.rateDescription),
        assessmentBasis: optionalText(form.assessmentBasis),
        arrangement: optionalText(form.arrangement),
        termStart: optionalText(form.termStart),
        termEnd: optionalText(form.termEnd),
        maturityDate: optionalText(form.maturityDate),
        principalPesos: undefined,
        outstandingPesos: undefined,
      })
      toast.push(result.message)
      setForm({ ...emptyRecord, municipalityId: form.municipalityId })
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const move = async (row, action) => {
    const note = action === 'correction' ? window.prompt('What requires correction?') || '' : undefined
    try {
      const result = await api.post(`/admin/transparency/finance/records/${row.id}/transition`, { action, note })
      toast.push(result.message)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  const runImport = async () => {
    try {
      const rows = JSON.parse(importText)
      if (!Array.isArray(rows)) throw new Error('Paste a JSON array of rows.')
      const result = await api.post('/admin/transparency/finance/imports', {
        ...importMeta,
        municipalityId: importMeta.governmentLevel === 'municipal' && importMeta.municipalityId ? Number(importMeta.municipalityId) : null,
        rows,
      })
      toast.push(result.message)
      await load()
    } catch (err) {
      toast.push(err.message, 'error')
    }
  }

  return (
    <div className="section-tight">
      <PageHeader
        eyebrow="Administration"
        title="Financial transparency"
        description="Encode only public, source-referenced figures. Nothing published here is generated or estimated by BetterGo."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Transparency', to: '/admin/transparency' }, { label: 'Finance' }]}
      />
      <Alert tone="warning" title="Publication gate">{data?.note || 'Loading records.'}</Alert>

      {!data ? <SkeletonList count={3} height={70} /> : (
        <>
          <div className="grid grid-4">
            <div className="card"><div className="side-label">Records in scope</div><strong>{data.summary.total}</strong></div>
            <div className="card"><div className="side-label">Drafts / corrections</div><strong>{data.summary.drafts}</strong></div>
            <div className="card"><div className="side-label">Awaiting verification</div><strong>{data.summary.awaitingVerification}</strong></div>
            <div className="card"><div className="side-label">Published</div><strong>{data.summary.published}</strong></div>
          </div>

          <div className="card">
            <h2 className="side-label">New financial record (saved as a draft)</h2>
            <div className="grid grid-2">
              <Field label="Record type">
                <Select value={form.recordType} onChange={(e) => setForm({ ...form, recordType: e.target.value })}>
                  {Object.entries(data.modules).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
              </Field>
              <Field label="Amount classification">
                <Select value={form.amountKind} onChange={(e) => setForm({ ...form, amountKind: e.target.value })}>
                  {Object.entries(data.amountKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="What the document says"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid grid-2">
              <Field label="Government level">
                <Select value={form.governmentLevel} onChange={(e) => setForm({ ...form, governmentLevel: e.target.value, municipalityId: '' })}>
                  <option value="municipal">Municipal</option>
                  <option value="provincial">Provincial</option>
                </Select>
              </Field>
              <Field label="Municipality">
                <Select value={form.municipalityId} disabled={form.governmentLevel === 'provincial'} onChange={(e) => setForm({ ...form, municipalityId: e.target.value })}>
                  <option value="">Select municipality</option>
                  {data.entities.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </Field>
            </div>
            <div className="grid grid-3">
              <Field label="Fiscal year"><Input value={form.fiscalYear} onChange={(e) => setForm({ ...form, fiscalYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></Field>
              <Field label="Period type">
                <Select value={form.periodType} onChange={(e) => setForm({ ...form, periodType: e.target.value })}>
                  <option value="annual">Annual</option><option value="quarterly">Quarterly</option><option value="monthly">Monthly</option>
                </Select>
              </Field>
              <Field label="Period label"><Input value={form.periodLabel} onChange={(e) => setForm({ ...form, periodLabel: e.target.value })} /></Field>
            </div>
            <Field label="Financial category">
              <Select value={form.categoryKey} onChange={(e) => setForm({ ...form, categoryKey: e.target.value })}>
                {data.categories.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
              </Select>
            </Field>
            <div className="grid grid-2">
              <Field label="Official classification (kept verbatim)"><Input value={form.officialClassification} onChange={(e) => setForm({ ...form, officialClassification: e.target.value })} /></Field>
              <Field label="Department or program"><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></Field>
            </div>
            <div className="grid grid-2">
              <Field label="Amount in pesos"><Input value={form.amountPesos} onChange={(e) => setForm({ ...form, amountPesos: e.target.value.replace(/[^\d.-]/g, '') })} placeholder="0.00" /></Field>
              <Field label="Counterparty or payee (if documented)"><Input value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} /></Field>
            </div>
            <div className="grid grid-2">
              <Field label="Source institution"><Input value={form.sourceInstitution} onChange={(e) => setForm({ ...form, sourceInstitution: e.target.value })} /></Field>
              <Field label="Original document title"><Input value={form.sourceTitle} onChange={(e) => setForm({ ...form, sourceTitle: e.target.value })} /></Field>
            </div>
            <div className="grid grid-2">
              <Field label="Original source URL"><Input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} /></Field>
              <Field label="Source published on"><Input type="date" value={form.sourcePublishedOn} onChange={(e) => setForm({ ...form, sourcePublishedOn: e.target.value })} /></Field>
            </div>
            <h3 className="side-label">Specialist details</h3>
            <div className="grid grid-2">
              <Field label="Identifier (record, contract, asset or parcel number)"><Input value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} /></Field>
              <Field label="Stage or status"><Input value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} placeholder="awarded, repayment, recorded transaction…" /></Field>
            </div>
            <div className="grid grid-2">
              <Field label="Location"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
              <Field label="Program name"><Input value={form.programName} onChange={(e) => setForm({ ...form, programName: e.target.value })} /></Field>
            </div>
            <div className="grid grid-3">
              <Field label="Principal (PHP)"><Input value={form.principalPesos} onChange={(e) => setForm({ ...form, principalPesos: e.target.value.replace(/[^\d.-]/g, '') })} /></Field>
              <Field label="Outstanding balance (PHP)"><Input value={form.outstandingPesos} onChange={(e) => setForm({ ...form, outstandingPesos: e.target.value.replace(/[^\d.-]/g, '') })} /></Field>
              <Field label="Interest rate (%)"><Input value={form.interestRate} onChange={(e) => setForm({ ...form, interestRate: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
            </div>
            <div className="grid grid-4">
              <Field label="Term start"><Input type="date" value={form.termStart} onChange={(e) => setForm({ ...form, termStart: e.target.value })} /></Field>
              <Field label="Term end"><Input type="date" value={form.termEnd} onChange={(e) => setForm({ ...form, termEnd: e.target.value })} /></Field>
              <Field label="Maturity date"><Input type="date" value={form.maturityDate} onChange={(e) => setForm({ ...form, maturityDate: e.target.value })} /></Field>
              <Field label="Title number"><Input value={form.titleNumber} onChange={(e) => setForm({ ...form, titleNumber: e.target.value })} /></Field>
            </div>
            <div className="grid grid-3">
              <Field label="Quantity"><Input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value.replace(/[^\d]/g, '') })} /></Field>
              <Field label="Quantity unit"><Input value={form.quantityLabel} onChange={(e) => setForm({ ...form, quantityLabel: e.target.value })} placeholder="personnel, households, square metres" /></Field>
              <Field label="Rate description"><Input value={form.rateDescription} onChange={(e) => setForm({ ...form, rateDescription: e.target.value })} /></Field>
            </div>
            <Field label="Assessment basis"><Input value={form.assessmentBasis} onChange={(e) => setForm({ ...form, assessmentBasis: e.target.value })} /></Field>
            <Field label="Arrangement (guarantee, concession terms, risk allocation)"><Textarea rows={2} value={form.arrangement} onChange={(e) => setForm({ ...form, arrangement: e.target.value })} /></Field>
            <Field label="Known limitations"><Textarea rows={2} value={form.limitations} onChange={(e) => setForm({ ...form, limitations: e.target.value })} /></Field>
            <Button disabled={form.title.trim().length < 5} onClick={create}>Save draft</Button>
          </div>

          <div className="card">
            <h2 className="side-label">Verification queue</h2>
            {data.records.length ? data.records.map((row) => (
              <div key={row.id} className="stack-tight">
                <div className="row-between">
                  <strong>{row.reference} · {row.title}</strong>
                  <Badge tone={row.status === 'published' ? 'success' : row.status === 'requires_correction' ? 'warning' : 'neutral'}>{LABELS[row.status] || row.status}</Badge>
                </div>
                <span className="text-xs text-muted">
                  {row.recordTypeLabel} · {row.entity.name} · {row.fiscalYear} · {row.amountKind} · {row.source.title || 'source missing'}
                </span>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {['draft', 'requires_correction'].includes(row.status) ? <Button size="sm" variant="outline" onClick={() => move(row, 'submit')}>Submit for verification</Button> : null}
                  {row.status === 'awaiting_source' ? <Button size="sm" variant="outline" onClick={() => move(row, 'review')}>Start review</Button> : null}
                  {row.status === 'under_review' ? <Button size="sm" onClick={() => move(row, 'verify')}>Verify source</Button> : null}
                  {row.status === 'verified' ? <Button size="sm" onClick={() => move(row, 'approve')}>Approve</Button> : null}
                  {row.status === 'approved' ? <Button size="sm" onClick={() => move(row, 'publish')}>Publish</Button> : null}
                  {['published', 'approved', 'requires_correction'].includes(row.status) ? <Button size="sm" variant="ghost" onClick={() => move(row, 'archive')}>Archive</Button> : null}
                  {!['archived', 'requires_correction', 'draft'].includes(row.status) ? <Button size="sm" variant="ghost" onClick={() => move(row, 'correction')}>Requires correction</Button> : null}
                </div>
              </div>
            )) : <p className="text-sm text-muted">No financial records in your scope yet.</p>}
          </div>

          <div className="card">
            <h2 className="side-label">Reporting period</h2>
            <div className="grid grid-3">
              <Field label="Level">
                <Select value={period.governmentLevel} onChange={(e) => setPeriod({ ...period, governmentLevel: e.target.value, municipalityId: '' })}>
                  <option value="municipal">Municipal</option><option value="provincial">Provincial</option>
                </Select>
              </Field>
              <Field label="Municipality">
                <Select value={period.municipalityId} disabled={period.governmentLevel === 'provincial'} onChange={(e) => setPeriod({ ...period, municipalityId: e.target.value })}>
                  <option value="">Select municipality</option>
                  {data.entities.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </Field>
              <Field label="Fiscal year"><Input value={period.fiscalYear} onChange={(e) => setPeriod({ ...period, fiscalYear: Number(e.target.value.replace(/\D/g, '').slice(0, 4)) })} /></Field>
            </div>
            <div className="grid grid-2">
              <Field label="Period type">
                <Select value={period.periodType} onChange={(e) => setPeriod({ ...period, periodType: e.target.value })}>
                  <option value="annual">Annual</option><option value="quarterly">Quarterly</option><option value="monthly">Monthly</option>
                </Select>
              </Field>
              <Field label="Period label"><Input value={period.periodLabel} onChange={(e) => setPeriod({ ...period, periodLabel: e.target.value })} /></Field>
            </div>
            <Button
              variant="outline"
              disabled={!period.periodLabel || (period.governmentLevel === 'municipal' && !period.municipalityId)}
              onClick={async () => {
                try {
                  const result = await api.post('/admin/transparency/finance/periods', {
                    ...period,
                    municipalityId: period.governmentLevel === 'municipal' && period.municipalityId ? Number(period.municipalityId) : null,
                  })
                  toast.push(result.message)
                  await load()
                } catch (err) {
                  toast.push(err.message, 'error')
                }
              }}
            >
              Record period
            </Button>
          </div>

          <div className="card">
            <h2 className="side-label">Structured import (JSON rows, saved as drafts)</h2>
            <div className="grid grid-3">
              <Field label="Record type">
                <Select value={importMeta.recordType} onChange={(e) => setImportMeta({ ...importMeta, recordType: e.target.value })}>
                  {Object.entries(data.modules).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
              </Field>
              <Field label="Level">
                <Select value={importMeta.governmentLevel} onChange={(e) => setImportMeta({ ...importMeta, governmentLevel: e.target.value, municipalityId: '' })}>
                  <option value="municipal">Municipal</option><option value="provincial">Provincial</option>
                </Select>
              </Field>
              <Field label="Municipality">
                <Select value={importMeta.municipalityId} disabled={importMeta.governmentLevel === 'provincial'} onChange={(e) => setImportMeta({ ...importMeta, municipalityId: e.target.value })}>
                  <option value="">Select municipality</option>
                  {data.entities.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Rows (JSON array)"><Textarea rows={5} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='[{"title":"...","fiscalYear":2025,"periodLabel":"FY 2025","categoryKey":"health","amountCents":100000,"amountKind":"approved","sourceInstitution":"...","sourceTitle":"..."}]' /></Field>
            <Button variant="outline" disabled={!importText.trim()} onClick={runImport}>Validate and import drafts</Button>
            {data.imports.length ? (
              <div className="stack-tight">
                <h3 className="side-label">Import history</h3>
                {data.imports.map((row) => (
                  <span key={row.id} className="text-xs text-muted">{row.reference} · {row.record_type} · {row.accepted_count} accepted / {row.rejected_count} rejected · {row.created_at?.slice(0, 16)}</span>
                ))}
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
