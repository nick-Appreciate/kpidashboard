// Single source of truth for every user-facing string on the public
// listings site. Components accept a `locale: Locale` prop and look up
// strings here via getDictionary(locale).
//
// MAINTENANCE: When you add or change a string in any public listings
// component (components/public/*, app/listings/*, app/es/listings/*),
// add the matching key to BOTH the `en` and `es` sections below. See
// CLAUDE.md "UI Conventions" for the full rule.

import type { Locale } from './index';

interface Dictionary {
  nav: {
    brand: string;
    tenantPortal: string;
    admin: string;
    toggleMenu: string;
  };
  hero: {
    tagline: string;
    headingPre: string;
    headingHome: string;
    headingPost: string;
    ctaSeeListings: string;
    ctaPortal: string;
  };
  filters: {
    bedrooms: string;
    any: string;
    bed1plus: string;
    bed2plus: string;
    bed3plus: string;
    bed4plus: string;
    maxRent: string;
    petsOk: string;
    sort: string;
    sortAvailableSoonest: string;
    sortRentLowHigh: string;
    sortRentHighLow: string;
    sortMostBedrooms: string;
  };
  empty: {
    noneTitle: string;
    noneBody: string;
    filteredTitle: string;
    filteredBody: string;
  };
  map: {
    loading: string;
    overlineLocations: string;
    sectionHeading: string;
    geoHint: string;
    popupViewProperty: string;
    popupUnit: (n: number) => string; // e.g. "1 unit available" / "3 units available"
    perMonth: string; // "/mo"
  };
  card: {
    unitsAvailable: (n: number) => string;
    perMonth: string; // "/mo"
  };
  detail: {
    backAll: string;
    specsLine: (bed: number, bath: number, sqft: string, availability: string) => string;
    perMonthLong: string; // "/ month"
    deposit: string;
    appFee: string;
    petPolicy: string;
    applyNow: string;
    portalTenant: string;
    otherUnitsAt: (addr: string) => string;
    unitSpec: (bd: number, ba: number, sqft: string) => string;
    location: string;
    openMaps: string;
    openGallery: string;
    openPhoto: (n: number) => string;
    extraCount: (n: number) => string;
    showAllPhotos: (n: number) => string;
  };
  footer: {
    brand: string;
    tagline: string;
    colProspective: string;
    availableRentals: string;
    applyOnline: string;
    colCurrent: string;
    tenantPortal: string;
    payRent: string;
    maintenance: string;
    copyright: (year: number) => string;
    locations: string;
  };
  lightbox: {
    closeGallery: string;
    galleryLabel: string;
    prev: string;
    next: string;
    goToPhoto: (n: number) => string;
  };
  availability: {
    callForAvailability: string;
    availableNow: string;
    availablePrefix: string; // e.g. "Available " / "Disponible el "
  };
  languageSwitcher: {
    /** Label shown on this locale's pages, pointing at the OTHER locale. */
    switchTo: string;
    /** aria-label for the switcher link. */
    ariaLabel: string;
  };
  prequal: {
    title: string;
    subtitle: string;
    emailLabel: string;
    emailPlaceholder: string;
    incomeLabel: string;
    incomeHelp: (minIncome: string) => string;
    incomePlaceholder: string;
    creditLabel: string;
    creditBands: {
      below_580: string;
      '580_619': string;
      '620_679': string;
      '680_plus': string;
      unsure: string;
    };
    moveInLabel: string;
    moveInHelp: string;
    submit: string;
    submitting: string;
    cancel: string;
    /** Error shown when the user submits with missing required fields. */
    errorRequired: string;
    errorSubmit: string;
    passedTitle: string;
    passedBody: string;
    continueToApp: string;
    failedTitle: string;
    failedBody: (minIncome: string) => string;
    failedRequirementIncome: (minIncome: string) => string;
    failedRequirementCredit: string;
    close: string;
  };
}

