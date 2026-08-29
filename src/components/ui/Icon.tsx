/**
 * Icon set.
 *
 * Hand-drawn on a 24-grid, 1.7 stroke, round caps — one visual family so the
 * interface does not look assembled from three icon packs. Shipping them inline
 * also means no icon font to fetch, which matters for an app that runs offline.
 */

export type IconName =
  | 'home' | 'users' | 'user' | 'list' | 'sprout' | 'basket' | 'coins' | 'book'
  | 'chart' | 'settings' | 'search' | 'bell' | 'plus' | 'minus' | 'check' | 'check-double'
  | 'x' | 'filter' | 'download' | 'upload' | 'columns' | 'sort' | 'sort-up' | 'sort-down'
  | 'edit' | 'trash' | 'more' | 'arrow-left' | 'arrow-right' | 'chevron-down' | 'chevron-right'
  | 'chevron-left' | 'truck' | 'warehouse' | 'alert' | 'info' | 'eye' | 'calendar' | 'phone'
  | 'map-pin' | 'logout' | 'wifi' | 'wifi-off' | 'undo' | 'redo' | 'file' | 'printer'
  | 'shield' | 'clock' | 'tag' | 'scale' | 'droplet' | 'bug' | 'tools' | 'wrench' | 'box'
  | 'package' | 'star' | 'flask' | 'seedling' | 'shovel' | 'tractor' | 'spray' | 'scissors'
  | 'graduation' | 'map' | 'receipt' | 'bank' | 'gift' | 'hand-coins' | 'file-signature'
  | 'badge-check' | 'dots' | 'arrows' | 'layers' | 'refresh' | 'lock' | 'grid' | 'card'
  | 'trending-up' | 'wallet' | 'clipboard' | 'zap' | 'inbox' | 'sun' | 'moon' | 'globe';

