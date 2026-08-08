/**
 * @file wms-carriers.js — the carriers the Outbound team ships through.
 *
 * Two modules split their pages by carrier (ทำใบงานขนส่ง and เอกสารขนส่ง). Who
 * exists is the same question in both, so it is answered once here; what each
 * module has ready for a carrier is that module's own business and stays there.
 *
 * `dir` is the folder under a module's root. '' means the module's index page,
 * which is where รถบริษัท lives in both modules — it is the carrier with the
 * most in it, so it gets the shortest URL.
 */
export const CARRIERS = [
  { id: 'company', label: 'รถบริษัท', dir: '' },
  { id: 'kex', label: 'Kex express', dir: 'kex' },
  { id: 'best', label: 'Best express', dir: 'best' },
  { id: 'bi', label: 'Business Idea', dir: 'business-idea' },
];