const en: Dictionary = {
  nav: {
    brand: 'Appreciate Property Management',
    tenantPortal: 'Tenant Portal',
    admin: 'Admin',
    toggleMenu: 'Toggle menu',
  },
  hero: {
    tagline: 'Kansas City · Columbia · Independence',
    headingPre: 'Find your next',
    headingHome: 'home',
    headingPost: '.',
    ctaSeeListings: 'See listings ↓',
    ctaPortal: 'Tenant Portal ↗',
  },
  filters: {
    bedrooms: 'Bedrooms',
    any: 'Any',
    bed1plus: '1+',
    bed2plus: '2+',
    bed3plus: '3+',
    bed4plus: '4+',
    maxRent: 'Max rent',
    petsOk: 'Pets OK',
    sort: 'Sort',
    sortAvailableSoonest: 'Available soonest',
    sortRentLowHigh: 'Rent: low to high',
    sortRentHighLow: 'Rent: high to low',
    sortMostBedrooms: 'Most bedrooms',
  },
  empty: {
    noneTitle: 'No rentals available right now.',
    noneBody: 'Check back soon — our portfolio updates hourly.',
    filteredTitle: 'Nothing matches those filters.',
    filteredBody: 'Try widening your criteria.',
  },
  map: {
    loading: 'Loading map…',
    overlineLocations: 'Where we have rentals',
    sectionHeading: 'Our properties on the map',
    geoHint: 'If you allow location access, the map zooms to properties near you.',
    popupViewProperty: 'View property →',
    popupUnit: (n) => `${n} unit${n === 1 ? '' : 's'} available`,
    perMonth: '/mo',
  },
  card: {
    unitsAvailable: (n) => `${n} units available`, // only called for n > 1
    perMonth: '/mo',
  },
  detail: {
    backAll: '← All listings',
    specsLine: (bed, bath, sqft, availability) =>
      `${bed} bed · ${bath} bath · ${sqft} sqft · ${availability}`,
    perMonthLong: '/ month',
    deposit: 'Deposit',
    appFee: 'Application fee',
    petPolicy: 'Pet policy',
    applyNow: 'Apply now ↗',
    portalTenant: 'Already a tenant? Portal ↗',
    otherUnitsAt: (addr) => `Other units at ${addr}`,
    unitSpec: (bd, ba, sqft) => `${bd} bd · ${ba} ba · ${sqft} sqft`,
    location: 'Location',
    openMaps: 'Open in Google Maps ↗',
    openGallery: 'Open photo gallery',
    openPhoto: (n) => `Open photo ${n}`,
    extraCount: (n) => `+${n} more`,
    showAllPhotos: (n) => `Show all ${n} photos`,
  },
  footer: {
    brand: 'Appreciate Property Management',
    tagline:
      'Property management serving the Kansas City and mid-Missouri rental markets. Thoughtful homes, straightforward leases.',
    colProspective: 'Prospective Tenants',
    availableRentals: 'Available Rentals',
    applyOnline: 'Apply Online ↗',
    colCurrent: 'Current Tenants',
    tenantPortal: 'Tenant Portal ↗',
    payRent: 'Pay Rent ↗',
    maintenance: 'Maintenance Request ↗',
    copyright: (year) => `© ${year} Appreciate, Inc. All rights reserved.`,
    locations: 'Kansas City · Columbia · Independence',
  },
  lightbox: {
    closeGallery: 'Close gallery',
    galleryLabel: 'Photo gallery',
    prev: 'Previous photo',
    next: 'Next photo',
    goToPhoto: (n) => `Go to photo ${n}`,
  },
  availability: {
    callForAvailability: 'Call for availability',
    availableNow: 'Available now',
    availablePrefix: 'Available ',
  },
  languageSwitcher: {
    switchTo: 'Español',
    ariaLabel: 'Switch to Spanish',
  },
  prequal: {
    title: 'Quick pre-qualification',
    subtitle:
      'Two questions so we can confirm this unit fits your situation before you start the full application.',
    emailLabel: 'Email',
    emailPlaceholder: 'you@example.com',
    incomeLabel: 'Monthly household income',
    incomeHelp: (minIncome) => `We typically look for income at or above ${minIncome}/month for this unit.`,
    incomePlaceholder: '3,500',
    creditLabel: 'Approximate credit score',
    creditBands: {
      below_580: 'Below 580',
      '580_619': '580 – 619',
      '620_679': '620 – 679',
      '680_plus': '680+',
      unsure: 'I\'m not sure',
    },
    moveInLabel: 'Desired move-in date (optional)',
    moveInHelp: 'Helps us match you with the right unit if this one isn\'t ready in time.',
    submit: 'Continue to application',
    submitting: 'Checking…',
    cancel: 'Cancel',
    errorRequired: 'Please fill in your email, income, and credit range.',
    errorSubmit: 'Something went wrong. Please try again or contact us directly.',
    passedTitle: 'You\'re a good fit — let\'s get you started.',
    passedBody:
      'You meet our basic criteria for this unit. Click below to complete the full application in AppFolio.',
    continueToApp: 'Open application ↗',
    failedTitle: 'Thanks for your interest.',
    failedBody: (minIncome) =>
      `Based on what you\'ve shared, this unit may not be the right fit. We typically look for income of at least ${minIncome}/month and a credit score of 620 or higher. We\'ve saved your contact information and will reach out if a unit matching your situation becomes available.`,
    failedRequirementIncome: (minIncome) => `Monthly income of at least ${minIncome}`,
    failedRequirementCredit: 'Credit score of 620 or higher',
    close: 'Close',
  },
};

