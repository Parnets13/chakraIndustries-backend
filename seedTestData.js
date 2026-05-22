/**
 * seedTestData.js
 * Seeds test Vendors, Warehouse, Inventory stock, and Purchase Orders
 * so the PO Generator → Stock Verify → Invoice flow can be fully tested.
 *
 * Run: node seedTestData.js
 */

import dotenv from 'dotenv';
import connectDB from './config/database.js';
import Vendor from './models/Vendor.js';
import Warehouse from './models/Warehouse.js';
import Inventory from './models/Inventory.js';
import PurchaseOrder from './models/PurchaseOrder.js';

dotenv.config();

// ─── Test Vendors ─────────────────────────────────────────────────────────────
const TEST_VENDORS = [
  {
    vendorId:      'VND-TEST-001',
    companyName:   'TechSupply Pvt Ltd',
    category:      'Electronics',
    contactPerson: 'Arjun Mehta',
    phone:         '9876543210',
    email:         'arjun@techsupply.in',
    address:       '12, Industrial Area, Phase 2',
    city:          'Bangalore',
    state:         'Karnataka',
    pincode:       '560058',
    gstNumber:     '29ABCDE1234F1Z5',
    paymentTerms:  'Net 30',
    status:        'Active',
    rating:        4,
  },
  {
    vendorId:      'VND-TEST-002',
    companyName:   'Bharat Components Ltd',
    category:      'Hardware',
    contactPerson: 'Sunita Rao',
    phone:         '9123456780',
    email:         'sunita@bharatcomp.in',
    address:       '45, MIDC, Andheri East',
    city:          'Mumbai',
    state:         'Maharashtra',
    pincode:       '400093',
    gstNumber:     '27FGHIJ5678K2L6',
    paymentTerms:  'Net 45',
    status:        'Active',
    rating:        3,
  },
  {
    vendorId:      'VND-TEST-003',
    companyName:   'Precision Parts Co',
    category:      'Manufacturing',
    contactPerson: 'Vikram Singh',
    phone:         '9988776655',
    email:         'vikram@precisionparts.in',
    address:       '78, Sector 18, Noida',
    city:          'Noida',
    state:         'Uttar Pradesh',
    pincode:       '201301',
    gstNumber:     '09KLMNO9012P3Q7',
    paymentTerms:  'Net 60',
    status:        'Active',
    rating:        5,
  },
];

// ─── Test Warehouse ───────────────────────────────────────────────────────────
const TEST_WAREHOUSE = {
  warehouseId: 'WH-TEST-01',
  name:        'Main Test Warehouse',
  location:    'Bangalore',
  manager:     'Ravi Kumar',
  capacity:    10000,
  phone:       '9000000001',
  address:     '#13/14, Mysore Road, Nayandahalli, Bangalore - 560039',
  type:        'Finished Goods',
  status:      'Active',
};

// ─── Test Inventory Items ─────────────────────────────────────────────────────
// Mix of: fully stocked, partially stocked, out of stock
const TEST_INVENTORY = [
  // Fully stocked (PO will be fully fulfilled)
  { sku: 'SKU-LAPTOP-001',  name: 'Laptop Dell Inspiron 15',  totalQuantity: 10, reservedQuantity: 0, minQuantity: 2, unit: 'Nos', unitPrice: 55000 },
  { sku: 'SKU-MOUSE-001',   name: 'Wireless Mouse Logitech',  totalQuantity: 50, reservedQuantity: 5, minQuantity: 10, unit: 'Nos', unitPrice: 1200 },
  { sku: 'SKU-KB-001',      name: 'Mechanical Keyboard',      totalQuantity: 30, reservedQuantity: 0, minQuantity: 5, unit: 'Nos', unitPrice: 3500 },

  // Partially stocked (PO will be partially fulfilled → partial invoice)
  { sku: 'SKU-MONITOR-001', name: 'Monitor 24 inch FHD',      totalQuantity: 2,  reservedQuantity: 0, minQuantity: 3, unit: 'Nos', unitPrice: 18000 },
  { sku: 'SKU-HDMI-001',    name: 'HDMI Cable 2m',            totalQuantity: 8,  reservedQuantity: 2, minQuantity: 5, unit: 'Nos', unitPrice: 450 },
  { sku: 'SKU-USB-001',     name: 'USB Hub 4 Port',           totalQuantity: 3,  reservedQuantity: 1, minQuantity: 5, unit: 'Nos', unitPrice: 850 },

  // Out of stock (invoice will be on hold for these)
  { sku: 'SKU-WEBCAM-001',  name: 'Webcam HD 1080p',          totalQuantity: 0,  reservedQuantity: 0, minQuantity: 5, unit: 'Nos', unitPrice: 2800 },
  { sku: 'SKU-HEADSET-001', name: 'Headset Noise Cancelling', totalQuantity: 0,  reservedQuantity: 0, minQuantity: 3, unit: 'Nos', unitPrice: 4500 },
];

