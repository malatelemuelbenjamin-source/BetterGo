import { db, all, get, run, transaction } from './db.js'
import { nowIso } from './db.js'
import { seedPhase2 } from './seed-phase2.js'
import { seedPhase5b } from './seed-phase5b.js'

// ---------------------------------------------------------------------------
// PERMISSIONS (Prompt 16)
// ---------------------------------------------------------------------------
export const PERMISSIONS = [
  // Users
  ['View users', 'users.view', 'User management'],
  ['View own account', 'users.view_own', 'User management'],
  ['Create users', 'users.create', 'User management'],
  ['Update users', 'users.update', 'User management'],
  ['Update own account', 'users.update_own', 'User management'],
  ['Suspend users', 'users.suspend', 'User management'],
  ['Activate users', 'users.activate', 'User management'],
  ['Assign roles', 'users.assign_roles', 'User management'],
  ['Delete or deactivate users', 'users.delete_or_deactivate', 'User management'],
  // Roles
  ['View roles', 'roles.view', 'Roles and permissions'],
  ['Create roles', 'roles.create', 'Roles and permissions'],
  ['Update roles', 'roles.update', 'Roles and permissions'],
  ['Assign roles (RBAC)', 'roles.assign', 'Roles and permissions'],
  ['Revoke roles', 'roles.revoke', 'Roles and permissions'],
  ['View permissions', 'permissions.view', 'Roles and permissions'],
  ['Manage permissions', 'permissions.manage', 'Roles and permissions'],
  // Content
  ['View content', 'content.view', 'Government content'],
  ['Create content', 'content.create', 'Government content'],
  ['Update content', 'content.update', 'Government content'],
  ['Delete content', 'content.delete', 'Government content'],
  ['Submit content for review', 'content.submit_for_review', 'Government content'],
  ['Approve content', 'content.approve', 'Government content'],
  ['Reject content', 'content.reject', 'Government content'],
  ['Publish content', 'content.publish', 'Government content'],
  ['Archive content', 'content.archive', 'Government content'],
  // Announcements
  ['View announcements', 'announcements.view', 'Announcements'],
  ['Create announcements', 'announcements.create', 'Announcements'],
  ['Update announcements', 'announcements.update', 'Announcements'],
  ['Approve announcements', 'announcements.approve', 'Announcements'],
  ['Publish announcements', 'announcements.publish', 'Announcements'],
  ['Archive announcements', 'announcements.archive', 'Announcements'],
  // Services
  ['View services', 'services.view', 'Government services'],
  ['Create services', 'services.create', 'Government services'],
  ['Update services', 'services.update', 'Government services'],
  ['Approve services', 'services.approve', 'Government services'],
  ['Publish services', 'services.publish', 'Government services'],
  ['Archive services', 'services.archive', 'Government services'],
  // Directory
  ['View directory', 'directory.view', 'Government directory'],
  ['Create directory records', 'directory.create', 'Government directory'],
  ['Update directory records', 'directory.update', 'Government directory'],
  ['Approve directory records', 'directory.approve', 'Government directory'],
  ['Delete directory records', 'directory.delete', 'Government directory'],
  // Municipalities
  ['View municipalities', 'municipalities.view', 'Municipal management'],
  ['Manage municipalities', 'municipalities.manage', 'Municipal management'],
  ['Manage municipal users', 'municipality_users.manage', 'Municipal management'],
  ['View municipal analytics', 'municipality_analytics.view', 'Municipal management'],
  // Province
  ['View provincial dashboard', 'province.dashboard.view', 'Provincial management'],
  ['Manage provincial content', 'province.content.manage', 'Provincial management'],
  ['View provincial analytics', 'province.analytics.view', 'Provincial management'],
  ['Manage provincial settings', 'province.settings.manage', 'Provincial management'],
  // Participation
  ['View reports', 'reports.view', 'Citizen participation'],
  ['Submit reports', 'reports.submit', 'Citizen participation'],
  ['View own reports', 'reports.view_own', 'Citizen participation'],
  ['Review reports', 'reports.review', 'Citizen participation'],
  ['Assign reports', 'reports.assign', 'Citizen participation'],
  ['Resolve reports', 'reports.resolve', 'Citizen participation'],
  ['Archive reports', 'reports.archive', 'Citizen participation'],
  // Transparency
  ['View transparency records', 'transparency.view', 'Transparency'],
  ['Manage transparency documents', 'transparency.documents.manage', 'Transparency'],
  ['Import transparency data', 'transparency.data.import', 'Transparency'],
  ['Approve transparency data', 'transparency.data.approve', 'Transparency'],
  // Emergency
  ['View emergency records', 'emergency.view', 'Emergency information'],
  ['Manage emergency records', 'emergency.manage', 'Emergency information'],
  ['Approve emergency records', 'emergency.approve', 'Emergency information'],
  // Audit and security
  ['View audit logs', 'audit_logs.view', 'Audit and security'],
  ['Export audit logs', 'audit_logs.export', 'Audit and security'],
  ['Manage security settings', 'security.settings.manage', 'Audit and security'],
  ['Manage integrations', 'integrations.manage', 'Audit and security'],
  // CMS / settings
  ['Manage CMS content', 'cms.manage', 'Content management'],
  ['Manage system settings', 'settings.manage', 'System'],
  ['Manage media library', 'media.manage', 'Content management'],
  // Privacy
  ['Manage privacy requests', 'privacy.requests.manage', 'Privacy'],
  ['Submit privacy requests', 'privacy.requests.submit', 'Privacy'],
  ['Manage privacy incidents', 'privacy.incidents.manage', 'Privacy'],
  // Municipal portals (Phase 3)
  ['View municipal portals', 'municipal.portal.view', 'Municipal portals'],
  ['Manage municipal portal settings', 'municipal.portal.manage', 'Municipal portals'],
  ['View municipal content', 'municipal.content.view', 'Municipal portals'],
  ['Create municipal content', 'municipal.content.create', 'Municipal portals'],
  ['Update municipal content', 'municipal.content.update', 'Municipal portals'],
  ['Submit municipal content for review', 'municipal.content.submit_for_review', 'Municipal portals'],
  ['Review municipal content', 'municipal.content.review', 'Municipal portals'],
  ['Publish municipal content', 'municipal.content.publish', 'Municipal portals'],
  ['Archive municipal content', 'municipal.content.archive', 'Municipal portals'],
  ['Upload municipal media', 'municipal.media.upload', 'Municipal portals'],
  ['View municipal analytics', 'municipal.analytics.view', 'Municipal portals'],
]

