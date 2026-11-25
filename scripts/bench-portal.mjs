/**
 * Phase 3 performance check (Prompt 57 §17).
 *
 * Seeds a throwaway database with a realistic volume of municipal records and
 * measures the public query paths directly (no HTTP overhead). Run with:
 *
 *   node scripts/bench-portal.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bettergo-bench-'))
process.env.DATABASE_PATH = path.join(dir, 'bench.db')

const { run, get } = await import('../server/db.js')
const { seed } = await import('../server/seed.js')
const { municipalPortal, municipalContentList } = await import('../server/lib/municipal.js')
const { municipalContentFeed, municipalDiscovery, municipalOfficeDirectory } = await import(
  '../server/lib/municipal-modules.js'
)

seed({ quiet: true })

const municipalities = get(`SELECT COUNT(*) AS total FROM municipalities`).total
const types = ['news', 'notice', 'project', 'program', 'resource', 'faq']
const statuses = ['published', 'published', 'published', 'draft']
const started = performance.now()
for (let index = 0; index < 2400; index += 1) {
  const municipalityId = (index % municipalities) + 1
  const type = types[index % types.length]
  run(
    `INSERT INTO municipal_content (municipality_id, content_type, title, slug, summary, body,
       publication_status, verification_status, project_status, published_at, priority,
       source_reference, progress_percent)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'verified', 'ongoing', ?, ?, 'Benchmark fixture', ?)`,
    [
      municipalityId,
      type,
      `Benchmark ${type} record ${index}`,
      `benchmark-${type}-${index}`,
      'Benchmark summary text for query timing.',
      'Benchmark body text for query timing.',
      statuses[index % statuses.length],
      '2026-01-01 00:00:00',
      index % 17 === 0 ? 'important' : 'normal',
      index % 5 === 0 ? 40 : null,
    ],
  )
}
for (let index = 0; index < 300; index += 1) {
  run(
    `INSERT INTO government_offices (name, slug, municipality_id, government_level, office_type,
       publication_status, verification_status, latitude, longitude, location_verified)
     VALUES (?, ?, ?, 'municipal', 'Office', 'published', 'verified', ?, ?, ?)`,
    [
      `Benchmark Office ${index}`,
      `benchmark-office-${index}`,
      (index % municipalities) + 1,
      13.4 + index / 10000,
      121.8 + index / 10000,
      index % 2,
    ],
  )
}
const seededMs = performance.now() - started

function measure(label, fn, iterations = 60) {
  for (let i = 0; i < 5; i += 1) fn() // warm-up
  const times = []
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]
  const p95 = times[Math.floor(times.length * 0.95)]
  return { label, median: median.toFixed(2), p95: p95.toFixed(2) }
}

const results = [
  measure('portal payload (boac, 400 records)', () => municipalPortal('boac')),
  measure('published content list (news, page 1)', () => municipalContentList('boac', { type: 'news' })),
  measure('cross-municipality project feed', () => municipalContentFeed({ type: 'project', limit: 12 })),
  measure('office directory + markers', () => municipalOfficeDirectory({ limit: 200 })),
  measure('discovery search (term match)', () => municipalDiscovery({ q: 'benchmark' })),
]

const contentCount = get(`SELECT COUNT(*) AS total FROM municipal_content`).total
const draftLeak = get(
  `SELECT COUNT(*) AS total FROM municipal_content c
   WHERE c.publication_status = 'published' AND c.published_at IS NOT NULL`,
).total

console.log(
  JSON.stringify(
    {
      seeded_records: Number(contentCount),
      published_records: Number(draftLeak),
      seed_ms: Math.round(seededMs),
      iterations: 60,
      results,
      note: 'Measurements are from the local Node process and SQLite file; they exclude network latency.',
    },
    null,
    2,
  ),
)

fs.rmSync(dir, { recursive: true, force: true })
