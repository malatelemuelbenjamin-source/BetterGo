/**
 * Accessible horizontal bar chart for financial allocations.
 * Every chart ships with a visible table alternative, an aria description and
 * text labels; colour is never the only way a value is communicated.
 */
export function FinanceBarChart({ title, rows, currency = 'PHP', emptyLabel = 'Data not yet available' }) {
  const max = Math.max(...rows.map((row) => Math.abs(row.value || 0)), 0)
  const money = (cents) => {
    if (cents === null || cents === undefined) return emptyLabel
    try {
      return new Intl.NumberFormat('en-PH', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
    } catch {
      return `${(cents / 100).toLocaleString()}`
    }
  }
  if (!rows.length) return <p className="text-sm text-muted">{emptyLabel}</p>
  const description = `${title}. ${rows.map((row) => `${row.label}: ${money(row.value)}`).join('; ')}`

  return (
    <figure className="stack-tight" style={{ margin: 0 }}>
      <figcaption className="side-label">{title}</figcaption>
      <div role="img" aria-label={description} className="stack-tight">
        {rows.map((row) => (
          <div key={row.label} className="stack-tight">
            <div className="row-between text-xs">
              <span>{row.label}{row.note ? ` (${row.note})` : ''}</span>
              <strong>{money(row.value)}</strong>
            </div>
            <div style={{ background: 'var(--color-surface-muted, #e8e4dc)', height: 14, borderRadius: 4 }} aria-hidden="true">
              <div
                style={{
                  width: `${max ? Math.max(2, (Math.abs(row.value || 0) / max) * 100) : 2}%`,
                  height: '100%',
                  borderRadius: 4,
                  background: row.value < 0 ? '#a33' : 'var(--color-primary, #21583f)',
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <details>
        <summary className="text-xs">Table of values</summary>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <caption className="text-xs">{title}</caption>
            <thead><tr><th scope="col">Category</th><th scope="col">Amount</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}><th scope="row">{row.label}</th><td>{money(row.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
