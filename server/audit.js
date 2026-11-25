import { run } from './db.js'

/**
 * Append an immutable audit entry. Never pass passwords, tokens or secrets here.
 * `oldValues` / `newValues` are JSON-serialised and stored as text.
 */
export function logAudit(
  req,
  { action, module, entityType, entityId, oldValues, newValues, result = 'success', municipalityId = null },
) {
  try {
    run(
      `INSERT INTO audit_logs
        (user_id, action, module, entity_type, entity_id, old_values, new_values, ip_address, user_agent, result, municipality_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req?.user?.id ?? null,
        action,
        module ?? null,
        entityType ?? null,
        entityId ?? null,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        req?.ip ?? null,
        (req?.get?.('user-agent') || '').slice(0, 300) || null,
        result,
        municipalityId ? Number(municipalityId) : null,
      ],
    )
  } catch (error) {
    // Auditing must never break the request, but it must be visible in logs.
    console.error('[audit] failed to write entry', error.message)
  }
}

/** Record a workflow transition for content. */
export function recordWorkflow(dbRun, { contentType, contentId, from, to, actorId, note }) {
  dbRun(
    `INSERT INTO workflow_events (content_type, content_id, from_status, to_status, actor_id, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [contentType, contentId, from ?? null, to ?? null, actorId ?? null, note ?? null],
  )
}