const ROLE_DEFS = [
  ['Citizen', 'citizen', 'Registered member of the public. Access to public information and personal account tools.'],
  ['Government Employee', 'government_employee', 'Authorised government personnel with scoped access to assigned information.'],
  ['Municipal Administrator', 'municipal_admin', 'Administrator for one assigned municipality.'],
  ['Provincial Administrator', 'provincial_admin', 'Province-wide platform administrator.'],
  ['Content Editor', 'content_editor', 'Trusted editor maintaining public information.'],
  ['Municipal Content Editor', 'municipal_content_editor', 'Drafts and edits content for one assigned municipality. Cannot publish.'],
  ['Municipal Reviewer', 'municipal_reviewer', 'Reviews submitted municipal content within the assigned municipality.'],
  ['Super Administrator', 'super_admin', 'Platform owner with full system administration.'],
]

const MUNICIPAL_ADMIN_PERMISSIONS = [
  'municipal.portal.view',
  'municipal.portal.manage',
  'municipal.content.view',
  'municipal.content.create',
  'municipal.content.update',
  'municipal.content.submit_for_review',
  'municipal.content.review',
  'municipal.content.publish',
  'municipal.content.archive',
  'municipal.media.upload',
  'municipal.analytics.view',
]

const CITIZEN_PERMISSIONS = [
  'users.view_own',
  'users.update_own',
  'content.view',
  'announcements.view',
  'services.view',
  'directory.view',
  'municipalities.view',
  'reports.submit',
  'reports.view_own',
  'privacy.requests.submit',
  'emergency.view',
  'transparency.view',
]

