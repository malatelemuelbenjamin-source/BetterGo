import { all, get, run } from './db.js'

/**
 * Phase 2 seed data.
 *
 * Only verifiable structure is seeded: the 25 service category groups with
 * their subcategories, Phase 2 permissions and their default role grants.
 * No government service records, fees, offices or officials are invented.
 */

const NEW_PERMISSIONS = [
  ['View service categories', 'services.categories.view', 'Government services'],
  ['Create service categories', 'services.categories.create', 'Government services'],
  ['Update service categories', 'services.categories.update', 'Government services'],
  ['Archive service categories', 'services.categories.archive', 'Government services'],
  ['Manage category display order', 'services.categories.manage_order', 'Government services'],
  ['Manage featured categories', 'services.categories.manage_featured', 'Government services'],
  ['Manage service requirements', 'services.requirements.manage', 'Government services'],
  ['Manage service procedures', 'services.procedures.manage', 'Government services'],
  ['Manage service fees', 'services.fees.manage', 'Government services'],
  ['Manage service documents and forms', 'services.documents.manage', 'Government services'],
  ['Manage service municipality coverage', 'services.coverage.manage', 'Government services'],
  ['Verify service information', 'services.verify', 'Government services'],
  ['Moderate service feedback', 'services.feedback.moderate', 'Government services'],
  ['Import service information', 'services.import', 'Government services'],
  ['Export service information', 'services.export', 'Government services'],
  ['View service analytics', 'services.analytics.view', 'Government services'],
  ['Manage official sources', 'services.sources.manage', 'Government services'],
  ['Manage public API keys', 'api.keys.manage', 'Audit and security'],
]

const MUNICIPAL_ADMIN_PHASE2 = [
  'services.categories.view',
  'services.requirements.manage',
  'services.procedures.manage',
  'services.fees.manage',
  'services.documents.manage',
  'services.coverage.manage',
  'services.verify',
  'services.feedback.moderate',
  'services.analytics.view',
  'services.sources.manage',
]

const EDITOR_PHASE2 = [
  'services.categories.view',
  'services.categories.create',
  'services.categories.update',
  'services.requirements.manage',
  'services.procedures.manage',
  'services.fees.manage',
  'services.documents.manage',
  'services.coverage.manage',
  'services.sources.manage',
]

const PROVINCIAL_PHASE2 = NEW_PERMISSIONS.map(([, slug]) => slug)