// ─── Test Purchase Orders ─────────────────────────────────────────────────────
// Will be created after vendors are inserted (need vendor _id)
function buildTestPOs(vendors) {
  const v1 = vendors[0]; // TechSupply
  const v2 = vendors[1]; // Bharat Components
  const v3 = vendors[2]; // Precision Parts

  return [
    // PO 1 — All items fully stocked → Full Invoice possible
    {
      poId:         'PO-TEST-2025-001',
      vendor:       v1._id,
      items: [
        { name: 'Laptop Dell Inspiron 15', qty: 3, unit: 'Nos', basePrice: 55000, gst: 18, total: 3 * 55000 * 1.18 },
        { name: 'Wireless Mouse Logitech', qty: 5, unit: 'Nos', basePrice: 1200,  gst: 18, total: 5 * 1200 * 1.18 },
        { name: 'Mechanical Keyboard',     qty: 4, unit: 'Nos', basePrice: 3500,  gst: 18, total: 4 * 3500 * 1.18 },
      ],
      get subtotal()   { return this.items.reduce((s, i) => s + i.qty * i.basePrice, 0); },
      get gstTotal()   { return this.items.reduce((s, i) => s + i.qty * i.basePrice * i.gst / 100, 0); },
      get grandTotal() { return this.subtotal + this.gstTotal; },
      deliveryDate:  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status:        'Approved',
      paymentTerms:  'Net 30',
      remarks:       'Test PO — Full stock available. Should generate FULL invoice.',
    },

    // PO 2 — Mix: some items stocked, some partial → Partial Invoice
    {
      poId:         'PO-TEST-2025-002',
      vendor:       v2._id,
      items: [
        { name: 'Monitor 24 inch FHD', qty: 5, unit: 'Nos', basePrice: 18000, gst: 18, total: 5 * 18000 * 1.18 },
        { name: 'HDMI Cable 2m',       qty: 10, unit: 'Nos', basePrice: 450,  gst: 18, total: 10 * 450 * 1.18 },
        { name: 'USB Hub 4 Port',      qty: 8,  unit: 'Nos', basePrice: 850,  gst: 18, total: 8 * 850 * 1.18 },
      ],
      get subtotal()   { return this.items.reduce((s, i) => s + i.qty * i.basePrice, 0); },
      get gstTotal()   { return this.items.reduce((s, i) => s + i.qty * i.basePrice * i.gst / 100, 0); },
      get grandTotal() { return this.subtotal + this.gstTotal; },
      deliveryDate:  new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      status:        'Approved',
      paymentTerms:  'Net 45',
      remarks:       'Test PO — Partial stock. Monitor: 2 of 5 available. HDMI: 6 of 10. USB: 2 of 8. Should generate PARTIAL invoice.',
    },

    // PO 3 — All items out of stock → Invoice on hold
    {
      poId:         'PO-TEST-2025-003',
      vendor:       v3._id,
      items: [
        { name: 'Webcam HD 1080p',          qty: 3, unit: 'Nos', basePrice: 2800, gst: 18, total: 3 * 2800 * 1.18 },
        { name: 'Headset Noise Cancelling', qty: 2, unit: 'Nos', basePrice: 4500, gst: 18, total: 2 * 4500 * 1.18 },
      ],
      get subtotal()   { return this.items.reduce((s, i) => s + i.qty * i.basePrice, 0); },
      get gstTotal()   { return this.items.reduce((s, i) => s + i.qty * i.basePrice * i.gst / 100, 0); },
      get grandTotal() { return this.subtotal + this.gstTotal; },
      deliveryDate:  new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
      status:        'Approved',
      paymentTerms:  'Net 60',
      remarks:       'Test PO — Zero stock for all items. Invoice should be ON HOLD.',
    },

    // PO 4 — Single item, partial stock → Simple partial invoice test
    {
      poId:         'PO-TEST-2025-004',
      vendor:       v1._id,
      items: [
        { name: 'Laptop Dell Inspiron 15', qty: 15, unit: 'Nos', basePrice: 55000, gst: 18, total: 15 * 55000 * 1.18 },
      ],
      get subtotal()   { return this.items.reduce((s, i) => s + i.qty * i.basePrice, 0); },
      get gstTotal()   { return this.items.reduce((s, i) => s + i.qty * i.basePrice * i.gst / 100, 0); },
      get grandTotal() { return this.subtotal + this.gstTotal; },
      deliveryDate:  new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      status:        'Approved',
      paymentTerms:  'Net 30',
      remarks:       'Test PO — Requested 15 Laptops, only 10 in stock. Classic partial invoice scenario.',
    },

    // PO 5 — Draft status (should still appear in PO list)
    {
      poId:         'PO-TEST-2025-005',
      vendor:       v2._id,
      items: [
        { name: 'Wireless Mouse Logitech', qty: 20, unit: 'Nos', basePrice: 1200, gst: 18, total: 20 * 1200 * 1.18 },
        { name: 'Mechanical Keyboard',     qty: 10, unit: 'Nos', basePrice: 3500, gst: 18, total: 10 * 3500 * 1.18 },
      ],
      get subtotal()   { return this.items.reduce((s, i) => s + i.qty * i.basePrice, 0); },
      get gstTotal()   { return this.items.reduce((s, i) => s + i.qty * i.basePrice * i.gst / 100, 0); },
      get grandTotal() { return this.subtotal + this.gstTotal; },
      deliveryDate:  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status:        'Draft',
      paymentTerms:  'Net 45',
      remarks:       'Test PO — Draft status. Full stock available.',
    },
  ];
}