const ROLE_PERMISSIONS = {
  citizen: CITIZEN_PERMISSIONS,
  government_employee: [
    ...CITIZEN_PERMISSIONS,
    'content.create',
    'content.update',
    'content.submit_for_review',
    'reports.view',
    'transparency.view',
  ],
  content_editor: [
    ...CITIZEN_PERMISSIONS,
    'content.view',
    'content.create',
    'content.update',
    'content.delete',
    'content.submit_for_review',
    'announcements.create',
    'announcements.update',
    'services.create',
    'services.update',
    'directory.create',
    'directory.update',
    'transparency.documents.manage',
    'media.manage',
    'cms.manage',
  ],
  municipal_admin: [
    ...CITIZEN_PERMISSIONS,
    'users.view',
    'users.update',
    'users.suspend',
    'users.activate',
    'users.assign_roles',
    'roles.view',
    'permissions.view',
    'content.create',
    'content.update',
    'content.delete',
    'content.submit_for_review',
    'content.approve',
    'content.reject',
    'content.publish',
    'content.archive',
    'announcements.create',
    'announcements.update',
    'announcements.approve',
    'announcements.publish',
    'announcements.archive',
    'services.create',
    'services.update',
    'services.approve',
    'services.publish',
    'services.archive',
    'directory.create',
    'directory.update',
    'directory.approve',
    'municipalities.manage',
    'municipality_users.manage',
    'municipality_analytics.view',
    'reports.view',
    'reports.review',
    'reports.assign',
    'reports.resolve',
    'reports.archive',
    'transparency.documents.manage',
    'emergency.manage',
    'emergency.approve',
    'audit_logs.view',
    'cms.manage',
    'media.manage',
    'privacy.requests.manage',
    ...MUNICIPAL_ADMIN_PERMISSIONS,
  ],
  provincial_admin: [
    ...CITIZEN_PERMISSIONS,
    'users.view',
    'users.create',
    'users.update',
    'users.suspend',
    'users.activate',
    'users.assign_roles',
    'users.delete_or_deactivate',
    'roles.view',
    'roles.assign',
    'roles.revoke',
    'permissions.view',
    'content.create',
    'content.update',
    'content.delete',
    'content.submit_for_review',
    'content.approve',
    'content.reject',
    'content.publish',
    'content.archive',
    'announcements.create',
    'announcements.update',
    'announcements.approve',
    'announcements.publish',
    'announcements.archive',
    'services.create',
    'services.update',
    'services.approve',
    'services.publish',
    'services.archive',
    'directory.create',
    'directory.update',
    'directory.approve',
    'directory.delete',
    'municipalities.manage',
    'municipality_users.manage',
    'municipality_analytics.view',
    'province.dashboard.view',
    'province.content.manage',
    'province.analytics.view',
    'province.settings.manage',
    'reports.view',
    'reports.review',
    'reports.assign',
    'reports.resolve',
    'reports.archive',
    'transparency.documents.manage',
    'transparency.data.import',
    'transparency.data.approve',
    'emergency.manage',
    'emergency.approve',
    'audit_logs.view',
    'audit_logs.export',
    'cms.manage',
    'settings.manage',
    'media.manage',
    'privacy.requests.manage',
    'privacy.incidents.manage',
    ...MUNICIPAL_ADMIN_PERMISSIONS,
  ],
  municipal_content_editor: [
    ...CITIZEN_PERMISSIONS,
    'municipal.portal.view',
    'municipal.content.view',
    'municipal.content.create',
    'municipal.content.update',
    'municipal.content.submit_for_review',
    'municipal.media.upload',
  ],
  municipal_reviewer: [
    ...CITIZEN_PERMISSIONS,
    'municipal.portal.view',
    'municipal.content.view',
    'municipal.content.review',
    'municipal.analytics.view',
  ],
  super_admin: PERMISSIONS.map(([, slug]) => slug),
}

const MUNICIPALITIES = [
  {
    name: 'Boac',
    slug: 'boac',
    code: '1740010000',
    description:
      'Boac is a municipality in the province of Marinduque and serves as the provincial capital of Marinduque.',
  },
  {
    name: 'Mogpog',
    slug: 'mogpog',
    code: '1740020000',
    description: 'Mogpog is a municipality in the province of Marinduque, MIMAROPA Region, Philippines.',
  },
  {
    name: 'Gasan',
    slug: 'gasan',
    code: '1740030000',
    description: 'Gasan is a municipality in the province of Marinduque, MIMAROPA Region, Philippines.',
  },
  {
    name: 'Buenavista',
    slug: 'buenavista',
    code: '1740040000',
    description: 'Buenavista is a municipality in the province of Marinduque, MIMAROPA Region, Philippines.',
  },
  {
    name: 'Torrijos',
    slug: 'torrijos',
    code: '1740050000',
    description: 'Torrijos is a municipality in the province of Marinduque, MIMAROPA Region, Philippines.',
  },
  {
    name: 'Santa Cruz',
    slug: 'santa-cruz',
    code: '1740060000',
    description:
      'Santa Cruz is a municipality in the province of Marinduque, MIMAROPA Region, Philippines.',
  },
]