const es: Dictionary = {
  nav: {
    brand: 'Appreciate Property Management',
    tenantPortal: 'Portal del inquilino',
    admin: 'Administrador',
    toggleMenu: 'Abrir menú',
  },
  hero: {
    tagline: 'Kansas City · Columbia · Independence',
    headingPre: 'Encuentra tu próximo',
    headingHome: 'hogar',
    headingPost: '.',
    ctaSeeListings: 'Ver propiedades ↓',
    ctaPortal: 'Portal del inquilino ↗',
  },
  filters: {
    bedrooms: 'Habitaciones',
    any: 'Cualquiera',
    bed1plus: '1+',
    bed2plus: '2+',
    bed3plus: '3+',
    bed4plus: '4+',
    maxRent: 'Renta máxima',
    petsOk: 'Mascotas permitidas',
    sort: 'Ordenar',
    sortAvailableSoonest: 'Disponibilidad más próxima',
    sortRentLowHigh: 'Renta: menor a mayor',
    sortRentHighLow: 'Renta: mayor a menor',
    sortMostBedrooms: 'Más habitaciones',
  },
  empty: {
    noneTitle: 'No hay propiedades disponibles en este momento.',
    noneBody: 'Vuelve pronto — nuestro inventario se actualiza cada hora.',
    filteredTitle: 'Ninguna propiedad coincide con esos filtros.',
    filteredBody: 'Prueba a ampliar tus criterios.',
  },
  map: {
    loading: 'Cargando mapa…',
    overlineLocations: 'Dónde tenemos propiedades',
    sectionHeading: 'Nuestras propiedades en el mapa',
    geoHint: 'Si permites acceso a tu ubicación, el mapa se enfoca en las propiedades cerca de ti.',
    popupViewProperty: 'Ver propiedad →',
    popupUnit: (n) => `${n} ${n === 1 ? 'unidad disponible' : 'unidades disponibles'}`,
    perMonth: '/mes',
  },
  card: {
    unitsAvailable: (n) => `${n} unidades disponibles`, // n > 1
    perMonth: '/mes',
  },
  detail: {
    backAll: '← Todas las propiedades',
    specsLine: (bed, bath, sqft, availability) =>
      `${bed} ${bed === 1 ? 'habitación' : 'habitaciones'} · ${bath} ${bath === 1 ? 'baño' : 'baños'} · ${sqft} sqft · ${availability}`,
    perMonthLong: '/ mes',
    deposit: 'Depósito',
    appFee: 'Costo de aplicación',
    petPolicy: 'Política de mascotas',
    applyNow: 'Aplicar ahora ↗',
    portalTenant: '¿Ya eres inquilino? Portal ↗',
    otherUnitsAt: (addr) => `Otras unidades en ${addr}`,
    unitSpec: (bd, ba, sqft) =>
      `${bd} ${bd === 1 ? 'hab' : 'hab'} · ${ba} ${ba === 1 ? 'baño' : 'baños'} · ${sqft} sqft`,
    location: 'Ubicación',
    openMaps: 'Abrir en Google Maps ↗',
    openGallery: 'Abrir galería de fotos',
    openPhoto: (n) => `Abrir foto ${n}`,
    extraCount: (n) => `+${n} más`,
    showAllPhotos: (n) => `Ver las ${n} fotos`,
  },
  footer: {
    brand: 'Appreciate Property Management',
    tagline:
      'Administración de propiedades en Kansas City y el centro de Missouri. Hogares bien cuidados, contratos sencillos.',
    colProspective: 'Futuros inquilinos',
    availableRentals: 'Propiedades disponibles',
    applyOnline: 'Aplicar en línea ↗',
    colCurrent: 'Inquilinos actuales',
    tenantPortal: 'Portal del inquilino ↗',
    payRent: 'Pagar renta ↗',
    maintenance: 'Solicitud de mantenimiento ↗',
    copyright: (year) => `© ${year} Appreciate, Inc. Todos los derechos reservados.`,
    locations: 'Kansas City · Columbia · Independence',
  },
  lightbox: {
    closeGallery: 'Cerrar galería',
    galleryLabel: 'Galería de fotos',
    prev: 'Foto anterior',
    next: 'Siguiente foto',
    goToPhoto: (n) => `Ir a la foto ${n}`,
  },
  availability: {
    callForAvailability: 'Llama para conocer disponibilidad',
    availableNow: 'Disponible ahora',
    availablePrefix: 'Disponible el ',
  },
  languageSwitcher: {
    switchTo: 'English',
    ariaLabel: 'Cambiar a inglés',
  },
  prequal: {
    title: 'Pre-calificación rápida',
    subtitle:
      'Dos preguntas para confirmar que esta unidad encaja con tu situación antes de comenzar la aplicación completa.',
    emailLabel: 'Correo electrónico',
    emailPlaceholder: 'tu@ejemplo.com',
    incomeLabel: 'Ingreso mensual del hogar',
    incomeHelp: (minIncome) => `Para esta unidad normalmente buscamos un ingreso de al menos ${minIncome}/mes.`,
    incomePlaceholder: '3,500',
    creditLabel: 'Puntaje de crédito aproximado',
    creditBands: {
      below_580: 'Menos de 580',
      '580_619': '580 – 619',
      '620_679': '620 – 679',
      '680_plus': '680+',
      unsure: 'No estoy seguro',
    },
    moveInLabel: 'Fecha deseada de mudanza (opcional)',
    moveInHelp: 'Nos ayuda a recomendarte la unidad correcta si esta no está lista a tiempo.',
    submit: 'Continuar con la aplicación',
    submitting: 'Verificando…',
    cancel: 'Cancelar',
    errorRequired: 'Por favor completa tu correo, ingreso y rango de crédito.',
    errorSubmit: 'Algo salió mal. Intenta de nuevo o contáctanos directamente.',
    passedTitle: 'Eres un buen candidato — vamos a comenzar.',
    passedBody:
      'Cumples con nuestros criterios básicos para esta unidad. Haz clic abajo para completar la aplicación en AppFolio.',
    continueToApp: 'Abrir aplicación ↗',
    failedTitle: 'Gracias por tu interés.',
    failedBody: (minIncome) =>
      `Con base en lo que compartiste, esta unidad podría no ser la mejor opción. Normalmente buscamos un ingreso de al menos ${minIncome}/mes y un puntaje de crédito de 620 o más. Guardamos tu información de contacto y te avisaremos si surge una unidad que coincida con tu situación.`,
    failedRequirementIncome: (minIncome) => `Ingreso mensual de al menos ${minIncome}`,
    failedRequirementCredit: 'Puntaje de crédito de 620 o más',
    close: 'Cerrar',
  },
};

