import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { PublicLayout, DashboardLayout, AdminLayout, PageHeader } from './components/layout'
import { RequireAuth, RequireAdmin } from './auth'
import { EmptyState } from './components/ui'
import { Link } from 'react-router-dom'

import Home from './pages/Home'
import SearchPage from './pages/SearchPage'
import { ServicesList, ServiceDetail, ServiceCategoryPage } from './pages/Services'
import {
  ServiceCategoriesPage,
  ServiceCoveragePage,
  ServiceFaqsPage,
  ServiceResourcesPage,
  DevelopersPage,
  ApiDocsPage,
} from './pages/ServiceExtras'
import { AnnouncementsList, AnnouncementDetail } from './pages/Announcements'
import { MunicipalitiesList } from './pages/Municipalities'
import { MunicipalPortal, MunicipalSectionPage, MunicipalContentDetail } from './pages/MunicipalPortal'
import {
  MunicipalProjects,
  MunicipalProjectDetail,
  MunicipalPrograms,
  MunicipalResources,
  MunicipalFaqs,
  MunicipalOfficeMap,
  MunicipalDiscovery,
  MunicipalFeedbackPage,
} from './pages/MunicipalExtras'
import { DirectoryList, OfficeDetail } from './pages/Directory'
import { TransparencyDashboard, DocumentsList, DocumentDetail } from './pages/Transparency'
import { EmergencyHome, EmergencyMunicipality, EmergencyCategory } from './pages/Emergency'
import FinanceHub from './pages/transparency/FinanceHub'
import BudgetExplorer from './pages/transparency/BudgetExplorer'
import FinanceModule, { FinanceRecordDetail } from './pages/transparency/FinanceModule'
import { AdminTransparencyFinance } from './pages/admin/TransparencyFinance'
import {
  AdminMonitoring,
  AdminReports as AdminTransparencyReports,
  AdminOpenData,
  AdminAlerts,
  AdminCommunity,
} from './pages/admin/TransparencyPrograms'
import FinancialMonitoring from './pages/transparency/FinancialMonitoring'
import ReportsPage, { SharedReport } from './pages/transparency/Reports'
import OpenData from './pages/transparency/OpenData'
import Alerts from './pages/transparency/Alerts'
import Community from './pages/transparency/Community'
import { AboutPage, ContactPage, DataRequestsPage, ReportSecurityPage } from './pages/Info'
import { LegalPage } from './pages/Legal'
import { LoginPage, RegisterPage, VerifyEmailPage, ForgotPasswordPage, ResetPasswordPage } from './pages/Auth'
import {
  DashboardHome,
  ProfilePage,
  ProfileEditPage,
  AccountPage,
  PreferencesPage,
  PrivacyPage,
  PrivacyRequestsPage,
  SavedServicesPage,
  MyReportsPage,
  ApplicationsPage,
  ApplicationDetailPage,
  ActivityPage,
  DocumentsPage,
} from './pages/Dashboard'
import NotificationsPage from './pages/Notifications'
import RecordsPage from './pages/Records'
import NotificationSettings from './pages/NotificationSettings'
import HelpPage from './pages/Help'
import { FeedbackPage, SurveyPage } from './pages/Feedback'
import PrivacyCenter from './pages/PrivacyCenter'
import DiscoverPage from './pages/Discover'
import AssistancePage from './pages/Assistance'
import AppointmentsPage from './pages/Appointments'
import PaymentsPage from './pages/Payments'
import DocumentRequestsPage from './pages/DocumentRequests'
import ComplaintsPage from './pages/Complaints'
import IdentityPage from './pages/Identity'
import DelegationsPage from './pages/Delegations'
import ConsentPage from './pages/Consent'
import PersonalizationPage from './pages/Personalization'
import OfflinePage from './pages/Offline'
import TranslationsPage from './pages/Translations'
import PortabilityPage from './pages/Portability'
import SecurityPage from './pages/Security'
import ServiceJourneysPage from './pages/ServiceJourneys'
import { SupportPage, SupportDetailPage } from './pages/Support'
import ApplyPage from './pages/Apply'
import { AdminForms, AdminFormEditor } from './pages/admin/Forms'
import { AdminApplications, AdminApplicationDetail } from './pages/admin/Applications'
import { AdminRecords } from './pages/admin/Records'
import { AdminNotifications } from './pages/admin/Notifications'
import { AdminSupport } from './pages/admin/Support'
import { AdminFeedback } from './pages/admin/Feedback'
import { AdminPrivacyCenter } from './pages/admin/Privacy'
import { AdminDiscovery } from './pages/admin/Discovery'
import { AdminRequirements } from './pages/admin/Requirements'
import { AdminAppointments } from './pages/admin/Appointments'
import { AdminPayments } from './pages/admin/Payments'
import { AdminDocumentRequests } from './pages/admin/DocumentRequests'
import { AdminComplaints } from './pages/admin/Complaints'
import { AdminIdentity } from './pages/admin/Identity'
import { AdminConsent } from './pages/admin/Consent'
import { AdminPersonalization } from './pages/admin/Personalization'
import { AdminOffline } from './pages/admin/Offline'
import { AdminTranslations } from './pages/admin/Translations'
import { AdminClosure } from './pages/admin/Closure'
import { AdminSecurity } from './pages/admin/Security'
import { AdminJourneys } from './pages/admin/Journeys'
import { AdminDataExports } from './pages/admin/DataExports'
import { AdminAccountDeletion } from './pages/admin/AccountDeletion'
import AccountManagementPage from './pages/AccountManagement'
import ConsentRequestsPage from './pages/ConsentRequests'
import { AdminConsentRequests } from './pages/admin/ConsentRequests'
import {
  AdminOverview,
  AdminAnalytics,
  AdminUsers,
  AdminUserDetail,
  AdminRoles,
  AdminAuditLogs,
  AdminSettings,
  AdminReports,
  AdminPrivacy,
  AdminMunicipalities,
  AdminProfile,
} from './pages/admin/Admin'
import { AdminServiceDashboard } from './pages/admin/ServiceAdmin'
import { AdminMunicipalWorkspace } from './pages/admin/MunicipalWorkspace'
import { AdminMunicipalModules } from './pages/admin/MunicipalModules'
import {
  AdminAnnouncements,
  AdminDirectory,
  AdminTransparency,
  AdminEmergency,
  AdminCms,
} from './pages/admin/Content'