const SERVICE_CATEGORIES = [
  ['Health and Medical Services', 'health-medical', 'Public health programmes, health centre information and medical assistance guidance.', 'HeartPulse'],
  ['Social Welfare and Assistance', 'social-welfare', 'Social protection, financial assistance information and family welfare programmes.', 'HandHeart'],
  ['Business and Permits', 'business-permits', 'Business permit, licensing and local regulatory information.', 'Briefcase'],
  ['Civil Registry', 'civil-registry', 'Birth, marriage and death registration information and certificate guidance.', 'FileText'],
  ['Education and Scholarships', 'education-scholarships', 'Scholarship opportunities, student assistance and education programmes.', 'GraduationCap'],
  ['Agriculture and Fisheries', 'agriculture-fisheries', 'Farmer and fisherfolk assistance, training and agricultural programmes.', 'Sprout'],
  ['Employment and Livelihood', 'employment-livelihood', 'Employment assistance, job fairs, skills training and livelihood programmes.', 'Users'],
  ['Housing and Community Services', 'housing-community', 'Housing assistance information and community development programmes.', 'Home'],
  ['Senior Citizen Services', 'senior-citizen', 'Information and assistance programmes for senior citizens.', 'Accessibility'],
  ['Persons with Disabilities Services', 'pwd-services', 'Programmes and assistance for persons with disabilities.', 'Accessibility'],
  ['Youth Development', 'youth-development', 'Youth programmes, development opportunities and student support.', 'Sparkles'],
  ['Disaster and Emergency Information', 'disaster-emergency', 'Preparedness guidance and emergency information resources.', 'ShieldAlert'],
]

const ANNOUNCEMENT_CATEGORIES = [
  ['Provincial Information', 'provincial-information', 'Province-wide public information and updates.'],
  ['Municipal Updates', 'municipal-updates', 'Updates published for a specific municipality.'],
  ['Public Advisories', 'public-advisories', 'Public notices, service interruptions and safety information.'],
  ['Education and Scholarships', 'education', 'Scholarships and school-related public information.'],
  ['Health Information', 'health', 'Public health advisories and health programmes.'],
  ['Agriculture and Fisheries', 'agriculture', 'Agricultural programmes and fisherfolk assistance.'],
  ['Employment and Livelihood', 'employment', 'Job opportunities, job fairs and livelihood programmes.'],
  ['Community Events', 'community-events', 'Public events and community activities.'],
  ['Disaster and Emergency', 'disaster-emergency', 'Weather advisories, preparedness and emergency information.'],
  ['Public Consultations', 'public-consultations', 'Hearings, consultations and participation opportunities.'],
]

const SETTINGS = [
  ['platform.name', 'BetterGo Marinduque', 'string', 'general', 'Public platform name', 1],
  ['platform.tagline', 'Serbisyo. Transparency. Progreso. Para sa bawat Marinduqueño.', 'string', 'general', 'Public tagline', 1],
  ['platform.description', 'An independent, community-driven digital initiative for public information, services and civic participation in Marinduque.', 'string', 'general', 'Short platform description', 1],
  ['platform.domain', '', 'string', 'general', 'Public deployment URL', 1],
  ['platform.default_language', 'en', 'string', 'localization', 'Default interface language', 1],
  ['platform.supported_languages', 'en,fil', 'string', 'localization', 'Comma separated supported languages', 1],
  ['platform.timezone', 'Asia/Manila', 'string', 'localization', 'Display timezone', 1],
  ['platform.contact_email', '', 'string', 'general', 'Verified public contact email (leave empty until verified)', 1],
  ['platform.maintenance_notice', '', 'string', 'general', 'Shown site-wide when set', 1],
  ['brand.primary_color', '#16A34A', 'string', 'appearance', 'Primary brand colour', 1],
  ['brand.forest_color', '#14532D', 'string', 'appearance', 'Deep brand colour', 1],
  ['brand.logo_url', '/brand/logo.svg', 'string', 'appearance', 'Logo asset path', 1],
  ['content.default_workflow', 'review_required', 'string', 'content', 'Default publication workflow', 0],
  ['content.require_source', 'true', 'boolean', 'content', 'Require source attribution for government content', 0],
  ['content.max_upload_mb', '10', 'number', 'content', 'Maximum upload size in megabytes', 0],
  ['content.featured_limit', '6', 'number', 'content', 'Maximum featured items per section', 0],
  ['security.session_days', '7', 'number', 'security', 'Session lifetime in days', 0],
  ['security.require_email_verification', 'true', 'boolean', 'security', 'Require verified email for account actions', 0],
  ['notifications.email_enabled', 'false', 'boolean', 'notifications', 'Whether transactional email delivery is configured', 0],
  ['integrations.map_provider', '', 'string', 'integrations', 'Optional map provider key name (leave empty to use list fallback)', 0],
  ['footer.independence_notice', 'BetterGo Marinduque is an independent, community-driven digital initiative. It is not an official provincial or municipal government website unless formally authorised.', 'string', 'general', 'Independence disclaimer shown in the footer', 1],
]

