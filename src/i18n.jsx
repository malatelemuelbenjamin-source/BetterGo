import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/* ==========================================================================
   Interface language - English / Filipino
   Only interface chrome is translated here. Published records (announcements,
   services, municipal content) stay in whatever language they were authored
   in, because inventing a translation of a government record would be worse
   than showing the original.
   ========================================================================== */

const STRINGS = {
  // Navigation
  'nav.home': ['Home', 'Tahanan'],
  'nav.services': ['Government Services', 'Mga Serbisyo'],
  'nav.municipalities': ['Municipalities', 'Munisipalidad'],
  'nav.transparency': ['Transparency', 'Transparensiya'],
  'nav.announcements': ['Announcements', 'Anunsyo'],
  'nav.emergency': ['Emergency', 'Emergency'],
  'nav.about': ['About', 'Tungkol'],
  'nav.browseServices': ['Browse Services', 'Tingnan ang Serbisyo'],
  'nav.serviceCategories': ['Service Categories', 'Mga Kategorya ng Serbisyo'],
  'nav.serviceCoverage': ['Municipality Coverage', 'Saklaw sa Munisipalidad'],
  'nav.formsResources': ['Forms & Resources', 'Mga Form at Sanggunian'],
  'nav.serviceFaqs': ['Service FAQs', 'Mga Tanong sa Serbisyo'],
  'nav.offices': ['Government Offices', 'Mga Opisina ng Gobyerno'],
  'nav.developerApi': ['Developer API', 'Developer API'],
  'nav.allMunicipalities': ['All municipalities', 'Lahat ng munisipalidad'],
  'nav.overview': ['Overview', 'Pangkalahatang-tanaw'],
  'nav.budget': ['Budget information', 'Impormasyon sa badyet'],
  'nav.documents': ['Public documents', 'Pampublikong dokumento'],
  'nav.procurement': ['Procurement information', 'Impormasyon sa pagbili'],
  'nav.aboutBettergo': ['About BetterGo', 'Tungkol sa BetterGo'],
  'nav.contact': ['Contact', 'Makipag-ugnayan'],
  'nav.privacyPolicy': ['Privacy Policy', 'Patakaran sa Privacy'],
  'nav.terms': ['Terms of Use', 'Mga Tuntunin ng Paggamit'],
  'nav.disclaimer': ['Disclaimer', 'Paalala'],

  // Header & chrome
  'shell.independent': [
    'Independent, community-driven initiative',
    'Malaya at pangkomunidad na inisyatiba',
  ],
  'shell.notOfficial': ['Not an official government website', 'Hindi opisyal na website ng gobyerno'],
  'shell.search': ['Search…', 'Maghanap…'],
  'shell.searchLabel': ['Search (Control K)', 'Maghanap (Control K)'],
  'shell.signIn': ['Sign in', 'Mag-log in'],
  'shell.signUp': ['Sign up', 'Gumawa ng account'],
  'shell.myDashboard': ['My dashboard', 'Aking dashboard'],
  'shell.administration': ['Administration', 'Pangangasiwa'],
  'shell.signOut': ['Sign out', 'Mag-log out'],
  'shell.openMenu': ['Open menu', 'Buksan ang menu'],
  'shell.closeMenu': ['Close menu', 'Isara ang menu'],
  'shell.switchLang': ['Switch to Filipino', 'Ilipat sa Ingles'],
  'shell.langShort': ['FIL', 'EN'],


  // Transparency finance
  'nav.budgets': ['Budgets', 'Mga Badyet'],
  'fin.eyebrow': ['Accountability', 'Pananagutan'],
  'fin.title': ['Budget and financial transparency', 'Transparensiya sa badyet at pananalapi'],
  'fin.description': ['Published, source-referenced financial records for the province and six municipalities of Marinduque.', 'Mga nailathalang rekord sa pananalapi na may pinagmulan para sa lalawigan at anim na munisipalidad ng Marinduque.'],
  'fin.independent': ['Independent civic platform', 'Malayang civic platform'],
  'fin.publishedRecords': ['Published records', 'Mga nailathalang rekord'],
  'fin.entitiesWithData': ['Entities with published data', 'Mga entidad na may nailathalang datos'],
  'fin.lastUpdated': ['Last updated', 'Huling na-update'],
  'fin.budgetExplorer': ['Budget explorer', 'Tagapaggalugad ng badyet'],
  'fin.openBudgets': ['Open budgets', 'Buksan ang mga badyet'],
  'fin.modules': ['Transparency modules', 'Mga module ng transparensiya'],
  'fin.coverage': ['Coverage by government entity', 'Saklaw ayon sa entidad ng gobyerno'],
  'fin.sources': ['Data sources and verification', 'Pinagmulan ng datos at beripikasyon'],
  'fin.amountKinds': ['Amount classifications', 'Mga klasipikasyon ng halaga'],
  'fin.notAvailable': ['Data not yet available', 'Wala pang available na datos'],
  'fin.awaiting': ['Awaiting verification', 'Naghihintay ng beripikasyon'],
  'fin.proposedNote': ['A proposed budget is not an appropriation. An approved budget is not proof that money was spent.', 'Ang panukalang badyet ay hindi appropriation. Ang aprubadong badyet ay hindi patunay na may nagastos.'],
  'fin.publicDocuments': ['public documents', 'mga pampublikong dokumento'],
  'fin.budgetTitle': ['Public budget explorer', 'Tagapaggalugad ng pampublikong badyet'],
  'fin.chooseEntity': ['Choose a government entity', 'Pumili ng entidad ng gobyerno'],
  'fin.allEntities': ['All entities', 'Lahat ng entidad'],
  'fin.allYears': ['All years', 'Lahat ng taon'],
  'fin.allocations': ['Allocations by category and classification', 'Paglalaan ayon sa kategorya at klasipikasyon'],
  'fin.comparisons': ['Year comparisons', 'Paghahambing ng taon'],
  'fin.publishedBudgetRecords': ['Published budget records', 'Mga nailathalang rekord ng badyet'],
  'fin.fiscalYear': ['Fiscal year', 'Taon ng piskal'],
  'fin.category': ['Category', 'Kategorya'],
  'fin.classification': ['Classification', 'Klasipikasyon'],
  'fin.total': ['Total', 'Kabuuan'],
  'fin.records': ['Records', 'Mga rekord'],
  'fin.previous': ['Previous', 'Nauna'],
  'fin.current': ['Current', 'Kasalukuyan'],
  'fin.difference': ['Difference', 'Pagkakaiba'],
  'fin.change': ['Change', 'Pagbabago'],
  'fin.notCalculated': ['Not calculated', 'Hindi kinakalkula'],
  'fin.source': ['Source', 'Pinagmulan'],
  'fin.limitations': ['Limitations', 'Mga limitasyon'],
  'fin.viewRecord': ['View record', 'Tingnan ang rekord'],
  'fin.amount': ['Amount', 'Halaga'],
  'fin.period': ['Period', 'Panahon'],
  'fin.entity': ['Entity', 'Entidad'],
  'fin.yearPeriod': ['Year / period', 'Taon / panahon'],
  'fin.search': ['Search', 'Maghanap'],
  'fin.resetFilters': ['Reset filters', 'I-reset ang mga filter'],
  'fin.allCategories': ['All categories', 'Lahat ng kategorya'],
  'fin.allClassifications': ['All classifications', 'Lahat ng klasipikasyon'],
  'fin.recordsCount': ['published record(s)', 'nailathalang rekord'],
  'fin.noMatch': ['No verified record matches this selection.', 'Walang beripikadong rekord na tumutugma sa piniling ito.'],
  'fin.howToRead': ['How to read this', 'Paano ito basahin'],
  'fin.nominalNote': ['Figures are nominal. No inflation adjustment is applied unless a verified dataset says otherwise.', 'Nominal ang mga halaga. Walang pagsasaayos sa implasyon maliban kung may beripikadong datos na nagsasaad nito.'],
  'fin.platformRecord': ['Platform reproduction', 'Kopya ng platform'],
  'fin.specialist': ['Record details', 'Mga detalye ng rekord'],
  'fin.verifiedOn': ['Verified on', 'Naberipika noong'],
  'fin.reviewStatus': ['Review status', 'Katayuan ng pagsusuri'],
  'fin.originalDocument': ['Open the original document', 'Buksan ang orihinal na dokumento'],
  'fin.interestRate': ['Interest rate', 'Rate ng interes'],
  'fin.outstandingBalance': ['Outstanding balance', 'Natitirang balanse'],
  'fin.principal': ['Principal', 'Punong halaga'],
  'fin.maturityDate': ['Maturity date', 'Petsa ng maturity'],
  'fin.term': ['Term', 'Takda'],
  'fin.location': ['Location', 'Lokasyon'],
  'fin.identifier': ['Identifier', 'Identifier'],
  'fin.titleNumber': ['Title number', 'Numero ng titulo'],
  'fin.quantity': ['Quantity', 'Dami'],
  'fin.stage': ['Stage or status', 'Yugto o katayuan'],
  'fin.programName': ['Program', 'Programa'],
  'fin.rateDescription': ['Rate description', 'Paglalarawan ng rate'],
  'fin.assessmentBasis': ['Assessment basis', 'Batayan ng assessment'],
  'fin.arrangement': ['Arrangement', 'Kasunduan'],
  'fin.moduleDescription': ['Only verified and published records appear. Missing information stays visibly unavailable.', 'Mga beripikado at nailathalang rekord lamang ang lumalabas. Nananatiling nakikitang hindi available ang kulang na impormasyon.'],
  'fin.moduleNote': ['A proposed amount is not an appropriation, an approved budget is not proof of spending, and an empty module does not mean nothing happened.', 'Ang panukalang halaga ay hindi appropriation, ang aprubadong badyet ay hindi patunay ng gastos, at ang walang laman na module ay hindi nangangahulugang walang nangyari.'],
  'fin.tableValues': ['Table of values', 'Talahanayan ng mga halaga'],
  'fin.financeCrumb': ['Finance', 'Pananalapi'],

  // Footer
  'footer.quickLinks': ['Quick links', 'Mabilisang link'],
  'footer.usefulInfo': ['Useful information', 'Kapaki-pakinabang na impormasyon'],
  'footer.municipalities': ['Municipalities', 'Mga Munisipalidad'],
  'footer.legal': ['Legal', 'Legal'],
  'footer.emergency': ['In an emergency, call 911', 'Sa emergency, tumawag sa 911'],
  'footer.faq': ['Frequently asked questions', 'Mga madalas itanong'],
  'footer.rights': ['All rights reserved.', 'Lahat ng karapatan ay nakalaan.'],

  // Home
  'home.eyebrow': ['Independent civic atlas · Marinduque', 'Malayang civic atlas · Marinduque'],
  'home.heroTitle': [
    'Your Province. Your Information. Your Participation.',
    'Ang Iyong Lalawigan. Ang Iyong Impormasyon. Ang Iyong Pakikilahok.',
  ],
  'home.heroLead': [
    'Explore public services, discover government information, monitor development projects, and participate in building a better Marinduque.',
    'Tuklasin ang mga pampublikong serbisyo, impormasyon ng gobyerno, at proyekto ng pag-unlad — at makibahagi sa pagbuo ng mas mabuting Marinduque.',
  ],
  'home.ctaServices': ['Explore government services', 'Tuklasin ang mga serbisyo'],
  'home.ctaTowns': ['Meet the six towns', 'Kilalanin ang anim na bayan'],
  'home.ctaMoney': ['Follow the money', 'Sundan ang pera'],
  'home.statTowns': ['6 municipalities', '6 na munisipalidad'],
  'home.statSources': ['Verified sources only', 'Beripikadong pinagmulan lamang'],
  'home.statData': ['You control your data', 'Ikaw ang may kontrol sa iyong datos'],
  'home.heroNote': [
    'BetterGo Marinduque is an independent, community-driven initiative. Information is published with its source and verification status. Always confirm critical procedures with the responsible government office.',
    'Ang BetterGo Marinduque ay malaya at pangkomunidad na inisyatiba. Bawat impormasyon ay may nakatalang pinagmulan at katayuan ng beripikasyon. Palaging kumpirmahin ang mahahalagang proseso sa responsableng opisina ng gobyerno.',
  ],
  'home.sceneFact': ['Municipal portals', 'Portal ng munisipalidad'],
  'home.searchTitle': ['What do you need to find today?', 'Ano ang kailangan mong hanapin ngayon?'],
  'home.searchPlaceholder': [
    'Search government services, offices, announcements, projects…',
    'Maghanap ng serbisyo, opisina, anunsyo, proyekto…',
  ],
  'home.searchButton': ['Search', 'Maghanap'],
  'home.suggested': ['Suggested searches:', 'Mga mungkahing hanapin:'],
  'home.searchHelp': [
    'BetterGo does not issue government documents or process applications. Official transactions are handled by the responsible office.',
    'Hindi naglalabas ng dokumento o nagpoproseso ng aplikasyon ang BetterGo. Ang mga opisyal na transaksyon ay sa responsableng opisina.',
  ],
  'home.quickEyebrow': ['Quick access', 'Mabilisang daan'],
  'home.quickTitle': ['Start wherever you are', 'Magsimula kahit saan ka naroon'],
  'home.quickDescription': [
    'Nine doorways into the same verified record set.',
    'Siyam na pasukan sa isang beripikadong kalipunan ng rekord.',
  ],
  'home.quickFeatureTitle': ['Government services', 'Mga serbisyo ng gobyerno'],
  'home.quickFeatureText': [
    'Categories, requirements and procedures. Every service page states what is required, who handles it and where the record came from.',
    'Mga kategorya, kinakailangan at proseso. Sinasabi ng bawat pahina kung ano ang kailangan, sino ang humahawak, at saan galing ang rekord.',
  ],
  'home.quickOpen': ['Open the directory', 'Buksan ang direktoryo'],
  'home.provinceEyebrow': ['The province', 'Ang lalawigan'],
  'home.provinceTitle': [
    'Six towns on one heart-shaped island.',
    'Anim na bayan sa isang pulong hugis-puso.',
  ],
  'home.provinceBody': [
    'Marinduque sits at the geographic centre of the Philippines and is often called the heart of the archipelago. Each municipality keeps its own records, its own offices and its own way of publishing them — so BetterGo keeps every record attached to the town it belongs to.',
    'Ang Marinduque ay nasa gitnang heograpiya ng Pilipinas at madalas tawaging puso ng kapuluan. Bawat munisipalidad ay may sariling rekord, opisina at paraan ng paglathala — kaya nakaugnay ang bawat rekord sa bayan nito sa BetterGo.',
  ],
  'home.provinceCta': ['Browse municipal portals', 'Tingnan ang mga portal'],
  'home.provinceSearch': ['Search across all six', 'Maghanap sa anim na bayan'],
  'home.statMunicipalities': ['Municipalities', 'Munisipalidad'],
  'home.statGroups': ['Service groups', 'Grupo ng serbisyo'],
  'home.statInvented': ['Invented records', 'Gawa-gawang rekord'],
  'home.statSourced': ['Records with a source', 'Rekord na may pinagmulan'],
  'home.servicesEyebrow': ['Services', 'Mga Serbisyo'],
  'home.servicesTitle': ['Government services at your fingertips', 'Serbisyo ng gobyerno sa iyong kamay'],
  'home.municipalitiesEyebrow': ['Six municipalities', 'Anim na munisipalidad'],
  'home.municipalitiesTitle': [
    'Explore the municipalities of Marinduque',
    'Tuklasin ang mga munisipalidad ng Marinduque',
  ],
  'home.announcementsEyebrow': ['Public information', 'Pampublikong impormasyon'],
  'home.announcementsTitle': ['Latest announcements', 'Pinakabagong anunsyo'],
  'home.transparencyEyebrow': ['Accountability', 'Pananagutan'],
  'home.transparencyTitle': ['Transparency builds trust', 'Ang transparensiya ay nagtatayo ng tiwala'],
  'home.projectsEyebrow': ['Development', 'Pag-unlad'],
  'home.projectsTitle': ['Building a better Marinduque', 'Pagbuo ng mas mabuting Marinduque'],
  'home.participationEyebrow': ['Participation', 'Pakikilahok'],
  'home.participationTitle': ['Your voice matters', 'Mahalaga ang iyong boses'],
  'home.emergencyEyebrow': ['Safety', 'Kaligtasan'],
  'home.emergencyTitle': ['Emergency information', 'Impormasyon sa emergency'],
  'home.aboutEyebrow': ['About', 'Tungkol'],
  'home.aboutTitle': ['About BetterGo Marinduque', 'Tungkol sa BetterGo Marinduque'],
  'home.ctaEyebrow': ['Join in', 'Makibahagi'],
  'home.ctaTitle': ['Be part of a better Marinduque', 'Maging bahagi ng mas mabuting Marinduque'],
  'home.ctaText': [
    'Stay informed, explore opportunities, and help build a more connected and informed community.',
    'Manatiling may alam, tuklasin ang mga oportunidad, at tumulong sa pagbuo ng mas konektado at may-alam na komunidad.',
  ],
  'home.ctaExplore': ['Explore the platform', 'Tuklasin ang plataporma'],
  'home.ctaDashboard': ['Go to my dashboard', 'Pumunta sa aking dashboard'],
  'home.ctaRegister': ['Create an account', 'Gumawa ng account'],
  'home.ctaHelp': [
    'Accounts are optional. All public information can be browsed without signing in.',
    'Opsyonal ang account. Maaaring tingnan ang lahat ng pampublikong impormasyon nang hindi nag-sign in.',
  ],

  // Services directory
  'services.eyebrow': ['Government services directory', 'Direktoryo ng serbisyo ng gobyerno'],
  'services.title': ['Find the government service you need', 'Hanapin ang serbisyong kailangan mo'],
  'services.description': [
    'Explore government services, requirements, application procedures and assistance programmes recorded for Marinduque. Every record shows how it was verified.',
    'Tingnan ang mga serbisyo, kinakailangan, proseso ng aplikasyon at programa ng tulong na nakatala para sa Marinduque. Ipinapakita ng bawat rekord kung paano ito beripikado.',
  ],
  'services.breadcrumb': ['Government services', 'Mga serbisyo ng gobyerno'],
  'services.categoryGroups': ['category groups', 'grupo ng kategorya'],
  'services.publishedRecords': ['published service records', 'nailathalang rekord ng serbisyo'],
  'services.coverageLink': ['Municipality coverage', 'Saklaw sa munisipalidad'],
  'services.searchLabel': ['Search government services', 'Maghanap ng serbisyo ng gobyerno'],
  'services.searchPlaceholder': ['Search a service, requirement, form or question', 'Maghanap ng serbisyo, kinakailangan, form o tanong'],
  'services.clearFilters': ['Clear filters', 'Alisin ang mga filter'],
  'services.searching': ['Searching…', 'Naghahanap…'],
  'services.featuredEyebrow': ['Start here', 'Magsimula rito'],
  'services.featuredTitle': ['Featured service categories', 'Mga tampok na kategorya ng serbisyo'],
  'services.featuredDescription': [
    'The categories residents ask about most. Featured categories are an editorial choice by BetterGo; they do not imply government endorsement.',
    'Ang mga kategoryang madalas itanong ng mga residente. Ang pagpili ng tampok na kategorya ay desisyon ng BetterGo at hindi nagpapahiwatig ng pagsang-ayon ng gobyerno.',
  ],
  'services.browseAll': ['Browse all', 'Tingnan lahat'],
  'services.allEyebrow': ['All categories', 'Lahat ng kategorya'],
  'services.allTitle': ['Browse by service area', 'Tingnan ayon sa larangan ng serbisyo'],
  'services.allDescription': [
    'Categories are organised by the kind of help, document, permit or programme you need.',
    'Nakaayos ang mga kategorya ayon sa uri ng tulong, dokumento, permit o programang kailangan mo.',
  ],
  'services.ctaTitle': ['Not sure which office handles it?', 'Hindi sigurado kung aling opisina ang humahawak?'],
  'services.ctaText': [
    'Use municipality coverage to see which services are recorded for your town, or search the whole platform.',
    'Gamitin ang saklaw ng munisipalidad upang tingnan ang mga serbisyong nakatala para sa iyong bayan, o hanapin sa buong plataporma.',
  ],
  'services.ctaCoverage': ['Check coverage', 'Tingnan ang saklaw'],
  'services.ctaSearch': ['Search everything', 'Maghanap sa lahat'],
  'services.resultsEyebrow': ['Results', 'Mga resulta'],
  'services.resultsTitle': ['Matching services', 'Mga tugmang serbisyo'],
  'services.resultsDescription': [
    'Results include only published records. Requirement, fee and procedure details are shown on each service page.',
    'Nailathalang rekord lamang ang kasama sa mga resulta. Nasa pahina ng bawat serbisyo ang mga kinakailangan, bayarin at proseso.',
  ],
  'services.publishedEyebrow': ['Published records', 'Nailathalang rekord'],
  'services.publishedTitle': ['Recently published services', 'Mga bagong nailathalang serbisyo'],
  'services.publishedDescription': [
    'No service record is invented. When offices publish verified information it appears here.',
    'Walang gawa-gawang rekord ng serbisyo. Kapag naglathala ang mga opisina ng beripikadong impormasyon, lumalabas ito rito.',
  ],
  'services.emptyTitle': ['No published service matches those filters', 'Walang nailathalang serbisyo sa mga filter na iyon'],
  'services.emptyDescription': [
    'Try a broader keyword, remove a filter, or browse the categories above. Nothing unpublished is ever shown in search.',
    'Subukan ang mas malawak na salita, alisin ang isang filter, o tingnan ang mga kategorya sa itaas. Walang hindi nailathalang rekord ang lumalabas sa paghahanap.',
  ],
  'services.noRecordsTitle': ['No service records have been published yet', 'Wala pang nailathalang rekord ng serbisyo'],
  'services.noRecordsDescription': [
    'BetterGo only publishes service information that has been recorded and reviewed. Use the categories above to see the structure that will hold records as offices publish them.',
    'Naglalathala lamang ang BetterGo ng impormasyong naitala at nasuri na. Gamitin ang mga kategorya sa itaas upang makita ang estrukturang tatanggap ng mga rekord kapag naglathala ang mga opisina.',
  ],
  'services.errorTitle': ['The service directory could not be loaded', 'Hindi ma-load ang direktoryo ng serbisyo'],

  // Municipality directory
  'munis.eyebrow': ['Marinduque', 'Marinduque'],
  'munis.title': ['Municipal portals', 'Mga portal ng munisipalidad'],
  'munis.description': [
    'Boac, Mogpog, Gasan, Buenavista, Torrijos and Santa Cruz. Each portal publishes only verified local information.',
    'Boac, Mogpog, Gasan, Buenavista, Torrijos at Santa Cruz. Ang bawat portal ay naglalathala lamang ng beripikadong lokal na impormasyon.',
  ],
  'munis.portals': ['Municipal portals', 'Mga portal ng munisipalidad'],
  'munis.publishedRecords': ['Published records', 'Nailathalang rekord'],
  'munis.projects': ['Public projects', 'Pampublikong proyekto'],
  'munis.programs': ['Programs', 'Mga programa'],
  'munis.verified': ['Verified profiles', 'Beripikadong profile'],
  'munis.chipProjects': ['Projects', 'Mga proyekto'],
  'munis.chipPrograms': ['Programs', 'Mga programa'],
  'munis.chipResources': ['Resources', 'Mga sanggunian'],
  'munis.chipFaqs': ['FAQs', 'Mga tanong'],
  'munis.chipOffices': ['Office map', 'Mapa ng opisina'],
  'munis.chipSearch': ['Search all portals', 'Maghanap sa lahat ng portal'],
  'munis.searchPlaceholder': ['Search municipalities', 'Maghanap ng munisipalidad'],
  'munis.searchLabel': ['Search municipalities', 'Maghanap ng munisipalidad'],
  'munis.count': ['of', 'sa'],
  'munis.municipalities': ['municipalities', 'munisipalidad'],
  'munis.announcements': ['announcements', 'anunsyo'],
  'munis.services': ['services', 'serbisyo'],
  'munis.offices': ['offices', 'opisina'],
  'munis.noInfo': ['No published information yet', 'Wala pang nailathalang impormasyon'],
  'munis.publishedCount': ['published records', 'nailathalang rekord'],
  'munis.open': ['Open portal', 'Buksan ang portal'],
  'munis.emptyTitle': ['No municipality matches that search', 'Walang munisipalidad na tumutugma sa paghahanap'],
  'munis.emptyDescription': ['Try a shorter name, such as Boac or Gasan.', 'Subukan ang mas maikling pangalan, tulad ng Boac o Gasan.'],
  'munis.errorTitle': ['Municipal portals are temporarily unavailable', 'Pansamantalang hindi available ang mga portal ng munisipalidad'],
  'munis.errorDesc': ['Please try again in a moment.', 'Subukan muli maya-maya.'],
  'munis.alertTitle': ['Municipal portals are ready for verified information', 'Handa ang mga portal ng munisipalidad para sa beripikadong impormasyon'],
  'munis.alert': [
    'The six portals share one template and one review workflow. Where a municipality has no published records yet, the portal stays honestly empty rather than showing placeholder content.',
    'Isang template at isang daloy ng pagsusuri ang ginagamit ng anim na portal. Kapag wala pang nailathalang rekord ang isang munisipalidad, nananatiling tapat na walang laman ang portal sa halip na magpakita ng pansamantalang nilalaman.',
  ],

  // Emergency
  'emergency.eyebrow': ['Emergency information', 'Impormasyon sa emergency'],
  'emergency.title': ['Emergency contacts and guidance', 'Mga contact at gabay sa emergency'],
  'emergency.description': [
    'Verified emergency contact information for Marinduque, plus preparedness guidance from official sources.',
    'Beripikadong impormasyon ng contact sa emergency para sa Marinduque, kasama ang gabay sa paghahanda mula sa opisyal na sanggunian.',
  ],
  'emergency.callTitle': ['In a life-threatening emergency, call 911', 'Sa agarang panganib sa buhay, tumawag sa 911'],
  'emergency.callText': [
    'BetterGo is an information directory. It does not dispatch responders and does not replace official emergency services.',
    'Direktoryo ng impormasyon ang BetterGo. Hindi ito nagpapadala ng responders at hindi ito kapalit ng opisyal na serbisyong pang-emergency.',
  ],
  'emergency.callButton': ['Call 911', 'Tumawag sa 911'],
  'emergency.tilePolice': ['Police assistance', 'Tulong ng pulisya'],
  'emergency.tileFire': ['Fire and rescue', 'Sunog at pagsagip'],
  'emergency.tileHospitals': ['Hospitals & health', 'Ospital at kalusugan'],
  'emergency.tileDisaster': ['Disaster response', 'Tugon sa kalamidad'],
  'emergency.openDirectory': ['Open directory', 'Buksan ang direktoryo'],
  'emergency.searchPlaceholder': ['Search emergency organisations or addresses', 'Maghanap ng organisasyon o address sa emergency'],
  'emergency.searchLabel': ['Search emergency contacts', 'Maghanap ng contact sa emergency'],
  'emergency.allCategories': ['All categories', 'Lahat ng kategorya'],
  'emergency.catNational': ['National resources', 'Pambansang sanggunian'],
  'emergency.catPolice': ['Police', 'Pulisya'],
  'emergency.catFire': ['Fire and rescue', 'Sunog at pagsagip'],
  'emergency.catHospitals': ['Hospitals', 'Mga ospital'],
  'emergency.catHealth': ['Health facilities', 'Pasilidad pangkalusugan'],
  'emergency.catDisaster': ['Disaster response', 'Tugon sa kalamidad'],
  'emergency.catAmbulance': ['Ambulance', 'Ambulansya'],
  'emergency.nationalEyebrow': ['National', 'Pambansa'],
  'emergency.nationalTitle': ['National emergency resources', 'Pambansang sanggunian sa emergency'],
  'emergency.nationalDesc': ['Nationwide services and official information channels.', 'Mga serbisyong pambuong bansa at opisyal na channel ng impormasyon.'],
  'emergency.localEyebrow': ['Local', 'Lokal'],
  'emergency.localTitle': ['Provincial and municipal contacts', 'Mga contact sa lalawigan at munisipalidad'],
  'emergency.localDesc': [
    'Only contacts verified against an official source are published with a call action.',
    'Tanging mga contact na beripikado laban sa opisyal na sanggunian ang nailalathala nang may button na pantawag.',
  ],
  'emergency.noLocalTitle': ['No verified local emergency contacts published yet', 'Wala pang nailathalang beripikadong lokal na contact sa emergency'],
  'emergency.noLocalDesc': [
    'Local emergency numbers are only published after verification with the responsible office. Use the national hotline in the meantime.',
    'Nailalathala lamang ang lokal na numero ng emergency pagkatapos ng beripikasyon sa responsableng opisina. Gamitin muna ang pambansang hotline.',
  ],
  'emergency.muniEyebrow': ['By municipality', 'Ayon sa munisipalidad'],
  'emergency.muniTitle': ['Emergency information per municipality', 'Impormasyon sa emergency sa bawat munisipalidad'],
  'emergency.muniDesc': ['Each municipality has its own contacts. Availability differs between municipalities.', 'May sariling contact ang bawat munisipalidad. Nagkakaiba ang availability sa bawat bayan.'],
  'emergency.muniCard': ['Emergency contacts for', 'Mga contact sa emergency para sa'],
  'emergency.prepEyebrow': ['Preparedness', 'Paghahanda'],
  'emergency.prepTitle': ['Emergency preparedness', 'Paghahanda sa emergency'],
  'emergency.prepDesc': ['General educational guidance. Always follow official advisories during an actual emergency.', 'Pangkalahatang gabay pang-edukasyon. Laging sundin ang opisyal na abiso sa panahon ng aktwal na emergency.'],
  'emergency.prepTyphoon': ['Typhoons', 'Bagyo'],
  'emergency.prepTyphoonPoints': [
    'Monitor official PAGASA bulletins and local advisories.|Secure loose objects and prepare an emergency kit with water, food, medicine and documents.|Know your evacuation route and the location of the nearest evacuation centre.',
    'Subaybayan ang opisyal na bulletin ng PAGASA at lokal na abiso.|Itabi ang mga maluwag na bagay at maghanda ng emergency kit na may tubig, pagkain, gamot at dokumento.|Alamin ang ruta ng paglikas at lokasyon ng pinakamalapit na evacuation centre.',
  ],
  'emergency.prepFlood': ['Flooding', 'Baha'],
  'emergency.prepFloodPoints': [
    'Never walk or drive through flood water.|Move to higher ground early if local officials advise evacuation.|Keep children away from canals, rivers and flooded streets.',
    'Huwag kailanman lumakad o magmaneho sa tubig-baha.|Lumikas nang maaga patungo sa mataas na lugar kapag pinapayuhan ng lokal na opisyal.|Ilayo ang mga bata sa kanal, ilog at binahang kalsada.',
  ],
  'emergency.prepQuake': ['Earthquakes', 'Lindol'],
  'emergency.prepQuakePoints': [
    'Duck, cover and hold during shaking.|Move to an open area after shaking stops; avoid damaged structures.|Follow PHIVOLCS advisories about aftershocks and tsunamis.',
    'Yumuko, magtakip at kumapit habang lumilindol.|Pumunta sa bukas na lugar pagkatapos ng pagyanig; iwasan ang nasirang istruktura.|Sundin ang abiso ng PHIVOLCS tungkol sa aftershock at tsunami.',
  ],
  'emergency.prepFire': ['Fire', 'Sunog'],
  'emergency.prepFirePoints': [
    'Raise the alarm and call the fire service immediately.|Stay low under smoke and never re-enter a burning building.|Keep escape routes clear and check smoke alarms where available.',
    'Magbigay ng alarma at agad na tawagan ang bumbero.|Manatiling mababa sa ilalim ng usok at huwag nang bumalik sa nasusunog na gusali.|Panatilihing malinaw ang daan ng paglabas at suriin ang smoke alarm kung mayroon.',
  ],
  'emergency.advisoriesEyebrow': ['Advisories', 'Mga abiso'],
  'emergency.advisoriesTitle': ['Emergency-related announcements', 'Mga anunsyong may kaugnayan sa emergency'],
  'emergency.verifyTitle': ['Verify before relying on a number', 'Mag-verify bago umasa sa isang numero'],
  'emergency.verifyText': [
    'Emergency contact details can change. BetterGo records the last verification date for every entry and flags records that need re-verification. If a number does not work, call 911.',
    'Maaaring magbago ang mga detalye ng contact sa emergency. Itinatala ng BetterGo ang huling petsa ng beripikasyon sa bawat entry at minamarkahan ang mga rekord na kailangang i-verify muli. Kung hindi gumagana ang isang numero, tumawag sa 911.',
  ],

  // Transparency
  'transparency.eyebrow': ['Accountability', 'Pananagutan'],
  'transparency.title': ['Government transparency and public information', 'Transparensiya at pampublikong impormasyon ng gobyerno'],
  'transparency.description': [
    'Published budget, expenditure, procurement and accountability records for Marinduque, each with its original source.',
    'Nailathalang rekord ng badyet, gastos, pagbili at pananagutan para sa Marinduque, bawat isa may orihinal na pinagmulan.',
  ],
  'transparency.documents': ['Public documents', 'Pampublikong dokumento'],
  'transparency.readFirst': ['Read this first', 'Basahin muna ito'],
  'transparency.alert': [
    'BetterGo Marinduque is an independent, community-driven information platform. It does not independently certify government financial transactions. Records are based on identified public sources and may be incomplete or subject to correction. Always consult the original document for authoritative information.',
    'Ang BetterGo Marinduque ay malaya at pangkomunidad na plataporma ng impormasyon. Hindi nito independiyenteng pinatutunayan ang mga pinansiyal na transaksyon ng gobyerno. Ang mga rekord ay batay sa natukoy na pampublikong pinagmulan at maaaring kulang o kailangang itama. Laging tingnan ang orihinal na dokumento para sa opisyal na impormasyon.',
  ],
  'transparency.freshness': ['Data freshness:', 'Katatagan ng datos:'],
  'transparency.lastUpdate': ['last record update', 'huling pagbabago ng rekord'],
  'transparency.noRecords': ['no records published yet', 'wala pang nailathalang rekord'],
  'transparency.statBudget': ['Budget records', 'Rekord ng badyet'],
  'transparency.statExpenditure': ['Expenditure reports', 'Ulat ng gastos'],
  'transparency.statProcurement': ['Procurement records', 'Rekord ng pagbili'],
  'transparency.statDocuments': ['Public documents', 'Pampublikong dokumento'],
  'transparency.publishedRecords': ['Published records', 'Nailathalang rekord'],
  'transparency.downloadable': ['Available for download', 'Maaaring i-download'],
  'transparency.financialEyebrow': ['Financial data', 'Datos sa pananalapi'],
  'transparency.financialTitle': ['Published financial records', 'Nailathalang rekord sa pananalapi'],
  'transparency.financialDesc': [
    'Only verified records are charted. Amounts are stored to the centavo in Philippine pesos.',
    'Beripikadong rekord lamang ang inilalagay sa chart. Ang mga halaga ay nakatala hanggang sentabo sa piso ng Pilipinas.',
  ],
  'transparency.fiscalYear': ['Fiscal year', 'Taong piskal'],
  'transparency.category': ['Category', 'Kategorya'],
  'transparency.total': ['Total (PHP)', 'Kabuuan (PHP)'],
  'transparency.noFinancialTitle': ['No verified financial records yet', 'Wala pang beripikadong rekord sa pananalapi'],
  'transparency.noFinancialDesc': [
    'Charts and totals are only displayed when verified records exist. BetterGo never presents sample figures as government data.',
    'Ipinapakita lamang ang chart at kabuuan kapag may beripikadong rekord. Hindi kailanman ipinapakita ng BetterGo ang sample na numero bilang datos ng gobyerno.',
  ],
  'transparency.coverageEyebrow': ['Coverage', 'Saklaw'],
  'transparency.coverageTitle': ['Records by municipality', 'Mga rekord ayon sa munisipalidad'],
  'transparency.coverageDesc': ['Provincial records are not attributed to a municipality without evidence.', 'Ang mga rekord ng lalawigan ay hindi itinatakda sa isang munisipalidad nang walang ebidensya.'],
  'transparency.municipality': ['Municipality', 'Munisipalidad'],
  'transparency.records': ['Records', 'Mga rekord'],
  'transparency.recordsTitle': ['Published transparency records', 'Nailathalang rekord ng transparensiya'],
  'transparency.allMunicipalities': ['All municipalities', 'Lahat ng munisipalidad'],
  'transparency.tabAll': ['All records', 'Lahat ng rekord'],
  'transparency.tabBudget': ['Budget', 'Badyet'],
  'transparency.tabExpenditure': ['Expenditure', 'Gastos'],
  'transparency.tabProcurement': ['Procurement', 'Pagbili'],
  'transparency.tabAccountability': ['Accountability', 'Pananagutan'],
  'transparency.filter': ['Filter', 'I-filter'],
  'transparency.unavailableTitle': ['Transparency data temporarily unavailable', 'Pansamantalang hindi available ang datos ng transparensiya'],
  'transparency.retry': ['Retry', 'Subukan muli'],

  // Announcements
  'ann.eyebrow': ['Public information', 'Pampublikong impormasyon'],
  'ann.title': ['Announcements and updates', 'Mga anunsyo at update'],
  'ann.description': [
    'Published announcements, advisories and community updates. Every item shows its source and verification status.',
    'Nailathalang anunsyo, abiso at update ng komunidad. Ipinapakita ng bawat item ang pinagmulan at katayuan ng beripikasyon.',
  ],
  'ann.searchPlaceholder': ['Search announcements', 'Maghanap ng anunsyo'],
  'ann.allCategories': ['All categories', 'Lahat ng kategorya'],
  'ann.provinceAndMunicipal': ['Province-wide & municipal', 'Panlalawigan at panmunisipalidad'],
  'ann.sortNewest': ['Newest first', 'Pinakabago muna'],
  'ann.sortOldest': ['Oldest first', 'Pinakaluma muna'],
  'ann.sortTitle': ['Title A–Z', 'Pamagat A–Z'],
  'ann.apply': ['Apply', 'Ilapat'],
  'ann.featured': ['Featured announcement', 'Tampok na anunsyo'],
  'ann.emptyTitle': ['No announcements published yet', 'Wala pang nailathalang anunsyo'],
  'ann.emptyDescription': [
    'Announcements appear here after they pass review and are published. BetterGo does not create placeholder government announcements.',
    'Lumalabas ang mga anunsyo rito pagkatapos ng pagsusuri at paglathala. Hindi gumagawa ang BetterGo ng pansamantalang anunsyo ng gobyerno.',
  ],
  'ann.emptyAction': ['Submit information for review', 'Magsumite ng impormasyon para sa pagsusuri'],
  'ann.unavailableTitle': ['Announcements are temporarily unavailable', 'Pansamantalang hindi available ang mga anunsyo'],
  'ann.sourceTitle': ['Source matters.', 'Mahalaga ang pinagmulan.'],
  'ann.sourceText': [
    'BetterGo distinguishes original community content, reproduced public information, and officially sourced announcements. Always check the original source for official decisions and deadlines.',
    'Pinag-iiba ng BetterGo ang orihinal na nilalaman ng komunidad, muling inilathalang pampublikong impormasyon, at anunsyong mula sa opisyal na sanggunian. Laging tingnan ang orihinal na pinagmulan para sa opisyal na desisyon at deadline.',
  ],
  'ann.notFoundTitle': ['Announcement not found', 'Hindi natagpuan ang anunsyo'],
  'ann.notFoundDescription': [
    'This announcement may have been unpublished, archived, has expired, or the address is incorrect.',
    'Maaaring naalis sa paglathala ang anunsyong ito, na-archive, nag-expire, o mali ang address.',
  ],
  'ann.all': ['All announcements', 'Lahat ng anunsyo'],

  // Citizen dashboard
  'dash.navOverview': ['Overview', 'Pangkalahatang-tanaw'],
  'dash.navProfile': ['My profile', 'Aking profile'],
  'dash.navAccount': ['Account settings', 'Mga setting ng account'],
  'dash.navPreferences': ['Preferences', 'Mga kagustuhan'],
  'dash.navReports': ['My submissions', 'Aking mga isinumite'],
  'dash.navSaved': ['Saved services', 'Mga naka-save na serbisyo'],
  'dash.navPrivacy': ['Privacy & data', 'Privacy at datos'],
  'dash.citizenAccount': ['Citizen account', 'Account ng mamamayan'],
  'dash.welcome': ['Welcome,', 'Maligayang pagdating,'],
  'dash.citizen': ['citizen', 'mamamayan'],
  'dash.title': ['My dashboard', 'Aking dashboard'],
  'dash.description': ['Your account, submissions and saved information in one place.', 'Ang iyong account, mga isinumite at naka-save na impormasyon sa isang lugar.'],
  'dash.breadcrumb': ['Dashboard', 'Dashboard'],
  'dash.editProfile': ['Edit profile', 'I-edit ang profile'],
  'dash.profileCompletion': ['Profile completion', 'Kumpleto ng profile'],
  'dash.profileCompletionHelp': ['Calculated from your stored profile fields only.', 'Kinakalkula lamang mula sa mga nakatalang field ng iyong profile.'],
  'dash.emailVerification': ['Email verification', 'Beripikasyon ng email'],
  'dash.verified': ['Verified', 'Beripikado'],
  'dash.notVerified': ['Not verified', 'Hindi beripikado'],
  'dash.verifyNow': ['Verify your email to secure your account.', 'I-verify ang iyong email upang maprotektahan ang account.'],
  'dash.municipality': ['Municipality', 'Munisipalidad'],
  'dash.notSet': ['Not set', 'Hindi nakatakda'],
  'dash.municipalityHelp': ['Used for relevant platform features only.', 'Ginagamit lamang para sa mga kaugnay na feature ng plataporma.'],
  'dash.unread': ['Unread notifications', 'Hindi pa nababasang notification'],
  'dash.manageNotifications': ['Manage notifications', 'Pamahalaan ang notification'],
  'dash.checklist': ['Profile checklist', 'Listahan ng profile'],
  'dash.optional': ['(optional)', '(opsyonal)'],
  'dash.completeProfile': ['Complete my profile', 'Kumpletuhin ang aking profile'],
  'dash.activity': ['My activity', 'Aking aktibidad'],
  'dash.noActivity': ['No account activity recorded yet.', 'Wala pang naitalang aktibidad sa account.'],
  'dash.savedCard': ['Saved services', 'Mga naka-save na serbisyo'],
  'dash.savedCount': ['saved service', 'naka-save na serbisyo'],
  'dash.reportsCard': ['My submissions', 'Aking mga isinumite'],
  'dash.reportsCount': ['submitted report', 'isinumiteng ulat'],
  'dash.privacyCard': ['Privacy & data', 'Privacy at datos'],
  'dash.privacyCount': ['privacy request', 'kahilingan sa privacy'],
  'dash.onFile': ['on file.', 'sa file.'],
  'dash.roles': ['My roles', 'Aking mga tungkulin'],
  'dash.rolesHelp': [
    'Roles are assigned by authorised administrators. A municipality-scoped role only grants access to that municipality.',
    'Ang mga tungkulin ay itinatakda ng awtorisadong administrador. Ang tungkuling may saklaw sa munisipalidad ay nagbibigay lamang ng access sa munisipalidad na iyon.',
  ],
  'dash.futureHelp': [
    'Links to future citizen services (service requests, appointments and document tracking) will appear here as those modules are implemented. This dashboard only shows features that actually exist.',
    'Lalabas dito ang mga link sa mga susunod na serbisyo para sa mamamayan (mga kahilingan, appointment at pagsubaybay ng dokumento) kapag naipatupad na ang mga module. Ipinapakita lamang ng dashboard na ito ang mga feature na talagang umiiral.',
  ],
  'dash.checks.first': ['First name', 'Pangalan'],
  'dash.checks.last': ['Last name', 'Apelyido'],
  'dash.checks.email': ['Valid email address', 'Wastong email address'],
  'dash.checks.verified': ['Email verified', 'Beripikadong email'],
  'dash.checks.municipality': ['Municipality selected', 'Napiling munisipalidad'],
  'dash.checks.phone': ['Contact number added (optional)', 'Naidagdag na contact number (opsyonal)'],
  'dash.eyebrowAccount': ['Account', 'Account'],
  'dash.eyebrowPrivacy': ['Privacy', 'Privacy'],
  'dash.privacyTitle': ['Privacy and personal data', 'Privacy at personal na datos'],
  'dash.eyebrowParticipation': ['Participation', 'Pakikilahok'],
  'dash.profileDesc': ['Information you have shared with BetterGo Marinduque.', 'Impormasyong ibinahagi mo sa BetterGo Marinduque.'],
  'dash.editProfileDesc': [
    'Only the fields below can be changed by you. Roles, account status and verification flags are managed by administrators.',
    'Ikaw lamang ang makakabago sa mga field sa ibaba. Ang mga tungkulin, katayuan ng account at verification flag ay pinamamahalaan ng administrador.',
  ],
  'dash.accountStatus': ['Account status', 'Katayuan ng account'],
  'p4.lastLogin': ['Last sign-in', 'Huling pag-sign in'],
  'dash.accountDesc': [
    'Manage your sign-in credentials, email address and account status.',
    'Pamahalaan ang iyong mga kredensyal sa pag-sign in, email address at katayuan ng account.',
  ],
  'dash.preferencesDesc': ['Control how the platform looks and which updates you receive.', 'Kontrolin ang itsura ng plataporma at kung anong update ang natatanggap mo.'],
  'dash.privacyDesc': [
    'Control your consents, download your data, and submit privacy requests.',
    'Pamahalaan ang iyong pahintulot, i-download ang iyong datos, at magsumite ng kahilingan sa privacy.',
  ],
  'dash.requestsTitle': ['My data requests', 'Aking mga kahilingan sa datos'],
  'dash.requestsDesc': ['Track requests you have submitted about your personal information.', 'Subaybayan ang mga kahilingang isinumite mo tungkol sa iyong personal na impormasyon.'],
  'dash.requestsBreadcrumb': ['Requests', 'Mga kahilingan'],
  'dash.savedDesc': ['Services you have bookmarked for quick reference.', 'Mga serbisyong na-bookmark mo para madaling balikan.'],
  'dash.reportsDesc': [
    'Feedback, concerns and suggestions you have submitted, with their review status.',
    'Mga feedback, alalahanin at mungkahing isinumite mo, kasama ang katayuan ng pagsusuri.',
  ],
  'dash.newSubmission': ['New submission', 'Bagong isinumite'],

  // Phase 4 citizen services
  'p4.quickTitle': ['Government services for you', 'Mga serbisyo ng gobyerno para sa iyo'],
  'p4.quickEmpty': ['No published service is available yet.', 'Wala pang available na nailathalang serbisyo.'],
  'p4.browseServices': ['Browse the directory', 'Tingnan ang direktoryo'],
  'p4.notifications': ['Recent notifications', 'Mga bagong notification'],
  'p4.noNotifications': ['You have no notifications.', 'Wala kang notification.'],
  'p4.viewAll': ['View all', 'Tingnan lahat'],
  'p4.applications': ['Application tracking', 'Pagsubaybay ng aplikasyon'],
  'p4.noApplications': ['You have no tracked applications.', 'Wala kang sinusubaybayang aplikasyon.'],
  'p4.applicationsNote': [
    'BetterGo tracking records are not government applications. No application is submitted, approved or issued here.',
    'Ang mga tracking record ng BetterGo ay hindi aplikasyon sa gobyerno. Walang aplikasyong isinusumite, inaaprubahan o inilalabas dito.',
  ],
  'p4.trackApplications': ['Open application tracking', 'Buksan ang pagsubaybay'],
  'p4.localNews': ['From your municipality', 'Mula sa iyong munisipalidad'],
  'p4.noLocalNews': ['No published announcements for your municipality yet.', 'Wala pang nailathalang anunsyo para sa iyong munisipalidad.'],
  'p4.recentlyViewed': ['Recently viewed', 'Mga huling tiningnan'],
  'p4.nothingViewed': ['Services you open will appear here.', 'Lalabas dito ang mga serbisyong binuksan mo.'],
  'p4.security': ['Account security', 'Seguridad ng account'],
  'p4.manageSecurity': ['Manage account security', 'Pamahalaan ang seguridad ng account'],
  'p4.activityTitle': ['Activity history', 'Kasaysayan ng aktibidad'],
  'p4.activityDesc': [
    'Your own account activity. Only you can see this list, and viewing records are deduplicated.',
    'Aktibidad ng iyong account. Ikaw lamang ang makakakita nito, at hindi inuulit ang mga rekord ng pagtingin.',
  ],
  'p4.clearActivity': ['Clear my activity history', 'Burahin ang kasaysayan ng aktibidad'],
  'p4.noActivity': ['No activity recorded yet.', 'Wala pang naitalang aktibidad.'],
  'p4.documentsTitle': ['My documents', 'Aking mga dokumento'],
  'p4.documentsDesc': [
    'Metadata for documents you have chosen to keep. Files are private and never listed publicly.',
    'Metadata ng mga dokumentong pinili mong itago. Pribado ang mga file at hindi kailanman nakalista sa publiko.',
  ],
  'p4.noDocuments': ['You have not added any documents.', 'Wala kang naidagdag na dokumento.'],
  'p4.uploadsOff': ['Uploads are not enabled in this release.', 'Hindi pa pinagana ang pag-upload sa bersyong ito.'],
  'p4.applicationStatus': ['Tracking status', 'Katayuan ng pagsubaybay'],
  'p4.notGovernment': ['Not a government status', 'Hindi katayuan ng gobyerno'],

  // 3D hero scene
  'scene.aria': [
    'Stylised three-dimensional illustration of a heart-shaped island province, surrounded by water, with six small beacons representing the municipalities. Decorative only — not a map to scale.',
    'Estilong three-dimensional na ilustrasyon ng isang pulong hugis-puso, napapalibutan ng tubig, may anim na maliit na beacon na kumakatawan sa mga munisipalidad. Palamuti lamang — hindi ito mapa na may tamang sukat.',
  ],
  'scene.failed': [
    'Your browser could not start the 3D illustration. All information below is unaffected.',
    'Hindi naumpisahan ng iyong browser ang 3D na ilustrasyon. Walang naapektuhang impormasyon sa ibaba.',
  ],
  'scene.drag': ['Drag to explore', 'I-drag upang galugarin'],
  'scene.scale': ['Stylised · not to scale', 'Estilo lamang · hindi tamang sukat'],
  'scene.loading': ['Loading the island illustration…', 'Nilo-load ang ilustrasyon ng isla…'],

  // Common
  'common.open': ['Open', 'Buksan'],
  'common.viewAll': ['View all', 'Tingnan lahat'],
  'common.all': ['All', 'Lahat'],
  'common.language': ['Language', 'Wika'],
  'common.edit': ['Edit', 'I-edit'],
  'common.filipino': ['Filipino', 'Filipino'],
  'common.english': ['English', 'Ingles'],
}

const STORAGE_KEY = 'bg-lang'
const LanguageContext = createContext({ lang: 'en', setLang: () => {}, t: (key, fallback) => fallback || key })

function initialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'fil' || saved === 'en') return saved
  } catch {
    /* storage may be unavailable */
  }
  return 'en'
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(initialLang)

  const setLang = useCallback((next) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* preference still applies for this session */
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang === 'fil' ? 'fil' : 'en'
  }, [lang])

  const value = useMemo(() => {
    const t = (key, fallback) => {
      const entry = STRINGS[key]
      if (!entry) return fallback ?? key
      return lang === 'fil' ? entry[1] : entry[0]
    }
    return { lang, setLang, toggle: () => setLang(lang === 'fil' ? 'en' : 'fil'), t }
  }, [lang, setLang])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLang() {
  return useContext(LanguageContext)
}

/** Convenience hook for components that only need the translator. */
export function useT() {
  return useContext(LanguageContext).t
}
