/**
 * Declarative digital form definitions (Prompt 64).
 *
 * Only data is stored — field definitions never contain executable code, and
 * conditional visibility is a declarative rule (`{ fieldKey, equals }` or
 * `{ fieldKey, in: [...] }`).
 */

export const FORM_FIELD_TYPES = [
  'short_text',
  'long_text',
  'number',
  'date',
  'select',
  'multiselect',
  'radio',
  'checkbox',
  'email',
  'phone',
  'address',
  'file',
  'consent',
  'heading',
  'info',
]

const CHOICE_TYPES = ['select', 'multiselect', 'radio']
const STATIC_TYPES = ['heading', 'info']

export const FORM_STATUSES = {
  draft: 'Draft',
  in_review: 'Awaiting review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  published: 'Published',
  archived: 'Archived',
}

export const FORM_CLASSIFICATIONS = {
  bettergo_intake: 'Submitted to BetterGo — not an official government filing',
  information_only: 'Information and preparation only',
}

const MAX_FIELDS = 80
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,49}$/

function asText(value, max) {
  if (value === undefined || value === null) return null
  const text = String(value).replace(/\u0000/g, '').trim()
  if (!text) return null
  return text.slice(0, max)
}

function normaliseOptions(options) {
  if (!Array.isArray(options)) return []
  return options
    .map((option) => (typeof option === 'string' ? { value: option, label: option } : option))
    .filter((option) => option && typeof option.value === 'string' && option.value.trim())
    .slice(0, 60)
    .map((option) => ({ value: option.value.trim().slice(0, 80), label: asText(option.label, 120) || option.value.trim().slice(0, 80) }))
}

/**
 * Validates and normalises a form definition. Returns `{ fields, errors }`;
 * a non-empty `errors` array means the definition must be rejected.
 */
export function normaliseFormFields(input) {
  const errors = []
  if (!Array.isArray(input)) return { fields: [], errors: ['Fields must be a list.'] }
  if (input.length > MAX_FIELDS) return { fields: [], errors: [`A form can contain at most ${MAX_FIELDS} fields.`] }

  const seen = new Set()
  const fields = []
  input.forEach((raw, index) => {
    const label = asText(raw?.label, 160)
    const type = String(raw?.fieldType || '')
    if (!FORM_FIELD_TYPES.includes(type)) {
      errors.push(`Field ${index + 1}: unsupported field type.`)
      return
    }
    if (!STATIC_TYPES.includes(type) && !label) {
      errors.push(`Field ${index + 1}: a label is required.`)
      return
    }
    const fieldKey = String(raw?.fieldKey || '').trim()
    if (!KEY_PATTERN.test(fieldKey)) {
      errors.push(`Field ${index + 1}: the key must be lowercase letters, numbers and underscores.`)
      return
    }
    if (seen.has(fieldKey)) {
      errors.push(`Field ${index + 1}: duplicate key "${fieldKey}".`)
      return
    }
    seen.add(fieldKey)

    const options = normaliseOptions(raw?.options)
    if (CHOICE_TYPES.includes(type) && options.length === 0) {
      errors.push(`Field ${index + 1}: choice fields need at least one option.`)
      return
    }

    const validation = {}
    const limits = raw?.validation || {}
    if (Number.isFinite(Number(limits.maxLength))) validation.maxLength = Math.min(5000, Math.max(1, Number(limits.maxLength)))
    if (Number.isFinite(Number(limits.min))) validation.min = Number(limits.min)
    if (Number.isFinite(Number(limits.max))) validation.max = Number(limits.max)
    if (limits.pattern === 'none') validation.pattern = 'none'

    let conditional = null
    if (raw?.conditional && typeof raw.conditional === 'object') {
      const dependsOn = String(raw.conditional.fieldKey || '')
      if (!KEY_PATTERN.test(dependsOn)) {
        errors.push(`Field ${index + 1}: the conditional rule must reference a valid field key.`)
        return
      }
      if (Array.isArray(raw.conditional.in)) conditional = { fieldKey: dependsOn, in: raw.conditional.in.map(String).slice(0, 20) }
      else if (raw.conditional.equals !== undefined) conditional = { fieldKey: dependsOn, equals: String(raw.conditional.equals) }
      else {
        errors.push(`Field ${index + 1}: a conditional rule needs "equals" or "in".`)
        return
      }
    }

    fields.push({
      fieldKey,
      label: label || (type === 'heading' ? 'Section' : 'Information'),
      fieldType: type,
      section: asText(raw?.section, 120),
      description: asText(raw?.description, 400),
      placeholder: asText(raw?.placeholder, 160),
      required: !STATIC_TYPES.includes(type) && Boolean(raw?.required),
      options,
      validation,
      conditional,
      sortOrder: index,
    })
  })

  // Conditional rules must point at a field defined earlier in the form.
  const order = new Map(fields.map((field, index) => [field.fieldKey, index]))
  fields.forEach((field, index) => {
    if (!field.conditional) return
    const target = order.get(field.conditional.fieldKey)
    if (target === undefined || target >= index) errors.push(`Field ${index + 1}: conditions may only depend on earlier fields.`)
  })

  return { fields, errors }
}

