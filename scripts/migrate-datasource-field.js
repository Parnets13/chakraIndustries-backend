/**
 * migrate-datasource-field.js
 *
 * One-time migration: sets the `dataSource` field on all existing records
 * across ItemMaster, Vendor, Client, CorporateClient, AccountsLedger,
 * PurchaseOrder, and Invoice collections.
 *
 * Logic:
 *   - Records with a tallyGuid (or Invoice source === 'Tally'/'tally')
 *     → dataSource = 'Tally'  (never re-export to Tally)
 *   - Everything else
 *     → dataSource = 'ERP'    (eligible for export)
 *
 * Run once after deploying the dataSource model changes:
 *   node scripts/migrate-datasource-field.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// ─── model imports ────────────────────────────────────────────────────────────
import ItemMaster    from '../models/ItemMaster.js';
import Vendor        from '../models/Vendor.js';
import Client        from '../models/Client.js';
import CorporateClient from '../models/CorporateClient.js';
import AccountsLedger from '../models/AccountsLedger.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Invoice       from '../models/Invoice.js';

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');
  console.log('');

  // ── Helper ──────────────────────────────────────────────────────────────────
  async function stamp(Model, label, tallyFilter, erpFilter) {
    const [tallyResult, erpResult] = await Promise.all([
      Model.updateMany(tallyFilter, { $set: { dataSource: 'Tally' } }),
      Model.updateMany(erpFilter,   { $set: { dataSource: 'ERP'   } }),
    ]);
    console.log(`${label}:`);
    console.log(`  → Tally : ${tallyResult.modifiedCount} records marked as dataSource='Tally'`);
    console.log(`  → ERP   : ${erpResult.modifiedCount}   records marked as dataSource='ERP'`);
    console.log('');
  }

  // ── ItemMaster ──────────────────────────────────────────────────────────────
  // Records with a tallyGuid were imported from Tally (SKU starts with 'TALLY-')
  await stamp(
    ItemMaster,
    'ItemMaster',
    { tallyGuid: { $exists: true, $ne: null, $ne: '' } },
    { $or: [ { tallyGuid: { $exists: false } }, { tallyGuid: null }, { tallyGuid: '' } ] }
  );

  // ── Vendor ──────────────────────────────────────────────────────────────────
  await stamp(
    Vendor,
    'Vendor',
    { tallyGuid: { $exists: true, $ne: null, $ne: '' } },
    { $or: [ { tallyGuid: { $exists: false } }, { tallyGuid: null }, { tallyGuid: '' } ] }
  );

  // ── Client ──────────────────────────────────────────────────────────────────
  await stamp(
    Client,
    'Client',
    { tallyGuid: { $exists: true, $ne: null, $ne: '' } },
    { $or: [ { tallyGuid: { $exists: false } }, { tallyGuid: null }, { tallyGuid: '' } ] }
  );

  // ── CorporateClient ─────────────────────────────────────────────────────────
  // CorporateClient has no tallyGuid — use tallyLedgerId presence as the signal
  await stamp(
    CorporateClient,
    'CorporateClient',
    { tallyLedgerId: { $exists: true, $nin: [null, ''] } },
    { $or: [ { tallyLedgerId: { $exists: false } }, { tallyLedgerId: null }, { tallyLedgerId: '' } ] }
  );

  // ── AccountsLedger ──────────────────────────────────────────────────────────
  await stamp(
    AccountsLedger,
    'AccountsLedger',
    { $or: [
      { tallyGuid: { $exists: true, $ne: null, $ne: '' } },
      { tallyLedgerId: { $exists: true, $nin: [null, ''] } },
    ]},
    { $and: [
      { $or: [ { tallyGuid: { $exists: false } }, { tallyGuid: null }, { tallyGuid: '' } ] },
      { $or: [ { tallyLedgerId: { $exists: false } }, { tallyLedgerId: null }, { tallyLedgerId: '' } ] },
    ]}
  );

  // ── PurchaseOrder ───────────────────────────────────────────────────────────
  // POs created from Tally vouchers have a tallyGuid set
  await stamp(
    PurchaseOrder,
    'PurchaseOrder',
    { tallyGuid: { $exists: true, $ne: null, $ne: '' } },
    { $or: [ { tallyGuid: { $exists: false } }, { tallyGuid: null }, { tallyGuid: '' } ] }
  );

  // ── Invoice ─────────────────────────────────────────────────────────────────
  // Invoice already has a `source` field — 'Tally'/'tally' means imported from Tally
  await stamp(
    Invoice,
    'Invoice',
    { source: { $in: ['Tally', 'tally'] } },
    { source: { $nin: ['Tally', 'tally'] } }
  );

  // ── Summary ─────────────────────────────────────────────────────────────────
  const counts = await Promise.all([
    ItemMaster.countDocuments({ dataSource: 'Tally' }),
    ItemMaster.countDocuments({ dataSource: 'ERP' }),
    Vendor.countDocuments({ dataSource: 'Tally' }),
    Vendor.countDocuments({ dataSource: 'ERP' }),
    Client.countDocuments({ dataSource: 'Tally' }),
    Client.countDocuments({ dataSource: 'ERP' }),
    Invoice.countDocuments({ dataSource: 'Tally' }),
    Invoice.countDocuments({ dataSource: 'ERP' }),
    PurchaseOrder.countDocuments({ dataSource: 'Tally' }),
    PurchaseOrder.countDocuments({ dataSource: 'ERP' }),
  ]);

  console.log('────────────────────────────────────────────────────────');
  console.log('Migration complete. Final dataSource counts:');
  console.log('');
  console.log(`  ItemMaster      : Tally=${counts[0]}  ERP=${counts[1]}`);
  console.log(`  Vendor          : Tally=${counts[2]}  ERP=${counts[3]}`);
  console.log(`  Client          : Tally=${counts[4]}  ERP=${counts[5]}`);
  console.log(`  Invoice         : Tally=${counts[6]}  ERP=${counts[7]}`);
  console.log(`  PurchaseOrder   : Tally=${counts[8]}  ERP=${counts[9]}`);
  console.log('');
  console.log('✅ Export to Tally will now only push ERP-created records.');

  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
