import { NavLink } from 'react-router-dom'
import { useLang } from '../../i18n'

const LINKS = [
  ['/transparency', 'Overview', 'Pangkalahatan'],
  ['/transparency/finance', 'Finance', 'Pananalapi'],
  ['/transparency/budgets', 'Budgets', 'Badyet'],
  ['/transparency/financial-monitoring', 'Monitoring', 'Pagsubaybay'],
  ['/transparency/reports', 'Reports', 'Mga ulat'],
  ['/transparency/open-data', 'Open data', 'Bukas na datos'],
  ['/transparency/alerts', 'Alerts', 'Mga abiso'],
  ['/transparency/community', 'Community', 'Komunidad'],
]

/** Shared, duplicate-free public navigation for the Phase 5 modules. */
export default function TransparencyNav() {
  const { lang } = useLang()
  return (
    <nav className="pill-group" aria-label="Transparency sections" style={{ marginBottom: 'var(--space-4)' }}>
      {LINKS.map(([to, en, fil]) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/transparency'}
          className={({ isActive }) => `pill${isActive ? ' is-active' : ''}`}
        >
          {lang === 'fil' ? fil : en}
        </NavLink>
      ))}
    </nav>
  )
}