const HOMEPAGE_SECTIONS = [
  ['hero', 'Your Province. Your Information. Your Participation.', 'Explore public services, discover government information, monitor development projects, and participate in building a better Marinduque.', null, 1],
  ['search', 'Search public information', 'Search government services, offices, announcements and projects.', null, 2],
  ['quick_access', 'Explore BetterGo', 'Jump straight to the public information you need.', null, 3],
  ['services', 'Government Services at Your Fingertips', 'Browse service categories and verified service information.', null, 4],
  ['municipalities', 'Explore the Municipalities of Marinduque', 'Six municipalities, one province. Start with your own community.', null, 5],
  ['announcements', 'Latest Announcements', 'Published public information and community updates.', null, 6],
  ['transparency', 'Transparency Builds Trust', 'Access public information and follow the progress of development initiatives across Marinduque.', null, 7],
  ['projects', 'Building a Better Marinduque', 'Public infrastructure information will appear here once verified records are published.', null, 8],
  ['participation', 'Your Voice Matters', 'Share feedback, suggestions and concerns with the community.', null, 9],
  ['emergency', 'Emergency Information', 'Verified emergency contacts and preparedness information.', null, 10],
  ['about', 'About BetterGo Marinduque', 'BetterGo Marinduque is an independent, community-driven digital initiative designed to make public information more accessible, encourage transparency, and support meaningful civic participation throughout the province.', null, 11],
]

const FAQS = [
  [
    'Is BetterGo Marinduque an official government website?',
    'No. BetterGo Marinduque is an independent, community-driven digital initiative. It is not an official provincial or municipal government website unless formal authorisation is announced. Always confirm critical procedures with the responsible government office.',
    'About the platform',
  ],
  [
    'Does BetterGo issue government documents or approve applications?',
    'No. BetterGo only helps you find public information about services, requirements and the responsible offices. Applications and documents are processed by the authorised government office.',
    'Government services',
  ],
  [
    'Where does the information come from?',
    'Each published record shows its source and verification status. Records marked "pending" or "unverified" have not yet been checked against an official source and should be confirmed with the responsible office.',
    'Information accuracy',
  ],
  [
    'How do I report incorrect information?',
    'Use the report-correction option on a directory or service page, or send feedback through the contact form. Corrections are reviewed by an administrator before publication.',
    'Reporting',
  ],
  [
    'Do I need an account to browse?',
    'No. All public information can be browsed without an account. An account is only needed for personal features such as saving services, tracking your own reports, or managing privacy requests.',
    'Accounts',
  ],
  [
    'How is my personal information handled?',
    'Only the information needed for platform features is collected. You can review, correct or request deletion of your data from the privacy section of your dashboard. See the Privacy Policy for details.',
    'Privacy',
  ],
]

