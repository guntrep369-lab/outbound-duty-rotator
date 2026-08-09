/**
 * @file wms-modules.js — the ONE list of top-level modules in the system.
 *
 * Read by both sidebar renderers:
 *   • static pages  → wms-shell.js  (plain DOM)
 *   • React module  → src/App.jsx   (lucide components)
 *
 * Adding a module means editing this file only. It lives in public/ because the
 * static pages load it directly over HTTP; Vite bundles it for React as well.
 *
 * `path` is relative to the SITE ROOT, so every consumer just prefixes its own
 * way back up ('./' from the root page, '../../' from /transport-docs/kex/).
 */

export const MODULES = [
  { id: 'roster', label: 'จัดตารางงาน', labelEn: 'Duty Roster', path: '', icon: 'calendar' },
  { id: 'order', label: 'เทียบ Order', labelEn: 'Order Compare', path: 'order-compare/', icon: 'clipboard' },
  { id: 'transport', label: 'ทำใบงานขนส่ง', labelEn: 'Transport Docs', path: 'transport-docs/', icon: 'truck' },
  { id: 'forms', label: 'เอกสารขนส่ง', labelEn: 'Transport Forms', path: 'transport-forms/', icon: 'file' },
  { id: 'lookup', label: 'ค้นหาออเดอร์', labelEn: 'Order Lookup', path: 'order-lookup/', icon: 'search' },
  { id: 'settings', label: 'ตั้งค่า', labelEn: 'Settings', path: 'settings/', icon: 'settings' },
];

/** Brand text — kept here so the six pages can never drift apart again. */
export const BRAND = {
  name: 'WMS Management',
  by: 'by Gun',
  sub: 'ระบบบริหารคลังสินค้า',
  logo: 'warehouse',
};

/**
 * Inner markup of the lucide icons used by the sidebar, so the static pages
 * render the exact same glyphs React does without pulling in a library.
 * Source: node_modules/lucide-react (warehouse, calendar-range, clipboard-check, truck).
 */
export const ICON_PATHS = {
  warehouse:
    '<path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12"/><path d="M6 14h12"/><rect width="12" height="12" x="6" y="10"/>',
  calendar:
    '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M17 14h-6"/><path d="M13 18H7"/><path d="M7 14h.01"/><path d="M17 18h.01"/>',
  clipboard:
    '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  truck:
    '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  file:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  search:
    '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
};