// ─── Main Seed Function ───────────────────────────────────────────────────────
async function seedTestData() {
  await connectDB();
  console.log('\n🌱 Starting test data seed...\n');

  // 1. Vendors
  console.log('── Vendors ──────────────────────────────');
  const insertedVendors = [];
  for (const v of TEST_VENDORS) {
    const existing = await Vendor.findOne({ vendorId: v.vendorId });
    if (existing) {
      console.log(`⏭  Vendor exists: ${v.companyName}`);
      insertedVendors.push(existing);
    } else {
      const created = await Vendor.create(v);
      console.log(`✅ Created vendor: ${v.companyName} (${v.vendorId})`);
      insertedVendors.push(created);
    }
  }

  // 2. Warehouse
  console.log('\n── Warehouse ────────────────────────────');
  let warehouse = await Warehouse.findOne({ warehouseId: TEST_WAREHOUSE.warehouseId });
  if (warehouse) {
    console.log(`⏭  Warehouse exists: ${warehouse.name}`);
  } else {
    warehouse = await Warehouse.create(TEST_WAREHOUSE);
    console.log(`✅ Created warehouse: ${warehouse.name}`);
  }

  // 3. Inventory
  console.log('\n── Inventory Stock ──────────────────────');
  for (const item of TEST_INVENTORY) {
    const existing = await Inventory.findOne({ sku: item.sku, warehouse: warehouse._id });
    if (existing) {
      // Update quantities for re-seeding
      existing.totalQuantity    = item.totalQuantity;
      existing.reservedQuantity = item.reservedQuantity;
      existing.unitPrice        = item.unitPrice;
      await existing.save();
      console.log(`🔄 Updated stock: ${item.name} → ${existing.availableQuantity} available`);
    } else {
      const created = await Inventory.create({
        ...item,
        warehouse:  warehouse._id,
        status:     'Active',
        totalValue: item.totalQuantity * item.unitPrice,
      });
      console.log(`✅ Created stock: ${item.name} → ${created.availableQuantity} available`);
    }
  }

  // 4. Purchase Orders
  console.log('\n── Purchase Orders ──────────────────────');
  const poData = buildTestPOs(insertedVendors);
  for (const po of poData) {
    const existing = await PurchaseOrder.findOne({ poId: po.poId });
    if (existing) {
      console.log(`⏭  PO exists: ${po.poId}`);
    } else {
      // Resolve getters to plain values
      const subtotal   = po.subtotal;
      const gstTotal   = po.gstTotal;
      const grandTotal = po.grandTotal;
      await PurchaseOrder.create({
        poId:         po.poId,
        vendor:       po.vendor,
        items:        po.items,
        subtotal,
        gstTotal,
        grandTotal,
        deliveryDate: po.deliveryDate,
        status:       po.status,
        paymentTerms: po.paymentTerms,
        remarks:      po.remarks,
      });
      console.log(`✅ Created PO: ${po.poId} (${po.status}) — ₹${Math.round(grandTotal).toLocaleString('en-IN')}`);
    }
  }

  // 5. Summary
  console.log('\n─────────────────────────────────────────');
  console.log('✅ Test data seed complete!\n');
  console.log('📋 Test Scenarios:');
  console.log('  PO-TEST-2025-001 → Full stock  → Should generate FULL invoice');
  console.log('  PO-TEST-2025-002 → Partial stock → Should generate PARTIAL invoice + pending orders');
  console.log('  PO-TEST-2025-003 → Zero stock  → Invoice ON HOLD (no stock)');
  console.log('  PO-TEST-2025-004 → 10 of 15 Laptops → Partial invoice for 10, pending 5');
  console.log('  PO-TEST-2025-005 → Draft PO   → Full stock available');
  console.log('\n🔗 Go to: http://localhost:5173/po-generator/upload');
  console.log('─────────────────────────────────────────\n');

  process.exit(0);
}

seedTestData().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