/** Description of each parent category, kept factual and short. */
const CATEGORY_TREE = [
  ['Civil Registration and Documents', 'civil-registration', 'FileText', 'Birth, marriage, death and other civil registry document services.', [
    ['Birth Registration', 'birth-registration'],
    ['Birth Certificate Requests', 'birth-certificate-requests'],
    ['Marriage Registration', 'marriage-registration'],
    ['Marriage Certificate Requests', 'marriage-certificate-requests'],
    ['Death Registration', 'death-registration'],
    ['Death Certificate Requests', 'death-certificate-requests'],
    ['Late Registration', 'late-registration'],
    ['Correction of Civil Registry Entries', 'civil-registry-correction'],
    ['Legitimation and Acknowledgment', 'legitimation-acknowledgment'],
    ['Adoption-Related Civil Registration Information', 'adoption-civil-registration'],
    ['Certified True Copies', 'certified-true-copies'],
    ['Other Civil Registry Services', 'other-civil-registry-services'],
  ]],
  ['Health and Medical Services', 'health', 'HeartPulse', 'Public health, hospital, medical assistance and PhilHealth information.', [
    ['Medical Assistance', 'medical-assistance'],
    ['Hospital Services', 'hospital-services'],
    ['Rural Health Unit Services', 'rural-health-unit-services'],
    ['Barangay Health Center Services', 'barangay-health-center-services'],
    ['Maternal and Child Health', 'maternal-child-health'],
    ['Immunization and Vaccination', 'immunization-vaccination'],
    ['Family Planning Services', 'family-planning-services'],
    ['Laboratory and Diagnostic Services', 'laboratory-diagnostic-services'],
    ['Public Health Programs', 'public-health-programs'],
    ['Disease Prevention and Control', 'disease-prevention-control'],
    ['Mental Health Information and Services', 'mental-health-services'],
    ['PhilHealth Assistance and Information', 'philhealth-assistance'],
    ['Medical Certificates', 'medical-certificates'],
    ['Health Insurance and Related Assistance', 'health-insurance-assistance'],
    ['Other Public Health Services', 'other-public-health-services'],
  ]],
  ['Social Welfare and Financial Assistance', 'social-welfare', 'HandHeart', 'Financial, medical, burial, educational and emergency assistance programs.', [
    ['Financial Assistance', 'financial-assistance'],
    ['Medical Financial Assistance', 'medical-financial-assistance'],
    ['Burial Assistance', 'burial-assistance'],
    ['Educational Assistance', 'educational-assistance'],
    ['Emergency Financial Assistance', 'emergency-financial-assistance'],
    ['Crisis Intervention', 'crisis-intervention'],
    ['Family Assistance Programs', 'family-assistance-programs'],
    ['Child Welfare Services', 'child-welfare-services'],
    ['Women and Family Protection Services', 'women-family-protection'],
    ['Assistance for Vulnerable Individuals', 'vulnerable-individual-assistance'],
    ['Livelihood Assistance', 'livelihood-assistance'],
    ['Disaster-Related Social Assistance', 'disaster-social-assistance'],
    ['Other Social Welfare Programs', 'other-social-welfare-programs'],
  ]],
  ['Senior Citizen Services', 'senior-citizens', 'Users', 'Senior citizen registration, benefits, discounts and assistance information.', [
    ['Senior Citizen Registration', 'senior-citizen-registration'],
    ['Senior Citizen Identification Cards', 'senior-citizen-id'],
    ['Senior Citizen Benefits', 'senior-citizen-benefits'],
    ['Medical Assistance for Senior Citizens', 'senior-citizen-medical-assistance'],
    ['Social Pension Information', 'social-pension-information'],
    ['Senior Citizen Discounts and Privileges', 'senior-citizen-discounts'],
    ['Senior Citizen Programs', 'senior-citizen-programs'],
    ['Other Senior Citizen Services', 'other-senior-citizen-services'],
  ]],
  ['Persons with Disabilities (PWD) Services', 'pwd', 'Accessibility', 'PWD registration, benefits, assistance and accessibility support.', [
    ['PWD Registration', 'pwd-registration'],
    ['PWD Identification Cards', 'pwd-id'],
    ['PWD Benefits and Privileges', 'pwd-benefits'],
    ['PWD Medical Assistance', 'pwd-medical-assistance'],
    ['PWD Educational Assistance', 'pwd-educational-assistance'],
    ['PWD Livelihood Programs', 'pwd-livelihood-programs'],
    ['Accessibility Support', 'accessibility-support'],
    ['Rehabilitation and Support Services', 'rehabilitation-support-services'],
    ['Other PWD Services', 'other-pwd-services'],
  ]],
  ['Solo Parent and Family Services', 'solo-parent-family', 'UsersRound', 'Solo parent registration, benefits and family support services.', [
    ['Solo Parent Registration', 'solo-parent-registration'],
    ['Solo Parent Identification Cards', 'solo-parent-id'],
    ['Solo Parent Benefits', 'solo-parent-benefits'],
    ['Family Assistance', 'family-assistance'],
    ['Child Support and Welfare Information', 'child-support-welfare'],
    ['Parenting Programs', 'parenting-programs'],
    ['Family Development Services', 'family-development-services'],
    ['Other Family Support Services', 'other-family-support-services'],
  ]],
  ['Business Permits and Registration', 'business-permits', 'BriefcaseBusiness', 'Business permits, renewals, clearances and registration guidance.', [
    ['New Business Permit', 'new-business-permit'],
    ['Business Permit Renewal', 'business-permit-renewal'],
    ['Business Registration Guidance', 'business-registration-guidance'],
    ['Barangay Business Clearance', 'barangay-business-clearance'],
    ["Mayor's Permit", 'mayors-permit'],
    ['Zoning and Locational Clearance', 'zoning-locational-clearance'],
    ['Sanitary Permit', 'sanitary-permit'],
    ['Fire Safety Inspection Requirements', 'fire-safety-inspection'],
    ['Business Closure and Retirement', 'business-closure-retirement'],
    ['Business Permit Amendments', 'business-permit-amendments'],
    ['Market Vendor Registration', 'market-vendor-registration'],
    ['Other Business-Related Permits', 'other-business-permits'],
  ]],
  ['Taxation and Revenue Services', 'taxation', 'Receipt', 'Property tax, business tax, clearances and revenue services.', [
    ['Real Property Tax', 'real-property-tax'],
    ['Tax Declaration Information', 'tax-declaration-information'],
    ['Property Assessment', 'property-assessment'],
    ['Local Business Tax', 'local-business-tax'],
    ['Tax Payment Information', 'tax-payment-information'],
    ['Tax Clearance', 'tax-clearance'],
    ['Community Tax Certificate', 'community-tax-certificate'],
    ['Revenue and Collection Services', 'revenue-collection-services'],
    ['Other Tax-Related Services', 'other-tax-services'],
  ]],
  ['Building, Construction and Property Services', 'building-property', 'Building2', 'Building and construction permits, zoning and property records.', [
    ['Building Permit', 'building-permit'],
    ['Occupancy Permit', 'occupancy-permit'],
    ['Electrical Permit', 'electrical-permit'],
    ['Plumbing Permit', 'plumbing-permit'],
    ['Mechanical Permit', 'mechanical-permit'],
    ['Fencing Permit', 'fencing-permit'],
    ['Excavation Permit', 'excavation-permit'],
    ['Demolition Permit', 'demolition-permit'],
    ['Land Use and Zoning Information', 'land-use-zoning'],
    ['Property Records and Assessment', 'property-records-assessment'],
    ['Other Construction-Related Permits', 'other-construction-permits'],
  ]],
  ['Education and Scholarship Services', 'education', 'GraduationCap', 'Scholarships, student assistance, grants and training programs.', [
    ['Provincial Scholarships', 'provincial-scholarships'],
    ['Municipal Scholarships', 'municipal-scholarships'],
    ['Educational Financial Assistance', 'educational-financial-assistance'],
    ['Student Grants', 'student-grants'],
    ['Technical and Vocational Training', 'technical-vocational-training'],
    ['TESDA-Related Programs', 'tesda-programs'],
    ['Alternative Learning System Information', 'alternative-learning-system'],
    ['School Assistance Programs', 'school-assistance-programs'],
    ['Educational Support for Vulnerable Communities', 'education-support-vulnerable-communities'],
    ['Other Education Programs', 'other-education-programs'],
  ]],
  ['Employment and Career Services', 'employment', 'Briefcase', 'Job placement, employment registration, job fairs and skills training.', [
    ['Job Placement Assistance', 'job-placement-assistance'],
    ['Local Employment Services', 'local-employment-services'],
    ['Job Fairs', 'job-fairs'],
    ['Employment Registration', 'employment-registration'],
    ['Skills Training', 'skills-training'],
    ['Career Guidance', 'career-guidance'],
    ['Government Employment Programs', 'government-employment-programs'],
    ['Overseas Employment Information', 'overseas-employment-information'],
    ['Labor-Related Assistance', 'labor-assistance'],
    ['Other Employment Services', 'other-employment-services'],
  ]],
  ['Livelihood and Entrepreneurship', 'livelihood', 'Store', 'Livelihood assistance, microenterprise support and entrepreneurship training.', [
    ['Livelihood Assistance', 'livelihood-assistance-programs'],
    ['Small Business Support', 'small-business-support'],
    ['Microenterprise Programs', 'microenterprise-programs'],
    ['Entrepreneurship Training', 'entrepreneurship-training'],
    ['Cooperative Development', 'cooperative-development'],
    ['Business Development Assistance', 'business-development-assistance'],
    ['Financial Support Programs', 'financial-support-programs'],
    ['Other Livelihood Programs', 'other-livelihood-programs'],
  ]],
  ['Agriculture and Farming Services', 'agriculture', 'Sprout', 'Farmer registration, farm inputs, training and agricultural assistance.', [
    ['Farmer Registration', 'farmer-registration'],
    ['Agricultural Assistance', 'agricultural-assistance'],
    ['Farm Input Assistance', 'farm-input-assistance'],
    ['Seeds and Planting Materials', 'seeds-planting-materials'],
    ['Fertilizer Assistance', 'fertilizer-assistance'],
    ['Farm Equipment Support', 'farm-equipment-support'],
    ['Agricultural Training', 'agricultural-training'],
    ['Crop Insurance Information', 'crop-insurance-information'],
    ['Pest and Disease Management', 'pest-disease-management'],
    ['Irrigation Assistance', 'irrigation-assistance'],
    ['Agricultural Certification', 'agricultural-certification'],
    ['Other Farming Services', 'other-farming-services'],
  ]],
  ['Fisheries and Aquatic Resources', 'fisheries', 'Fish', 'Fisherfolk registration, fishing permits and fisheries assistance.', [
    ['Fisherfolk Registration', 'fisherfolk-registration'],
    ['Fisherfolk Identification Information', 'fisherfolk-identification'],
    ['Fishing Boat Registration Information', 'fishing-boat-registration'],
    ['Fishing Permits and Licensing', 'fishing-permits-licensing'],
    ['Fisheries Assistance', 'fisheries-assistance'],
    ['Fishing Equipment Support', 'fishing-equipment-support'],
    ['Aquaculture Assistance', 'aquaculture-assistance'],
    ['Fisheries Training', 'fisheries-training'],
    ['Coastal Resource Management', 'coastal-resource-management'],
    ['Other Fisheries Services', 'other-fisheries-services'],
  ]],
  ['Environment and Natural Resources', 'environment', 'Trees', 'Environmental permits, waste management and conservation programs.', [
    ['Environmental Permits', 'environmental-permits'],
    ['Environmental Compliance Information', 'environmental-compliance-information'],
    ['Waste Management Services', 'waste-management-services'],
    ['Tree Cutting Permit Information', 'tree-cutting-permit'],
    ['Environmental Complaints', 'environmental-complaints'],
    ['Coastal Protection Programs', 'coastal-protection-programs'],
    ['Forest and Natural Resource Services', 'forest-natural-resource-services'],
    ['Water Resource Information', 'water-resource-information'],
    ['Environmental Education', 'environmental-education'],
    ['Other Environmental Services', 'other-environmental-services'],
  ]],
  ['Housing and Land Services', 'housing', 'House', 'Housing assistance, land records and community housing programs.', [
    ['Housing Assistance', 'housing-assistance'],
    ['Socialized Housing Information', 'socialized-housing-information'],
    ['Housing Registration', 'housing-registration'],
    ['Land Records and Documentation', 'land-records-documentation'],
    ['Property Tax Declaration', 'property-tax-declaration'],
    ['Housing-Related Financial Assistance', 'housing-financial-assistance'],
    ['Community Housing Programs', 'community-housing-programs'],
    ['Other Housing Services', 'other-housing-services'],
  ]],
  ['Transportation and Vehicle Services', 'transportation', 'Car', 'Licensing, vehicle registration, franchises and transport permits.', [
    ["Driver's License Information", 'drivers-license-information'],
    ['Vehicle Registration Information', 'vehicle-registration-information'],
    ['Land Transportation Services', 'land-transportation-services'],
    ['Public Transport Permits', 'public-transport-permits'],
    ['Tricycle Franchise Information', 'tricycle-franchise-information'],
    ['Transport Operator Assistance', 'transport-operator-assistance'],
    ['Traffic-Related Services', 'traffic-related-services'],
    ['Other Transportation Services', 'other-transportation-services'],
  ]],
  ['Public Safety and Security', 'public-safety', 'ShieldCheck', 'Police, fire protection, safety certification and peace and order services.', [
    ['Police Assistance', 'police-assistance'],
    ['Fire Protection Services', 'fire-protection-services'],
    ['Fire Safety Certification', 'fire-safety-certification'],
    ['Public Safety Information', 'public-safety-information'],
    ['Community Peace and Order', 'community-peace-order'],
    ['Emergency Response Information', 'emergency-response-information'],
    ['Crime Prevention Programs', 'crime-prevention-programs'],
    ['Other Public Safety Services', 'other-public-safety-services'],
  ]],
  ['Disaster Risk Reduction and Emergency Assistance', 'disaster', 'LifeBuoy', 'Disaster assistance, relief, evacuation and recovery information.', [
    ['Disaster Assistance', 'disaster-assistance'],
    ['Emergency Financial Assistance', 'disaster-emergency-financial-assistance'],
    ['Evacuation Information', 'evacuation-information'],
    ['Relief Assistance', 'relief-assistance'],
    ['Emergency Preparedness Programs', 'emergency-preparedness-programs'],
    ['Disaster Victim Assistance', 'disaster-victim-assistance'],
    ['Recovery and Rehabilitation Assistance', 'recovery-rehabilitation-assistance'],
    ['Emergency Coordination Information', 'emergency-coordination-information'],
    ['Other Disaster Assistance Services', 'other-disaster-assistance'],
  ]],
  ['Youth and Sports Development', 'youth-sports', 'Trophy', 'Youth programs, scholarships, leadership and sports development.', [
    ['Youth Registration and Participation', 'youth-registration-participation'],
    ['Youth Development Programs', 'youth-development-programs'],
    ['Youth Scholarships', 'youth-scholarships'],
    ['Youth Leadership Programs', 'youth-leadership-programs'],
    ['Sports Development', 'sports-development'],
    ['Sports Training', 'sports-training'],
    ['Athletic Assistance', 'athletic-assistance'],
    ['Youth Livelihood Programs', 'youth-livelihood-programs'],
    ['Other Youth Services', 'other-youth-services'],
  ]],
  ['Tourism and Cultural Services', 'tourism-culture', 'MapPinned', 'Tourism information, accreditation, culture and heritage programs.', [
    ['Tourism Information', 'tourism-information'],
    ['Tourism Accreditation Information', 'tourism-accreditation-information'],
    ['Tourism Business Assistance', 'tourism-business-assistance'],
    ['Cultural Heritage Programs', 'cultural-heritage-programs'],
    ['Local Festival Information', 'local-festival-information'],
    ['Tourism Livelihood Support', 'tourism-livelihood-support'],
    ['Cultural Development Programs', 'cultural-development-programs'],
    ['Other Tourism Services', 'other-tourism-services'],
  ]],
  ['Legal and Public Document Services', 'legal-documents', 'Scale', 'Legal aid, certifications and public document assistance.', [
    ['Legal Assistance', 'legal-assistance'],
    ['Public Attorney Services', 'public-attorney-services'],
    ['Legal Aid Information', 'legal-aid-information'],
    ['Notarial Service Information', 'notarial-service-information'],
    ['Barangay Certification', 'barangay-certification'],
    ['Residency Certification', 'residency-certification'],
    ['Indigency Certification', 'indigency-certification'],
    ['Other Government Certifications', 'other-government-certifications'],
    ['Other Legal Assistance Services', 'other-legal-assistance-services'],
  ]],
  ['Barangay Services', 'barangay', 'Landmark', 'Barangay clearances, certifications and community assistance.', [
    ['Barangay Clearance', 'barangay-clearance'],
    ['Certificate of Residency', 'certificate-of-residency'],
    ['Certificate of Indigency', 'certificate-of-indigency'],
    ['Barangay Mediation and Conciliation', 'barangay-mediation-conciliation'],
    ['Community Assistance', 'community-assistance'],
    ['Barangay Health Services', 'barangay-health-services'],
    ['Barangay Social Welfare Assistance', 'barangay-social-welfare-assistance'],
    ['Other Barangay Services', 'other-barangay-services'],
  ]],
  ['Government Employee and Public Service Information', 'government-employment', 'ContactRound', 'Government careers, recruitment and civil service information.', [
    ['Government Employment Information', 'government-employment-information'],
    ['Government Recruitment', 'government-recruitment'],
    ['Public Service Career Information', 'public-service-career-information'],
    ['Government Employee Assistance', 'government-employee-assistance'],
    ['Civil Service Examination Information', 'civil-service-examination-information'],
    ['Government Training Programs', 'government-training-programs'],
    ['Other Public Employment Services', 'other-public-employment-services'],
  ]],
  ['Other Government Services', 'other-services', 'FolderOpen', 'A fallback category for services that do not fit another category.', [
    ['General Government Assistance', 'general-government-assistance'],
    ['Public Information Requests', 'public-information-requests'],
    ['Government Office Transactions', 'government-office-transactions'],
    ['Other Provincial Services', 'other-provincial-services'],
    ['Other Municipal Services', 'other-municipal-services'],
    ['Other National Government Services', 'other-national-government-services'],
  ]],
]