export function isFieldVisible(field, answers) {
  if (!field.conditional) return true
  const value = answers?.[field.conditional.fieldKey]
  if (field.conditional.in) {
    const values = Array.isArray(value) ? value.map(String) : [value === undefined || value === null ? '' : String(value)]
    return values.some((entry) => field.conditional.in.includes(entry))
  }
  return String(value ?? '') === field.conditional.equals
}

const PHONE_PATTERN = /^(\+63|0)[0-9\s()-]{7,25}$/
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Server-side answer validation. Hidden fields are never required, which is
 * what stops a conditional question from blocking submission invisibly.
 */
export function validateAnswers(fields, answers) {
  const errors = []
  const clean = {}
  for (const field of fields) {
    if (field.fieldType === 'heading' || field.fieldType === 'info') continue
    if (!isFieldVisible(field, answers)) continue
    const raw = answers?.[field.fieldKey]
    const label = field.label

    const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)
    if (field.fieldType === 'consent') {
      const accepted = raw === true || raw === 'true' || raw === 'on' || raw === 1
      if (field.required && !accepted) errors.push({ field: field.fieldKey, message: `${label} must be accepted.` })
      clean[field.fieldKey] = accepted
      continue
    }
    if (empty) {
      if (field.required) errors.push({ field: field.fieldKey, message: `${label} is required.` })
      continue
    }

    switch (field.fieldType) {
      case 'short_text':
      case 'long_text':
      case 'address': {
        if (typeof raw !== 'string') {
          errors.push({ field: field.fieldKey, message: `${label} must be text.` })
          break
        }
        const limit = field.validation?.maxLength || (field.fieldType === 'long_text' ? 5000 : 500)
        if (raw.length > limit) errors.push({ field: field.fieldKey, message: `${label} must be ${limit} characters or fewer.` })
        else clean[field.fieldKey] = asText(raw, limit)
        break
      }
      case 'number': {
        const value = Number(raw)
        if (!Number.isFinite(value)) errors.push({ field: field.fieldKey, message: `${label} must be a number.` })
        else if (field.validation?.min !== undefined && value < field.validation.min) errors.push({ field: field.fieldKey, message: `${label} must be at least ${field.validation.min}.` })
        else if (field.validation?.max !== undefined && value > field.validation.max) errors.push({ field: field.fieldKey, message: `${label} must be at most ${field.validation.max}.` })
        else clean[field.fieldKey] = value
        break
      }
      case 'date': {
        const text = String(raw)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) errors.push({ field: field.fieldKey, message: `${label} must be a valid date.` })
        else clean[field.fieldKey] = text
        break
      }
      case 'email': {
        const text = String(raw).trim()
        if (!EMAIL_PATTERN.test(text) || text.length > 200) errors.push({ field: field.fieldKey, message: `${label} must be a valid email address.` })
        else clean[field.fieldKey] = text
        break
      }
      case 'phone': {
        const text = String(raw).trim()
        if (!PHONE_PATTERN.test(text)) errors.push({ field: field.fieldKey, message: `${label} must be a Philippine phone number, e.g. 09171234567.` })
        else clean[field.fieldKey] = text
        break
      }
      case 'select':
      case 'radio': {
        const text = String(raw)
        if (!field.options.some((option) => option.value === text)) errors.push({ field: field.fieldKey, message: `${label}: choose one of the listed options.` })
        else clean[field.fieldKey] = text
        break
      }
      case 'multiselect':
      case 'checkbox': {
        const values = Array.isArray(raw) ? raw.map(String) : [String(raw)]
        if (values.some((value) => !field.options.some((option) => option.value === value))) {
          errors.push({ field: field.fieldKey, message: `${label}: one or more chosen options are not allowed.` })
        } else clean[field.fieldKey] = values
        break
      }
      case 'file': {
        const values = Array.isArray(raw) ? raw.map(Number) : [Number(raw)]
        if (values.some((value) => !Number.isInteger(value) || value <= 0)) errors.push({ field: field.fieldKey, message: `${label} must reference a document in your vault.` })
        else clean[field.fieldKey] = values
        break
      }
      default:
        errors.push({ field: field.fieldKey, message: `${label}: unsupported field type.` })
    }
  }
  return { errors, answers: clean }
}

/** Fields as stored in SQLite, with JSON columns parsed. */
export function parseFormRow(row, fieldRows = []) {
  if (!row) return null
  return {
    id: row.id,
    serviceId: row.service_id,
    municipalities: row.municipality_id ? [row.municipality_id] : [],
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    privacyNotice: row.privacy_notice,
    privacyNoticeVersion: row.privacy_notice_version,
    audience: row.audience,
    version: row.version,
    status: row.status,
    submissionClassification: row.submission_classification,
    sourceReference: row.source_reference,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fields: fieldRows.map((field) => ({
      fieldKey: field.field_key,
      label: field.label,
      fieldType: field.field_type,
      section: field.section,
      description: field.description,
      placeholder: field.placeholder,
      required: Boolean(field.required),
      options: field.options ? JSON.parse(field.options) : [],
      validation: field.validation ? JSON.parse(field.validation) : {},
      conditional: field.conditional ? JSON.parse(field.conditional) : null,
      sortOrder: field.sort_order,
    })),
  }
}