const LEGAL_DOCS = [
  {
    doc_type: 'privacy_policy',
    title: 'Privacy Policy',
    version: '0.9-draft',
    content: `# Privacy Policy

**Status: draft awaiting professional legal review.**
**Version:** 0.9-draft
**Effective date:** Not yet in force.

BetterGo Marinduque is an independent, community-driven digital initiative. It is not an official provincial or municipal government website unless formal authorisation is announced.

## 1. Information we collect
We collect only the information required to operate the platform:

- Account information: name, email address, and a securely hashed password.
- Optional profile information: mobile number, municipality, barangay, address, and profile photo.
- Preferences: language, notification and display settings.
- Content you submit: feedback, reports, suggestions, correction reports and privacy requests.
- Security information: sign-in attempt records, audit events, and session data.

We do not require precise GPS location, and we do not collect payment information.

## 2. How we use information
Information is used to operate your account, provide platform features, respond to your submissions, maintain security, deliver notifications you requested, prevent abuse, and improve platform reliability.

## 3. Legal basis
Processing relies on your consent where you provide optional information, on the performance of the service you requested, and on legitimate interests in securing the platform, consistent with the Philippine Data Privacy Act of 2012 (RA 10173).

## 4. Sharing
Personal information is visible only to authorised platform administrators who need it for their responsibilities. We do not sell personal information. Information may be disclosed where required by law or a valid legal order.

## 5. Retention
Account records are retained while your account is active. Security and audit records are retained as required for security and accountability. Submitted reports may be retained after resolution for record-keeping. Retention rules are documented internally and require legal review.

## 6. Your rights
Subject to applicable law, you may request access, correction, or deletion of your personal information, object to or restrict certain processing, and withdraw consent where consent is the basis. Use the data request centre in your dashboard or the public data request page.

## 7. Security
We use password hashing, HTTP-only session cookies, role-based access control, server-side validation, rate limiting and audit logging. No system can be guaranteed completely secure.

## 8. Contact
A verified privacy contact channel must be configured before this policy is finalised. Until then, use the data request page.

## 9. Changes
Material changes will be published with a new version number and effective date. Previous versions remain available.`,
  },
  {
    doc_type: 'terms_of_use',
    title: 'Terms of Use',
    version: '0.9-draft',
    content: `# Terms of Use

**Status: draft awaiting professional legal review.**
**Version:** 0.9-draft

## 1. Purpose of the platform
BetterGo Marinduque provides access to public information, directories, community participation tools and related features.

## 2. Independent platform
BetterGo Marinduque is an independent, community-driven digital initiative. It is not an official government website, office or authorised service provider unless formal authorisation is announced. Displaying government information does not imply endorsement by any government body.

## 3. Information accuracy
Information is compiled from identified sources and may change without notice. Always verify critical procedures, requirements and deadlines with the responsible government office. BetterGo does not independently certify the accuracy of government records.

## 4. Government services
Displaying a service does not mean BetterGo has authority to approve applications, issue documents or make official decisions. Applications are processed by the responsible office.

## 5. Your responsibilities
You agree to provide accurate information where required, respect other users, avoid harassment and abuse, avoid submitting malicious files, avoid impersonation, avoid unlawful activity, respect intellectual property, and avoid knowingly spreading false or harmful information.

## 6. Availability
The platform may be unavailable during maintenance or due to circumstances beyond our control.

## 7. Accounts
Accounts may be suspended for security or policy violations, subject to review and applicable law. You may request deletion of your account through the privacy tools.

## 8. External links
External links are provided for convenience. Their content and availability are controlled by their owners. Review the destination before relying on it.

## 9. Emergency information
Emergency contact information is provided for reference and does not replace official emergency services. In an emergency, contact the appropriate emergency service directly.

## 10. Limitation of liability
To the extent permitted by law, BetterGo Marinduque is not liable for decisions made solely on the basis of information published here. Nothing in these terms excludes rights that cannot lawfully be excluded.`,
  },
  {
    doc_type: 'disclaimer',
    title: 'Independent Platform Disclaimer',
    version: '1.0',
    content: `# Independent Platform Disclaimer

1. BetterGo Marinduque is an independent, community-driven digital initiative unless formal authorisation is announced.
2. It is not an official provincial or municipal government website.
3. Government names, office names and public information are presented for informational purposes only.
4. Government logos and official seals are used only with appropriate permission and are not used on this platform without authorisation.
5. Public information should be verified with the responsible government office.
6. BetterGo Marinduque does not approve government applications or issue official government documents.
7. Emergency information does not replace official emergency channels.`,
  },
]