/**
 * Phase 1 already seeded twelve broader categories. They are reused as the
 * Phase 2 parents instead of creating competing duplicates; all existing
 * services keep their category reference.
 */
const LEGACY_ALIASES = {
  'civil-registration': 'civil-registry',
  health: 'health-medical',
  'senior-citizens': 'senior-citizen',
  pwd: 'pwd-services',
  education: 'education-scholarships',
  employment: 'employment-livelihood',
  agriculture: 'agriculture-fisheries',
  housing: 'housing-community',
  disaster: 'disaster-emergency',
  'youth-sports': 'youth-development',
}

/** Categories highlighted on the homepage and directory landing page. */
const FEATURED = new Set(['civil-registration', 'health', 'social-welfare', 'business-permits', 'education', 'employment'])

/**
 * A development database seeded by an early Phase 2 build can contain both a
 * Phase 1 category and its Phase 2 replacement. Merge them without deleting
 * anything: children and services move to the canonical record and the
 * duplicate is archived.
 */
function reconcileDuplicateCategories() {
  const merges = [
    ['civil-registration', 'civil-registry'],
    ['pwd', 'pwd-services'],
    ['education', 'education-scholarships'],
    ['employment', 'employment-livelihood'],
    ['housing', 'housing-community'],
    ['youth-sports', 'youth-development'],
    ['disaster', 'disaster-emergency'],
    ['agriculture', 'agriculture-fisheries'],
  ]
  let merged = 0
  for (const [duplicateSlug, canonicalSlug] of merges) {
    const duplicate = get(`SELECT * FROM service_categories WHERE slug = ?`, [duplicateSlug])
    const canonical = get(`SELECT * FROM service_categories WHERE slug = ?`, [canonicalSlug])
    if (!duplicate || !canonical || duplicate.id === canonical.id) continue
    if (duplicate.status === 'inactive' && duplicate.is_active === 0) continue
    run(`UPDATE service_categories SET parent_id = ? WHERE parent_id = ?`, [canonical.id, duplicate.id])
    run(`UPDATE government_services SET category_id = ? WHERE category_id = ?`, [canonical.id, duplicate.id])
    run(`UPDATE service_categories SET status = 'inactive', is_active = 0, parent_id = NULL, updated_at = ? WHERE id = ?`, [
      new Date().toISOString(),
      duplicate.id,
    ])
    if (duplicate.is_featured) run(`UPDATE service_categories SET is_featured = 1 WHERE id = ?`, [canonical.id])
    merged += 1
  }
  return merged
}