const P: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M9.5 20v-6h5v6',
  users: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5ZM20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.2a3.25 3.25 0 0 1 0 6.1',
  user: 'M19 20v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  list: 'M8.5 6.5h12M8.5 12h12M8.5 17.5h12M3.5 6.5h.01M3.5 12h.01M3.5 17.5h.01',
  sprout: 'M12 20v-7M12 13c0-3.3-2.4-5.5-5.5-5.5C6.5 11 8.7 13 12 13ZM12 13c0-3.9 2.6-6.5 6-6.5 0 3.9-2.6 6.5-6 6.5Z',
  basket: 'M4 10h16l-1.4 8.2a2 2 0 0 1-2 1.8H7.4a2 2 0 0 1-2-1.8L4 10ZM8.5 10 11 4M15.5 10 13 4M9.5 13.5v3M14.5 13.5v3',
  coins: 'M9 12.5c3.6 0 6.5-1.1 6.5-2.5S12.6 7.5 9 7.5 2.5 8.6 2.5 10s2.9 2.5 6.5 2.5ZM2.5 10v4c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-4M15 8.2c3.3.2 6.5 1.2 6.5 2.3M21.5 10.5v4c0 1.3-2.4 2.3-5.6 2.5',
  book: 'M4 4.5h9.5a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H4v-13ZM20 4.5h-3.5v13H20v-13Z',
  chart: 'M4 20V4M20 20H4M8 16.5v-4M12.5 16.5v-8M17 16.5v-5.5',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a1.9 1.9 0 1 1-3.8 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a1.9 1.9 0 1 1 0-3.8h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5v-.3a1.9 1.9 0 1 1 3.8 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a1.9 1.9 0 1 1 0 3.8h-.2a1.6 1.6 0 0 0-1.5 1Z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20.5 20.5l-4.6-4.6',
  bell: 'M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9ZM13.7 19.5a2 2 0 0 1-3.4 0',
  plus: 'M12 5.5v13M5.5 12h13',
  minus: 'M5.5 12h13',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  'check-double': 'M2.5 12.5 6.5 16.5 14.5 7.5M10 15.5l1.8 1.8L21.5 7',
  x: 'M6 6l12 12M18 6 6 18',
  filter: 'M3.5 5.5h17l-6.6 7.8v5.4l-3.8 1.9v-7.3L3.5 5.5Z',
  download: 'M12 3.5v11M7.5 10.5 12 15l4.5-4.5M4 17v2.5h16V17',
  upload: 'M12 15.5v-11M7.5 8.5 12 4l4.5 4.5M4 17v2.5h16V17',
  columns: 'M4 4.5h16v15H4v-15ZM10 4.5v15M15 4.5v15',
  sort: 'M8 8.5 12 4.5l4 4M8 15.5l4 4 4-4',
  'sort-up': 'M8 14.5 12 10l4 4.5',
  'sort-down': 'M8 9.5 12 14l4-4.5',
  edit: 'M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 6 18 9.5',
  trash: 'M4.5 6.5h15M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5',
  more: 'M12 6.2h.01M12 12h.01M12 17.8h.01',
  'arrow-left': 'M19 12H5M11 6 5 12l6 6',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  'chevron-down': 'M6 9.5 12 15.5l6-6',
  'chevron-right': 'M9.5 6 15.5 12l-6 6',
  'chevron-left': 'M14.5 6 8.5 12l6 6',
  truck: 'M3 6.5h11v10H3v-10ZM14 10h3.6l2.9 3v3.5H14V10ZM7.5 20a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM17 20a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z',
  warehouse: 'M3 20V9l9-4.5L21 9v11M3 20h18M8 20v-6.5h8V20M8 16.5h8',
  alert: 'M12 8.5v4.5M12 16.5h.01M10.3 4.2 2.6 17.5A1.9 1.9 0 0 0 4.3 20.5h15.4a1.9 1.9 0 0 0 1.7-3L13.7 4.2a1.9 1.9 0 0 0-3.4 0Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11.5v5M12 7.8h.01',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z',
  calendar: 'M4.5 6.5h15v13h-15v-13ZM8.5 3.5v4M15.5 3.5v4M4.5 10.5h15',
  phone: 'M20.5 16.9v2.6a1.7 1.7 0 0 1-1.9 1.7 17.3 17.3 0 0 1-7.5-2.7 17 17 0 0 1-5.2-5.2A17.3 17.3 0 0 1 3.2 5.8 1.7 1.7 0 0 1 4.9 4h2.6a1.7 1.7 0 0 1 1.7 1.5c.1.8.3 1.6.6 2.4a1.7 1.7 0 0 1-.4 1.8l-1.1 1.1a14 14 0 0 0 5.2 5.2l1.1-1.1a1.7 1.7 0 0 1 1.8-.4c.8.3 1.6.5 2.4.6a1.7 1.7 0 0 1 1.5 1.8Z',
  'map-pin': 'M20 10.4c0 6-8 12.1-8 12.1s-8-6.1-8-12.1a8 8 0 0 1 16 0ZM12 13a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4Z',
  logout: 'M9.5 20H5.5a1.8 1.8 0 0 1-1.8-1.8V5.8A1.8 1.8 0 0 1 5.5 4h4M16 16.5l4.5-4.5L16 7.5M20.5 12h-11',
  wifi: 'M2.5 9.5a15 15 0 0 1 19 0M5.8 13a10 10 0 0 1 12.4 0M9.2 16.4a5 5 0 0 1 5.6 0M12 19.8h.01',
  'wifi-off': 'M3 3l18 18M8.8 16.4a5 5 0 0 1 6 0M5.8 13a10 10 0 0 1 4-2.4M2.5 9.5a15 15 0 0 1 4.7-3M13.5 6.6a15 15 0 0 1 8 2.9M14.6 12.9a10 10 0 0 1 3.6 2.1M12 19.8h.01',
  undo: 'M3.5 8.5h9a6 6 0 0 1 0 12h-4M3.5 8.5 8 4M3.5 8.5 8 13',
  redo: 'M20.5 8.5h-9a6 6 0 0 0 0 12h4M20.5 8.5 16 4M20.5 8.5 16 13',
  file: 'M14 3.5H7a1.8 1.8 0 0 0-1.8 1.8v13.4A1.8 1.8 0 0 0 7 20.5h10a1.8 1.8 0 0 0 1.8-1.8V8.3L14 3.5ZM13.8 3.6V8.5h4.9',
  printer: 'M7 9V3.5h10V9M7 18H5.5A1.5 1.5 0 0 1 4 16.5v-5A1.5 1.5 0 0 1 5.5 10h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17M7 14.5h10v6H7v-6Z',
  shield: 'M12 21.5s7.5-3.4 7.5-9V5.8L12 3 4.5 5.8v6.7c0 5.6 7.5 9 7.5 9ZM9 12l2.2 2.2L15.5 10',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5.2l3.2 1.9',
  tag: 'M20.2 12.9 12.9 20.2a1.7 1.7 0 0 1-2.4 0l-7-7V4h9.2l7.5 7.5a1.7 1.7 0 0 1 0 1.4ZM7.5 8h.01',
  scale: 'M12 4v16M7 7.5h10M4 17.5a3 3 0 0 0 6 0L7 9l-3 8.5ZM14 15a3 3 0 0 0 6 0l-3-8.5L14 15ZM8.5 20.5h7',
  droplet: 'M12 3.5s6 6.4 6 10.4a6 6 0 0 1-12 0c0-4 6-10.4 6-10.4Z',
  bug: 'M8 6.5a4 4 0 0 1 8 0M6.5 10h11v4a5.5 5.5 0 0 1-11 0v-4ZM3.5 11h3M17.5 11h3M4 6.5l2.5 2M20 6.5l-2.5 2M4.5 17l2.4-1.4M19.5 17l-2.4-1.4M12 10v9',
  tools: 'M14.5 6.5a3.5 3.5 0 0 0 4.7 4.7l-9 9a2.2 2.2 0 0 1-3.1-3.1l9-9a3.5 3.5 0 0 0-1.6-1.6ZM5 5l3.5 3.5M4 9.5 8.5 5',
  wrench: 'M15.2 4.4a5 5 0 0 0-6.6 6.3L4 15.3a2.4 2.4 0 0 0 3.4 3.4l4.6-4.6a5 5 0 0 0 6.3-6.6l-2.9 2.9-2.6-.7-.7-2.6 2.9-2.9Z',
  box: 'M20.5 8.5v7l-8.5 4.5-8.5-4.5v-7L12 4l8.5 4.5ZM3.5 8.5 12 13l8.5-4.5M12 13v7',
  package: 'M4 7.5 12 3.5l8 4v9l-8 4-8-4v-9ZM4 7.5l8 4M20 7.5l-8 4M12 11.5v9M8 5.5l8 4',
  star: 'M12 3.5l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.9l6-.9L12 3.5Z',
  flask: 'M9.5 3.5h5M10.5 3.5v6L5.2 18a2 2 0 0 0 1.7 3h10.2a2 2 0 0 0 1.7-3l-5.3-8.5v-6M7.5 14.5h9',
  seedling: 'M12 20.5v-8M12 12.5a5 5 0 0 0-5-5H5a5 5 0 0 0 5 5h2ZM12 12.5a5 5 0 0 1 5-5h2a5 5 0 0 1-5 5h-2ZM8 20.5h8',
  shovel: 'M14 3.5 20.5 10M17 6.5 9 14.5M9.5 12 5 16.5a3.5 3.5 0 0 0 5 5l4.5-4.5L9.5 12Z',
  tractor: 'M4 16.5a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0ZM16.5 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7.5 13V6.5h5l2 4.5h4.5V15M4 10h3.5',
  spray: 'M9 8.5h6v12H9v-12ZM10.5 8.5V5h3v3.5M17 4h.01M19.5 6.5h.01M17 9h.01M19.5 11.5h.01M11 12h3',
  scissors: 'M6.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8.7 9.8 19.5 20.5M19.5 3.5 8.7 14.2',
  graduation: 'M12 3.5 22 8.5l-10 5-10-5 10-5ZM6 11v5.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V11M22 8.5v6',
  map: 'M9 4.5 3.5 6.5v13L9 17.5M9 4.5v13M9 4.5l6 2.5M15 7v13M15 7l5.5-2.5v13L15 20',
  receipt: 'M5.5 3.5h13v17l-2.2-1.6-2.2 1.6-2.1-1.6-2.2 1.6-2.2-1.6V3.5ZM9 8h6M9 12h6',
  bank: 'M3.5 9.5 12 4l8.5 5.5M5 9.5v9M9.5 9.5v9M14.5 9.5v9M19 9.5v9M3 21h18',
  gift: 'M4 11.5h16v9H4v-9ZM3 7.5h18v4H3v-4ZM12 7.5v13M8.5 7.5a2.5 2.5 0 0 1 0-5c1.8 0 3.5 5 3.5 5M15.5 7.5a2.5 2.5 0 0 0 0-5c-1.8 0-3.5 5-3.5 5',
  'hand-coins': 'M15 5.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM3 14.5l3-1 5.5 2h3.5a1.5 1.5 0 0 1 0 3H11M3 14.5v6l3-1 6.5 2 8.5-4.5a1.6 1.6 0 0 0-2-2.2',
  'file-signature': 'M14 3.5H7a1.8 1.8 0 0 0-1.8 1.8v13.4A1.8 1.8 0 0 0 7 20.5h10a1.8 1.8 0 0 0 1.8-1.8V13M13.8 3.6V8.5h4.9M9 16c1.5-2.5 3-3 3.5-2s-1 3-2 2.5 1.5-2 3.5-1 3 .5 3.5-.5',
  'badge-check': 'M12 2.8l2.3 1.8 2.9-.2.9 2.7 2.4 1.6-1 2.8 1 2.8-2.4 1.6-.9 2.7-2.9-.2L12 21.2l-2.3-1.8-2.9.2-.9-2.7-2.4-1.6 1-2.8-1-2.8 2.4-1.6.9-2.7 2.9.2L12 2.8ZM8.8 12l2.2 2.2 4.2-4.4',
  dots: 'M6.2 12h.01M12 12h.01M17.8 12h.01',
  arrows: 'M7 4.5 3.5 8 7 11.5M3.5 8h13M17 12.5l3.5 3.5-3.5 3.5M20.5 16h-13',
  layers: 'M12 3.5 3 8l9 4.5L21 8l-9-4.5ZM3 12.5l9 4.5 9-4.5M3 16.8l9 4.5 9-4.5',
  refresh: 'M20.5 5.5v5h-5M3.5 18.5v-5h5M4.6 9.5a8 8 0 0 1 13.2-3l2.7 2.5M19.4 14.5a8 8 0 0 1-13.2 3l-2.7-2.5',
  lock: 'M6.5 10.5h11v9h-11v-9ZM8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7M12 14v2.5',
  grid: 'M4 4.5h6.5V11H4V4.5ZM13.5 4.5H20V11h-6.5V4.5ZM4 13.5h6.5V20H4v-6.5ZM13.5 13.5H20V20h-6.5v-6.5Z',
  card: 'M3.5 6.5h17v11h-17v-11ZM3.5 10.5h17M7 14.5h3',
  'trending-up': 'M3.5 17 9 11.5l3.5 3.5 8-8M15.5 7h5v5',
  wallet: 'M3.5 7.5A2 2 0 0 1 5.5 5.5h11a2 2 0 0 1 2 2M3.5 7.5v10a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-15ZM17 13.5h.01',
  clipboard: 'M9 4.5H7.5a1.8 1.8 0 0 0-1.8 1.8v12.4A1.8 1.8 0 0 0 7.5 20.5h9a1.8 1.8 0 0 0 1.8-1.8V6.3A1.8 1.8 0 0 0 16.5 4.5H15M9 4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5v1.2H9V4.5ZM9 12h6M9 15.5h4',
  zap: 'M13.5 3 4.5 14h6.5l-1 7 9-11h-6.5l1-7Z',
  inbox: 'M3.5 13.5h4l1.5 3h6l1.5-3h4M3.5 13.5 6.2 5a1.8 1.8 0 0 1 1.7-1.2h8.2A1.8 1.8 0 0 1 17.8 5l2.7 8.5v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-5Z',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8Z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3.2 9.5h17.6M3.2 14.5h17.6M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
};

interface Props {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  filled?: boolean;
  style?: React.CSSProperties;
}

export function Icon({ name, size = 18, className, strokeWidth = 1.7, filled = false, style }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      style={filled ? { fill: 'currentColor', fillOpacity: 0.12, ...style } : style}
    >
      <path d={P[name] ?? P.dots} />
    </svg>
  );
}

/** The wordmark leaf, used in the sidebar and on the login card. */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21V11.5M12 11.5C12 7.4 15 4 19.5 3.5c.4 4.4-2.6 8-7.5 8ZM12 14c0-2.8-2.1-4.8-5-5-.3 3 1.9 5 5 5Z"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