const NATIONAL_EMERGENCY = [
  {
    organization_name: 'National Emergency Hotline (911)',
    category: 'national',
    description:
      'National emergency hotline for police, fire and medical emergencies in the Philippines. Confirm local availability with your telecommunications provider.',
    phone: '911',
    website: null,
    source_reference: 'National emergency hotline, Republic of the Philippines',
    source_url: 'https://www.gov.ph/',
    verification_status: 'verified',
  },
  {
    organization_name: "8888 Citizens' Complaint Hotline",
    category: 'national',
    description:
      'National citizens complaint hotline operated by the Presidential Complaints Center for complaints and concerns about government services.',
    phone: '8888',
    website: null,
    source_reference: 'Presidential Complaints Center',
    source_url: 'https://www.gov.ph/',
    verification_status: 'verified',
  },
  {
    organization_name: 'Philippine Red Cross',
    category: 'national',
    description:
      'Humanitarian organisation providing emergency assistance, first aid and disaster response. Verify current hotline information on the official website before relying on it.',
    phone: '143',
    website: 'https://redcross.org.ph/',
    source_reference: 'Philippine Red Cross official website',
    source_url: 'https://redcross.org.ph/',
    verification_status: 'pending',
  },
  {
    organization_name: 'PAGASA - Weather and Flood Advisories',
    category: 'national',
    description:
      'Official weather, tropical cyclone and flood information for the Philippines. Consult PAGASA advisories during severe weather.',
    phone: null,
    website: 'https://www.pagasa.dost.gov.ph/',
    source_reference: 'DOST-PAGASA official website',
    source_url: 'https://www.pagasa.dost.gov.ph/',
    verification_status: 'verified',
  },
  {
    organization_name: 'PHIVOLCS - Earthquake and Tsunami Information',
    category: 'national',
    description:
      'Official earthquake, tsunami and volcanic information for the Philippines.',
    phone: null,
    website: 'https://www.phivolcs.dost.gov.ph/',
    source_reference: 'DOST-PHIVOLCS official website',
    source_url: 'https://www.phivolcs.dost.gov.ph/',
    verification_status: 'verified',
  },
]

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------
export function seed({ quiet = false } = {}) {
  const log = (...args) => !quiet && console.log(...args)

  transaction(() => {
    // Province
    let province = get(`SELECT * FROM provinces WHERE name = ?`, ['Marinduque'])
    if (!province) {
      run(`INSERT INTO provinces (name, code, region) VALUES (?, ?, ?)`, [
        'Marinduque',
        '1740000000',
        'MIMAROPA Region (Region IV-B)',
      ])
      province = get(`SELECT * FROM provinces WHERE name = ?`, ['Marinduque'])
    }

    // Municipalities (official PSGC codes; no invented statistics)
    MUNICIPALITIES.forEach((m, index) => {
      const existing = get(`SELECT id FROM municipalities WHERE slug = ?`, [m.slug])
      if (existing) return
      run(
        `INSERT INTO municipalities
          (province_id, name, slug, municipal_code, description, overview, verification_status,
           source_reference, source_url, last_verified_at, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?)`,
        [
          province.id,
          m.name,
          m.slug,
          m.code,
          m.description,
          m.description,
          'Philippine Standard Geographic Code (PSGC), Philippine Statistics Authority',
          'https://psa.gov.ph/classification/psgc',
          nowIso(),
          index + 1,
        ],
      )
    })

    // Roles
    for (const [name, slug, description] of ROLE_DEFS) {
      const existing = get(`SELECT id FROM user_roles WHERE slug = ?`, [slug])
      if (!existing) {
        run(`INSERT INTO user_roles (name, slug, description) VALUES (?, ?, ?)`, [name, slug, description])
      }
    }

    // Permissions
    for (const [name, slug, module] of PERMISSIONS) {
      const existing = get(`SELECT id FROM permissions WHERE slug = ?`, [slug])
      if (!existing) {
        run(`INSERT INTO permissions (name, slug, module, description) VALUES (?, ?, ?, ?)`, [
          name,
          slug,
          module,
          name,
        ])
      }
    }

    // Role → permission matrix (idempotent)
    for (const [roleSlug, permissionSlugs] of Object.entries(ROLE_PERMISSIONS)) {
      const role = get(`SELECT id FROM user_roles WHERE slug = ?`, [roleSlug])
      if (!role) continue
      for (const permissionSlug of permissionSlugs) {
        const permission = get(`SELECT id FROM permissions WHERE slug = ?`, [permissionSlug])
        if (!permission) continue
        const existing = get(`SELECT id FROM role_permissions WHERE role_id = ? AND permission_id = ?`, [
          role.id,
          permission.id,
        ])
        if (!existing) {
          run(`INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, [role.id, permission.id])
        }
      }
    }

    // Service categories
    SERVICE_CATEGORIES.forEach(([name, slug, description, icon], index) => {
      if (!get(`SELECT id FROM service_categories WHERE slug = ?`, [slug])) {
        run(
          `INSERT INTO service_categories (name, slug, description, icon, sort_order) VALUES (?, ?, ?, ?, ?)`,
          [name, slug, description, icon, index + 1],
        )
      }
    })

    // Announcement categories
    ANNOUNCEMENT_CATEGORIES.forEach(([name, slug, description], index) => {
      if (!get(`SELECT id FROM announcement_categories WHERE slug = ?`, [slug])) {
        run(
          `INSERT INTO announcement_categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)`,
          [name, slug, description, index + 1],
        )
      }
    })

    // Settings
    for (const [key, value, type, group, description, isPublic] of SETTINGS) {
      if (!get(`SELECT id FROM system_settings WHERE setting_key = ?`, [key])) {
        run(
          `INSERT INTO system_settings (setting_key, setting_value, setting_type, setting_group, description, is_public)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [key, value, type, group, description, isPublic],
        )
      }
    }

    // Homepage sections
    for (const [key, title, subtitle, body, order] of HOMEPAGE_SECTIONS) {
      if (!get(`SELECT id FROM homepage_sections WHERE section_key = ?`, [key])) {
        run(
          `INSERT INTO homepage_sections (section_key, title, subtitle, body, sort_order) VALUES (?, ?, ?, ?, ?)`,
          [key, title, subtitle, body, order],
        )
      }
    }

    // FAQs (platform usage only - no government claims)
    if (Number(get(`SELECT COUNT(*) AS total FROM faqs`).total) === 0) {
      FAQS.forEach(([question, answer, category], index) => {
        run(`INSERT INTO faqs (question, answer, category, sort_order) VALUES (?, ?, ?, ?)`, [
          question,
          answer,
          category,
          index + 1,
        ])
      })
    }

    // Legal documents (published as clearly labelled drafts)
    for (const doc of LEGAL_DOCS) {
      if (!get(`SELECT id FROM legal_documents WHERE doc_type = ? AND version = ?`, [doc.doc_type, doc.version])) {
        run(
          `INSERT INTO legal_documents (doc_type, title, version, content, status) VALUES (?, ?, ?, ?, ?)`,
          [doc.doc_type, doc.title, doc.version, doc.content, 'draft'],
        )
      }
    }

    // National emergency resources (verified contact details or official sites only)
    for (const item of NATIONAL_EMERGENCY) {
      const existing = get(`SELECT id FROM emergency_contacts WHERE organization_name = ?`, [
        item.organization_name,
      ])
      if (existing) continue
      run(
        `INSERT INTO emergency_contacts
          (organization_name, category, government_level, description, phone, website,
           publication_status, verification_status, source_reference, source_url, last_verified_at)
         VALUES (?, ?, 'national', ?, ?, ?, 'published', ?, ?, ?, ?)`,
        [
          item.organization_name,
          item.category,
          item.description,
          item.phone,
          item.website,
          item.verification_status,
          item.source_reference,
          item.source_url,
          nowIso(),
        ],
      )
    }

    // Retreat defaults for retention rules
    if (Number(get(`SELECT COUNT(*) AS total FROM retention_rules`).total) === 0) {
      const rules = [
        ['User profiles', 'Account management and platform features', 'While the account is active', 'Service delivery and consent', 'Secure deletion or anonymisation', '1 month after account closure'],
        ['Account security events', 'Account security and abuse prevention', '12 months rolling', 'Legitimate security interest', 'Secure deletion', 'Retain longer if required by an active investigation'],
        ['Consent records', 'Evidence of consent', 'Life of the account plus 2 years', 'Accountability', 'Secure deletion', 'Retained if needed to demonstrate compliance'],
        ['Citizen submissions', 'Responding to reports and feedback', '24 months after resolution', 'Service delivery', 'Secure deletion or anonymisation', 'Retained if subject to a legal hold'],
        ['Administrative audit logs', 'Accountability and security', '24 months rolling', 'Legitimate interest in accountability', 'Secure deletion', 'Retained longer for an active investigation'],
      ]
      for (const [category, purpose, period, basis, disposal, exceptions] of rules) {
        run(
          `INSERT INTO retention_rules (data_category, purpose, retention_period, legal_basis, disposal_method, approval_status)
           VALUES (?, ?, ?, ?, ?, 'pending')`,
          [category, purpose, period, basis, disposal],
        )
        // Exceptions are documented in the admin retention notes field.
        run(`UPDATE retention_rules SET disposal_method = ? WHERE data_category = ? AND approval_status = 'pending'`, [
          `${disposal}. Exceptions: ${exceptions}`,
          category,
        ])
      }
    }
  })

  seedPhase2({ quiet })
  seedPhase5b()

  log('[seed] base reference data ready')
}

export function resetDatabase() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset the database in production.')
  }
  db.exec('PRAGMA foreign_keys = OFF')
  const tables = all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
  for (const { name } of tables) db.exec(`DROP TABLE IF EXISTS "${name}"`)
  db.exec('PRAGMA foreign_keys = ON')
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  if (process.argv.includes('--reset')) {
    resetDatabase()
    console.log('[seed] database reset (development only)')
  }
  seed()
  console.log('[seed] done')
}