function grant(roleSlug, slugs) {
  const role = get(`SELECT id FROM user_roles WHERE slug = ?`, [roleSlug])
  if (!role) return
  for (const slug of slugs) {
    const permission = get(`SELECT id FROM permissions WHERE slug = ?`, [slug])
    if (!permission) continue
    if (!get(`SELECT id FROM role_permissions WHERE role_id = ? AND permission_id = ?`, [role.id, permission.id])) {
      run(`INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, [role.id, permission.id])
    }
  }
}

export function seedPhase2({ quiet = true } = {}) {
  let permissionCount = 0
  for (const [name, slug, module] of NEW_PERMISSIONS) {
    if (!get(`SELECT id FROM permissions WHERE slug = ?`, [slug])) {
      run(`INSERT INTO permissions (name, slug, module) VALUES (?, ?, ?)`, [name, slug, module])
      permissionCount += 1
    }
  }

  // Default grants. Existing custom grants are never removed.
  const allPhase2 = NEW_PERMISSIONS.map(([, slug]) => slug)
  grant('municipal_admin', MUNICIPAL_ADMIN_PHASE2)
  grant('content_editor', EDITOR_PHASE2)
  grant('provincial_admin', PROVINCIAL_PHASE2)
  grant('super_admin', allPhase2)

  const merged = reconcileDuplicateCategories()

  let parentCount = 0
  let childCount = 0
  CATEGORY_TREE.forEach(([name, slug, icon, description, children], index) => {
    const alias = LEGACY_ALIASES[slug]
    let parent = alias ? get(`SELECT * FROM service_categories WHERE slug = ?`, [alias]) : null
    parent = parent || get(`SELECT * FROM service_categories WHERE slug = ?`, [slug])
    const byName = parent ? null : get(`SELECT * FROM service_categories WHERE lower(name) = lower(?) ORDER BY id LIMIT 1`, [name])
    parent = parent || byName
    if (!parent) {
      const result = run(
        `INSERT INTO service_categories (name, slug, description, icon, sort_order, parent_id, is_featured, status, category_group)
         VALUES (?, ?, ?, ?, ?, NULL, ?, 'active', 'services')`,
        [name, slug, description, icon, index + 1, FEATURED.has(slug) ? 1 : 0],
      )
      parent = { id: Number(result.lastInsertRowid) }
      parentCount += 1
    } else {
      // Fill only missing presentation data; never overwrite admin edits.
      if (!parent.description) run(`UPDATE service_categories SET description = ? WHERE id = ?`, [description, parent.id])
      if (!parent.icon) run(`UPDATE service_categories SET icon = ? WHERE id = ?`, [icon, parent.id])
      if (!parent.category_group) run(`UPDATE service_categories SET category_group = 'services' WHERE id = ?`, [parent.id])
      if (FEATURED.has(slug) && !parent.is_featured) {
        run(`UPDATE service_categories SET is_featured = 1 WHERE id = ?`, [parent.id])
      }
    }

    children.forEach(([childName, childSlug], childIndex) => {
      const exists = get(`SELECT id, parent_id FROM service_categories WHERE slug = ?`, [childSlug])
      if (exists && Number(exists.parent_id) === Number(parent.id)) return
      if (exists) return // slug already used by an unrelated category: leave it untouched.
      run(
        `INSERT INTO service_categories (name, slug, description, icon, sort_order, parent_id, category_group, status)
         VALUES (?, ?, ?, ?, ?, ?, 'services', 'active')`,
        [childName, childSlug, `${childName} — ${name}.`, icon, childIndex + 1 + 1000, parent.id],
      )
      childCount += 1
    })
  })

  if (!quiet) {
    const totalParents = Number(get(`SELECT COUNT(*) AS n FROM service_categories WHERE status = 'active' AND parent_id IS NULL`).n)
    const totalChildren = Number(get(`SELECT COUNT(*) AS n FROM service_categories WHERE parent_id IS NOT NULL`).n)
    console.log(`[seed] service categories: ${totalParents} active parent, ${totalChildren} subcategory (${parentCount} new parents, ${childCount} new subcategories, ${merged} duplicate(s) merged, ${permissionCount} new permissions)`)
  }

  return { permissionCount, parentCount, childCount }
}

/** Every category in tree form, used by the seed tests and admin tooling. */
export function categoryTree() {
  const rows = all(`SELECT id, name, slug, parent_id, icon, sort_order, is_featured, status FROM service_categories ORDER BY sort_order, name`)
  return rows
}
