// Mock data for the eBay Seller Automation Platform

export const mockStats = {
  activeListings: 1247,
  pausedListings: 83,
  openOrders: 34,
  revenue30Days: 28492.50,
  apiHealth: 'healthy' as const,
  lastSync: '2 min ago',
  sellersConnected: 3,
  errorCount: 7,
};

export type ListingStatus = 'active' | 'paused' | 'error' | 'pending';
export type OrderStatus = 'pending' | 'shipped' | 'delivered' | 'cancelled';
export type LogLevel = 'error' | 'warning' | 'info';

export interface Listing {
  id: string;
  sku: string;
  title: string;
  status: ListingStatus;
  price: number;
  quantity: number;
  ebayListingId: string;
  lastSynced: string;
  seller: string;
}

export interface Order {
  id: string;
  orderId: string;
  buyer: string;
  status: OrderStatus;
  total: number;
  items: number;
  trackingNumber: string | null;
  trackingPushed: boolean;
  createdAt: string;
  seller: string;
}

export interface LogEntry {
  id: string;
  level: LogLevel;
  category: string;
  message: string;
  seller: string;
  timestamp: string;
}

export const mockListings: Listing[] = [
  { id: '1', sku: 'AMZ-B09V3KXJPB-001', title: 'Wireless Bluetooth Headphones Pro Max', status: 'active', price: 49.99, quantity: 127, ebayListingId: '395012847561', lastSynced: '2 min ago', seller: 'TechStore DE' },
  { id: '2', sku: 'AMZ-B08N5WRWNW-001', title: 'USB-C Hub Multiport Adapter 7-in-1', status: 'active', price: 34.99, quantity: 83, ebayListingId: '395012847562', lastSynced: '5 min ago', seller: 'TechStore DE' },
  { id: '3', sku: 'AMZ-B07XJ8C8F5-001', title: 'Smart Watch Fitness Tracker IP68', status: 'paused', price: 29.99, quantity: 0, ebayListingId: '395012847563', lastSynced: '15 min ago', seller: 'TechStore DE' },
  { id: '4', sku: 'AMZ-B09B9TB3BT-001', title: 'Mechanical Gaming Keyboard RGB', status: 'active', price: 69.99, quantity: 45, ebayListingId: '395012847564', lastSynced: '1 min ago', seller: 'GadgetWorld' },
  { id: '5', sku: 'AMZ-B0BSHF7WHH-001', title: 'Portable Power Bank 20000mAh', status: 'error', price: 24.99, quantity: 212, ebayListingId: '395012847565', lastSynced: '1h ago', seller: 'GadgetWorld' },
  { id: '6', sku: 'AMZ-B09HBS3JBZ-001', title: 'Noise Cancelling Earbuds TWS', status: 'active', price: 39.99, quantity: 64, ebayListingId: '395012847566', lastSynced: '3 min ago', seller: 'AudioPro' },
  { id: '7', sku: 'AMZ-B0CHX1KWPH-001', title: 'LED Desk Lamp Touch Control', status: 'pending', price: 19.99, quantity: 150, ebayListingId: '-', lastSynced: 'Never', seller: 'TechStore DE' },
  { id: '8', sku: 'AMZ-B0BDJF17Y4-001', title: 'Webcam 4K Ultra HD Autofocus', status: 'active', price: 54.99, quantity: 31, ebayListingId: '395012847568', lastSynced: '8 min ago', seller: 'AudioPro' },
];

export const mockOrders: Order[] = [
  { id: '1', orderId: '12-09876-54321', buyer: 'max.m***@gmail.com', status: 'pending', total: 49.99, items: 1, trackingNumber: null, trackingPushed: false, createdAt: '2026-02-21 14:32', seller: 'TechStore DE' },
  { id: '2', orderId: '12-09876-54322', buyer: 'anna.s***@web.de', status: 'shipped', total: 104.98, items: 2, trackingNumber: 'DHL-12345678', trackingPushed: true, createdAt: '2026-02-21 11:05', seller: 'TechStore DE' },
  { id: '3', orderId: '12-09876-54323', buyer: 'peter.k***@gmx.de', status: 'pending', total: 69.99, items: 1, trackingNumber: null, trackingPushed: false, createdAt: '2026-02-21 09:18', seller: 'GadgetWorld' },
  { id: '4', orderId: '12-09876-54324', buyer: 'lisa.w***@yahoo.com', status: 'delivered', total: 34.99, items: 1, trackingNumber: 'DHL-87654321', trackingPushed: true, createdAt: '2026-02-20 16:42', seller: 'TechStore DE' },
  { id: '5', orderId: '12-09876-54325', buyer: 'tom.h***@outlook.de', status: 'shipped', total: 89.98, items: 3, trackingNumber: 'DPD-11223344', trackingPushed: false, createdAt: '2026-02-20 13:55', seller: 'AudioPro' },
  { id: '6', orderId: '12-09876-54326', buyer: 'sarah.b***@icloud.com', status: 'cancelled', total: 24.99, items: 1, trackingNumber: null, trackingPushed: false, createdAt: '2026-02-19 20:11', seller: 'GadgetWorld' },
];

export const mockLogs: LogEntry[] = [
  { id: '1', level: 'error', category: 'Auth', message: 'Token refresh failed for seller GadgetWorld – invalid_grant', seller: 'GadgetWorld', timestamp: '2026-02-21 14:45:12' },
  { id: '2', level: 'warning', category: 'RateLimit', message: 'API rate limit at 85% – throttling requests', seller: 'TechStore DE', timestamp: '2026-02-21 14:30:00' },
  { id: '3', level: 'error', category: 'Validation', message: 'SKU AMZ-B0BSHF7WHH-001 – category_id missing for marketplace EBAY_DE', seller: 'GadgetWorld', timestamp: '2026-02-21 14:22:33' },
  { id: '4', level: 'info', category: 'Sync', message: 'Price sync completed – 1247 listings checked, 12 updated', seller: 'TechStore DE', timestamp: '2026-02-21 14:15:00' },
  { id: '5', level: 'warning', category: 'Stock', message: 'SKU AMZ-B07XJ8C8F5-001 stock = 0, offer paused', seller: 'TechStore DE', timestamp: '2026-02-21 14:10:45' },
  { id: '6', level: 'error', category: 'Network', message: 'eBay API timeout after 30s – sell.inventory endpoint', seller: 'AudioPro', timestamp: '2026-02-21 13:58:20' },
  { id: '7', level: 'info', category: 'Orders', message: 'Order sync completed – 6 new orders fetched', seller: 'All', timestamp: '2026-02-21 13:55:00' },
  { id: '8', level: 'error', category: 'Tracking', message: 'Tracking push failed for order 12-09876-54325 – carrier not recognized', seller: 'AudioPro', timestamp: '2026-02-21 13:50:11' },
  { id: '9', level: 'info', category: 'Listing', message: 'Published 3 new listings successfully', seller: 'TechStore DE', timestamp: '2026-02-21 13:45:00' },
  { id: '10', level: 'warning', category: 'RateLimit', message: 'Approaching daily API call limit – 4,200/5,000 used', seller: 'All', timestamp: '2026-02-21 13:30:00' },
];
