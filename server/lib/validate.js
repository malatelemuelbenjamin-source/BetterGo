import { HttpError } from './http.js'

/** Express middleware factory that validates req.body against a zod schema. */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source])
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'form',
        message: issue.message,
      }))
      return next(new HttpError(422, 'Please correct the highlighted fields.', details))
    }
    req[source] = result.data
    next()
  }
}

/** Express middleware factory that validates req.query against a zod schema. */
export function validateQuery(schema) {
  return validate(schema, 'query')
}