function OfficeRedirect() {
  const { slug } = useParams()
  return <Navigate to={slug ? `/government-directory/${slug}` : '/government-directory'} replace />
}

function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" description="The page you are looking for may have moved or no longer exists." />
      <div className="container section-tight">
        <EmptyState
          title="We could not find that page"
          description="Check the address, or start again from the homepage. If you followed a link from within BetterGo, please report it."
          action={
            <div className="row" style={{ justifyContent: 'center' }}>
              <Link className="btn btn-primary" to="/">Back to homepage</Link>
              <Link className="btn btn-outline" to="/search">Search public information</Link>
            </div>
          }
        />
      </div>
    </>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<SearchPage />} />

        <Route path="/services" element={<ServicesList />} />
        <Route path="/services/categories" element={<ServiceCategoriesPage />} />
        <Route path="/services/categories/:slug" element={<ServiceCategoryPage />} />
        <Route path="/services/category/:slug" element={<ServiceCategoryPage />} />
        <Route path="/services/:slug" element={<ServiceDetail />} />
        <Route path="/service-coverage" element={<ServiceCoveragePage />} />
        <Route path="/resources" element={<ServiceResourcesPage />} />
        <Route path="/faqs" element={<ServiceFaqsPage />} />
        <Route path="/developers" element={<DevelopersPage />} />
        <Route path="/developers/api-docs" element={<ApiDocsPage />} />
        <Route path="/offices" element={<Navigate to="/government-directory" replace />} />
        <Route path="/offices/:slug" element={<OfficeRedirect />} />

        <Route path="/announcements" element={<AnnouncementsList />} />
        <Route path="/announcements/:slug" element={<AnnouncementDetail />} />

        <Route path="/municipalities" element={<MunicipalitiesList />} />
        <Route path="/municipalities/:slug" element={<MunicipalPortal />} />
        <Route path="/municipalities/:slug/content/:contentSlug" element={<MunicipalContentDetail />} />
        <Route path="/municipalities/:slug/about" element={<MunicipalSectionPage section="about" />} />
        <Route path="/municipalities/:slug/services" element={<MunicipalSectionPage section="services" />} />
        <Route path="/municipalities/:slug/offices" element={<MunicipalSectionPage section="offices" />} />
        <Route path="/municipalities/:slug/announcements" element={<MunicipalSectionPage section="announcements" />} />
        <Route path="/municipalities/:slug/news" element={<MunicipalSectionPage section="news" />} />
        <Route path="/municipalities/:slug/projects" element={<MunicipalSectionPage section="projects" />} />
        <Route path="/municipalities/:slug/projects/:projectSlug" element={<MunicipalProjectDetail />} />
        <Route path="/municipalities/:slug/programs" element={<MunicipalSectionPage section="programs" />} />
        <Route path="/municipalities/:slug/programs/:projectSlug" element={<MunicipalProjectDetail />} />
        <Route path="/municipalities/:slug/resources" element={<MunicipalSectionPage section="resources" />} />
        <Route path="/municipalities/:slug/faqs" element={<MunicipalSectionPage section="faqs" />} />
        <Route path="/municipalities/:slug/contact" element={<MunicipalSectionPage section="contact" />} />

        <Route path="/municipal-projects" element={<MunicipalProjects />} />
        <Route path="/municipal-programs" element={<MunicipalPrograms />} />
        <Route path="/municipal-resources" element={<MunicipalResources />} />
        <Route path="/municipal-faqs" element={<MunicipalFaqs />} />
        <Route path="/municipal-offices" element={<MunicipalOfficeMap />} />
        <Route path="/municipal-search" element={<MunicipalDiscovery />} />
        <Route path="/municipal-feedback" element={<MunicipalFeedbackPage />} />

        <Route path="/government-directory" element={<DirectoryList />} />
        <Route path="/government-directory/:slug" element={<OfficeDetail />} />

        <Route path="/transparency" element={<TransparencyDashboard />} />
        <Route path="/transparency/finance" element={<FinanceHub />} />
        <Route path="/transparency/finance/record/:reference" element={<FinanceRecordDetail />} />
        <Route path="/transparency/finance/:module" element={<FinanceModule />} />
        <Route path="/transparency/budgets" element={<BudgetExplorer />} />
        <Route path="/transparency/budgets/:entity" element={<BudgetExplorer />} />

        <Route path="/transparency/financial-monitoring" element={<FinancialMonitoring />} />
        <Route path="/transparency/financial-monitoring/:entity" element={<FinancialMonitoring />} />

        <Route path="/transparency/reports" element={<ReportsPage />} />
        <Route path="/transparency/reports/builder" element={<ReportsPage mode="builder" />} />
        <Route path="/transparency/reports/saved" element={<ReportsPage mode="saved" />} />
        <Route path="/transparency/reports/methodology" element={<ReportsPage mode="methodology" />} />
        <Route path="/transparency/reports/provincial" element={<ReportsPage mode="builder" entity="provincial" />} />
        <Route path="/transparency/reports/municipal" element={<ReportsPage mode="builder" />} />
        <Route path="/transparency/reports/shared/:token" element={<SharedReport />} />

        <Route path="/transparency/open-data" element={<OpenData />} />
        <Route path="/transparency/open-data/datasets" element={<OpenData mode="datasets" />} />
        <Route path="/transparency/open-data/categories" element={<OpenData mode="categories" />} />
        <Route path="/transparency/open-data/dataset/:slug" element={<OpenData mode="detail" />} />
        <Route path="/transparency/open-data/downloads" element={<OpenData mode="downloads" />} />
        <Route path="/transparency/open-data/methodology" element={<OpenData mode="methodology" />} />

        <Route path="/transparency/alerts" element={<Alerts />} />
        <Route path="/transparency/alerts/subscriptions" element={<Alerts mode="subscriptions" />} />
        <Route path="/transparency/alerts/history" element={<Alerts mode="history" />} />
        <Route path="/transparency/alerts/preferences" element={<Alerts mode="preferences" />} />

        <Route path="/transparency/community" element={<Community />} />
        <Route path="/transparency/community/questions" element={<Community mode="questions" />} />
        <Route path="/transparency/community/discussions" element={<Community mode="discussions" />} />
        <Route path="/transparency/community/questions/:reference" element={<Community mode="detail" />} />
        <Route path="/transparency/community/discussions/:reference" element={<Community mode="detail" />} />
        <Route path="/transparency/community/topics" element={<Community mode="topics" />} />
        <Route path="/transparency/community/experts" element={<Community mode="experts" />} />
        <Route path="/transparency/community/guidelines" element={<Community mode="guidelines" />} />
        <Route path="/transparency/documents" element={<DocumentsList />} />
        <Route path="/transparency/documents/:slug" element={<DocumentDetail />} />
        <Route path="/apply/:slug" element={<ApplyPage />} />
        <Route path="/account/documents" element={<Navigate to="/dashboard/documents" replace />} />
        <Route path="/account/records" element={<Navigate to="/dashboard/records" replace />} />
        <Route path="/account/notification-settings" element={<Navigate to="/dashboard/notification-settings" replace />} />
        <Route path="/account/support" element={<Navigate to="/dashboard/support" replace />} />
        <Route path="/account/privacy" element={<Navigate to="/dashboard/privacy-center" replace />} />
        <Route path="/account/discover" element={<Navigate to="/dashboard/discover" replace />} />
        <Route path="/account/assistance" element={<Navigate to="/dashboard/assistance" replace />} />
        <Route path="/account/appointments" element={<Navigate to="/dashboard/appointments" replace />} />
        <Route path="/account/payments" element={<Navigate to="/dashboard/payments" replace />} />
        <Route path="/account/document-requests" element={<Navigate to="/dashboard/document-requests" replace />} />
        <Route path="/account/complaints" element={<Navigate to="/dashboard/complaints" replace />} />
        <Route path="/account/identity" element={<Navigate to="/dashboard/identity" replace />} />
        <Route path="/account/delegations" element={<Navigate to="/dashboard/delegations" replace />} />
        <Route path="/account/consent" element={<Navigate to="/dashboard/consent" replace />} />
        <Route path="/account/personalization" element={<Navigate to="/dashboard/personalization" replace />} />
        <Route path="/account/dashboard" element={<Navigate to="/dashboard" replace />} />
        <Route path="/account/profile" element={<Navigate to="/dashboard/profile" replace />} />
        <Route path="/account/preferences" element={<Navigate to="/dashboard/preferences" replace />} />
        <Route path="/account/saved" element={<Navigate to="/dashboard/saved" replace />} />
        <Route path="/account/applications" element={<Navigate to="/dashboard/applications" replace />} />
        <Route path="/account/notifications" element={<Navigate to="/dashboard/notifications" replace />} />
        <Route path="/account/reports" element={<Navigate to="/dashboard/reports" replace />} />
        <Route path="/account/authorized-representatives" element={<Navigate to="/dashboard/delegations" replace />} />
        <Route path="/account/consents" element={<Navigate to="/dashboard/consent" replace />} />
        <Route path="/account/consent-requests" element={<Navigate to="/dashboard/consent-requests" replace />} />
        <Route path="/account/service-journeys" element={<Navigate to="/dashboard/service-journeys" replace />} />
        <Route path="/account/security" element={<Navigate to="/dashboard/security" replace />} />
        <Route path="/account/data-export" element={<Navigate to="/dashboard/data-portability" replace />} />
        <Route path="/account/account-management" element={<Navigate to="/dashboard/account-management" replace />} />

        <Route path="/emergency" element={<EmergencyHome />} />
        <Route path="/emergency/hospitals" element={<EmergencyCategory category="hospital" title="Hospitals and health facilities" />} />
        <Route path="/emergency/police" element={<EmergencyCategory category="police" title="Police stations" />} />
        <Route path="/emergency/fire-rescue" element={<EmergencyCategory category="fire" title="Fire and rescue services" />} />
        <Route path="/emergency/:slug" element={<EmergencyMunicipality />} />

        <Route path="/help" element={<HelpPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
        <Route path="/feedback/surveys/:slug" element={<SurveyPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/faq" element={<Navigate to="/about#faq" replace />} />
        <Route path="/data-requests" element={<DataRequestsPage />} />
        <Route path="/report-security-issue" element={<ReportSecurityPage />} />

        <Route path="/privacy-policy" element={<LegalPage docType="privacy_policy" title="Privacy Policy" />} />
        <Route path="/terms-of-use" element={<LegalPage docType="terms_of_use" title="Terms of Use" />} />
        <Route path="/disclaimer" element={<LegalPage docType="disclaimer" title="Independent Platform Disclaimer" />} />
        <Route path="/data-privacy" element={<LegalPage docType="privacy_policy" title="Data Privacy" />} />
        <Route
          path="/cookie-policy"
          element={
            <LegalPage
              docType="privacy_policy"
              title="Cookie Policy"
              aliasNote="A separate Cookie Policy has not been published yet. The Privacy Policy below covers cookies and similar technologies."
            />
          }
        />
        <Route
          path="/acceptable-use-policy"
          element={
            <LegalPage
              docType="terms_of_use"
              title="Acceptable Use Policy"
              aliasNote="A separate Acceptable Use Policy has not been published yet. The Terms of Use below covers acceptable use of this platform."
            />
          }
        />
        <Route
          path="/security"
          element={
            <LegalPage
              docType="privacy_policy"
              title="Platform Security"
              aliasNote="A separate Platform Security document has not been published yet. Data protection and security commitments are covered in the Privacy Policy below. To report a vulnerability, use the responsible disclosure form."
            />
          }
        />

        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <DashboardLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardHome />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="profile/edit" element={<ProfileEditPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="preferences" element={<PreferencesPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="privacy/requests" element={<PrivacyRequestsPage />} />
        <Route path="saved" element={<SavedServicesPage />} />
        <Route path="reports" element={<MyReportsPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="applications/:reference" element={<ApplicationDetailPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="records" element={<RecordsPage />} />
        <Route path="saved/documents" element={<Navigate to="/dashboard/documents" replace />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="notification-settings" element={<NotificationSettings />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="support/:reference" element={<SupportDetailPage />} />
        <Route path="privacy-center" element={<PrivacyCenter />} />
        <Route path="discover" element={<DiscoverPage />} />
        <Route path="assistance" element={<AssistancePage />} />
        <Route path="assistance/:slug" element={<AssistancePage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="appointments/:id" element={<AppointmentsPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="payments/:id" element={<PaymentsPage />} />
        <Route path="document-requests" element={<DocumentRequestsPage />} />
        <Route path="document-requests/:slug" element={<DocumentRequestsPage />} />
        <Route path="complaints" element={<ComplaintsPage />} />
        <Route path="complaints/:id" element={<ComplaintsPage />} />
        <Route path="identity" element={<IdentityPage />} />
        <Route path="delegations" element={<DelegationsPage />} />
        <Route path="consent" element={<ConsentPage />} />
        <Route path="personalization" element={<PersonalizationPage />} />
        <Route path="offline-packs" element={<OfflinePage />} />
        <Route path="translations" element={<TranslationsPage />} />
        <Route path="data-portability" element={<PortabilityPage />} />
        <Route path="account-management" element={<AccountManagementPage />} />
        <Route path="consent-requests" element={<ConsentRequestsPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="service-journeys" element={<ServiceJourneysPage />} />
      </Route>

      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }
      >
        <Route index element={<AdminOverview />} />
        <Route path="overview" element={<Navigate to="/admin" replace />} />
        <Route path="analytics" element={<RequireAdmin permission="province.analytics.view"><AdminAnalytics /></RequireAdmin>} />
        <Route path="users" element={<RequireAdmin permission="users.view"><AdminUsers /></RequireAdmin>} />
        <Route path="users/:id" element={<RequireAdmin permission="users.view"><AdminUserDetail /></RequireAdmin>} />
        <Route path="roles" element={<RequireAdmin permission="roles.view"><AdminRoles /></RequireAdmin>} />
        <Route path="permissions" element={<RequireAdmin permission="permissions.view"><AdminRoles /></RequireAdmin>} />
        <Route path="announcements" element={<RequireAdmin permission="announcements.view"><AdminAnnouncements /></RequireAdmin>} />
        <Route path="services" element={<RequireAdmin permission="services.view"><AdminServiceDashboard /></RequireAdmin>} />
        <Route path="forms" element={<RequireAdmin permission="services.view"><AdminForms /></RequireAdmin>} />
        <Route path="forms/:id" element={<RequireAdmin permission="services.view"><AdminFormEditor /></RequireAdmin>} />
        <Route path="applications" element={<RequireAdmin permission="services.view"><AdminApplications /></RequireAdmin>} />
        <Route path="applications/:id" element={<RequireAdmin permission="services.view"><AdminApplicationDetail /></RequireAdmin>} />
        <Route path="records" element={<RequireAdmin permission="services.view"><AdminRecords /></RequireAdmin>} />
        <Route path="notifications" element={<RequireAdmin permission="announcements.view"><AdminNotifications /></RequireAdmin>} />
        <Route path="support" element={<RequireAdmin permission="reports.view"><AdminSupport /></RequireAdmin>} />
        <Route path="feedback" element={<RequireAdmin permission="reports.view"><AdminFeedback /></RequireAdmin>} />
        <Route path="privacy-requests" element={<RequireAdmin permission="privacy.requests.manage"><AdminPrivacyCenter /></RequireAdmin>} />
        <Route path="service-discovery" element={<RequireAdmin permission="services.view"><AdminDiscovery /></RequireAdmin>} />
        <Route path="service-requirements" element={<RequireAdmin permission="services.view"><AdminRequirements /></RequireAdmin>} />
        <Route path="appointments" element={<RequireAdmin permission="services.view"><AdminAppointments /></RequireAdmin>} />
        <Route path="payments" element={<RequireAdmin permission="services.view"><AdminPayments /></RequireAdmin>} />
        <Route path="document-requests" element={<RequireAdmin permission="services.view"><AdminDocumentRequests /></RequireAdmin>} />
        <Route path="complaints" element={<RequireAdmin permission="reports.view"><AdminComplaints /></RequireAdmin>} />
        <Route path="identity-verifications" element={<RequireAdmin permission="municipality_users.manage"><AdminIdentity /></RequireAdmin>} />
        <Route path="consent" element={<RequireAdmin permission="municipality_users.manage"><AdminConsent /></RequireAdmin>} />
        <Route path="personalization" element={<RequireAdmin permission="services.view"><AdminPersonalization /></RequireAdmin>} />
        <Route path="offline-packs" element={<RequireAdmin permission="services.view"><AdminOffline /></RequireAdmin>} />
        <Route path="translations" element={<RequireAdmin permission="services.view"><AdminTranslations /></RequireAdmin>} />
        <Route path="closure-requests" element={<RequireAdmin permission="municipality_users.manage"><AdminClosure /></RequireAdmin>} />
        <Route path="security" element={<RequireAdmin permission="municipality_users.manage"><AdminSecurity /></RequireAdmin>} />
        <Route path="service-journeys" element={<RequireAdmin permission="services.view"><AdminJourneys /></RequireAdmin>} />
        <Route path="data-exports" element={<RequireAdmin permission="privacy.requests.manage"><AdminDataExports /></RequireAdmin>} />
        <Route path="account-deletion" element={<RequireAdmin permission="municipality_users.manage"><AdminAccountDeletion /></RequireAdmin>} />
        <Route path="consent-requests" element={<RequireAdmin permission="privacy.requests.manage"><AdminConsentRequests /></RequireAdmin>} />
        <Route path="service-categories" element={<RequireAdmin permission="services.categories.view"><AdminServiceDashboard initialTab="categories" /></RequireAdmin>} />
        <Route path="service-sources" element={<RequireAdmin permission="services.sources.manage"><AdminServiceDashboard initialTab="verification" /></RequireAdmin>} />
        <Route path="service-feedback" element={<RequireAdmin permission="services.feedback.moderate"><AdminServiceDashboard initialTab="feedback" /></RequireAdmin>} />
        <Route path="service-import" element={<RequireAdmin permission="services.import"><AdminServiceDashboard initialTab="import" /></RequireAdmin>} />
        <Route path="municipalities" element={<RequireAdmin permission="municipalities.view"><AdminMunicipalities /></RequireAdmin>} />
        <Route path="municipalities/:id" element={<RequireAdmin permission="municipal.portal.view"><AdminMunicipalWorkspace /></RequireAdmin>} />
        <Route path="municipalities/:id/modules" element={<RequireAdmin permission="municipal.portal.view"><AdminMunicipalModules /></RequireAdmin>} />
        <Route path="directory" element={<RequireAdmin permission="directory.view"><AdminDirectory /></RequireAdmin>} />
        <Route path="transparency" element={<RequireAdmin permission="transparency.view"><AdminTransparency /></RequireAdmin>} />
        <Route path="transparency/finance" element={<RequireAdmin permission="transparency.view"><AdminTransparencyFinance /></RequireAdmin>} />
        <Route path="transparency/financial-monitoring" element={<RequireAdmin permission="transparency.view"><AdminMonitoring /></RequireAdmin>} />
        <Route path="transparency/reports" element={<RequireAdmin permission="transparency.view"><AdminTransparencyReports /></RequireAdmin>} />
        <Route path="transparency/open-data" element={<RequireAdmin permission="transparency.view"><AdminOpenData /></RequireAdmin>} />
        <Route path="transparency/alerts" element={<RequireAdmin permission="transparency.view"><AdminAlerts /></RequireAdmin>} />
        <Route path="transparency/community" element={<RequireAdmin permission="transparency.view"><AdminCommunity /></RequireAdmin>} />
        <Route path="emergency" element={<RequireAdmin permission="emergency.view"><AdminEmergency /></RequireAdmin>} />
        <Route path="cms" element={<RequireAdmin permission="cms.manage"><AdminCms /></RequireAdmin>} />
        <Route path="reports" element={<RequireAdmin permission="reports.view"><AdminReports /></RequireAdmin>} />
        <Route path="privacy" element={<RequireAdmin permission="privacy.requests.manage"><AdminPrivacy /></RequireAdmin>} />
        <Route path="audit-logs" element={<RequireAdmin permission="audit_logs.view"><AdminAuditLogs /></RequireAdmin>} />
        <Route path="settings" element={<RequireAdmin permission="settings.manage"><AdminSettings /></RequireAdmin>} />
        <Route path="profile" element={<AdminProfile />} />
      </Route>
    </Routes>
  )
}