const dictionaries: Record<Locale, Dictionary> = { en, es };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries.en;
}

export type { Dictionary };

// ─── Amenity translation map ─────────────────────────────────────────
//
// AppFolio-sourced amenity labels come in English. When rendering on the
// Spanish site we look them up here; unknown labels pass through untouched
// so a new amenity from AppFolio never breaks rendering — it just shows in
// English until this map is extended.

const amenityEs: Record<string, string> = {
  'Pool': 'Piscina',
  'Pets OK': 'Mascotas permitidas',
  'Pets Allowed': 'Mascotas permitidas',
  'Cats OK': 'Gatos permitidos',
  'Dogs OK': 'Perros permitidos',
  'No Pets': 'No se permiten mascotas',
  'Gym': 'Gimnasio',
  'Fitness Center': 'Centro de ejercicio',
  'Parking': 'Estacionamiento',
  'Garage': 'Cochera',
  'Off-Street Parking': 'Estacionamiento privado',
  'Laundry': 'Lavandería',
  'In-Unit Laundry': 'Lavadora/secadora en la unidad',
  'Washer/Dryer': 'Lavadora y secadora',
  'Washer & Dryer': 'Lavadora y secadora',
  'Dishwasher': 'Lavaplatos',
  'Air Conditioning': 'Aire acondicionado',
  'Central Air': 'Aire acondicionado central',
  'Heating': 'Calefacción',
  'Central Heat': 'Calefacción central',
  'Balcony': 'Balcón',
  'Patio': 'Patio',
  'Yard': 'Jardín',
  'Fenced Yard': 'Jardín cercado',
  'Hardwood Floors': 'Pisos de madera',
  'Carpet': 'Alfombra',
  'Tile': 'Baldosa',
  'Stainless Steel Appliances': 'Electrodomésticos de acero inoxidable',
  'Granite Countertops': 'Encimeras de granito',
  'Walk-in Closet': 'Clóset tipo vestidor',
  'Elevator': 'Elevador',
  'Storage': 'Almacenamiento',
  'Storage Unit': 'Bodega',
  'Utilities Included': 'Servicios incluidos',
  'Water Included': 'Agua incluida',
  'Trash Included': 'Recolección de basura incluida',
  'Internet Included': 'Internet incluido',
  'Furnished': 'Amueblado',
  'Unfurnished': 'Sin amueblar',
  'Smoking Allowed': 'Se permite fumar',
  'Non-Smoking': 'No se permite fumar',
  'Handicap Accessible': 'Acceso para discapacitados',
  'On-Site Maintenance': 'Mantenimiento en sitio',
  'On-Site Management': 'Administración en sitio',
};

/** Translate an AppFolio amenity label. Unknown labels pass through. */
export function translateAmenity(label: string, locale: Locale): string {
  if (locale === 'en') return label;
  return amenityEs[label] ?? label;
}
