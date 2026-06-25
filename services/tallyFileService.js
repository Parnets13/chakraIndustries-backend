import fs from 'fs/promises';
import path from 'path';
import ItemMaster from '../models/ItemMaster.js';
import AccountsLedger from '../models/AccountsLedger.js';
import Vendor from '../models/Vendor.js';
import Client from '../models/Client.js';
import Invoice from '../models/Invoice.js';
import TallyVoucher from '../models/TallyVoucher.js';
import TallyConfig from '../models/TallyConfig.js';
import TallySyncLog from '../models/TallySyncLog.js';

const EXPORT_DIR = 'C:\\TallyExport';

function decodeXmlEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractGuid(block) {
  const m = block.match(/<GUID>([\s\S]*?)<\/GUID>/i);
  return m ? m[1].trim() : null;
}

function extractAlterId(block) {
  const m = block.match(/<ALTERID[^>]*>([\s\S]*?)<\/ALTERID>/i);
  return m ? m[1].trim() : null;
}

function parseStockItems(xml) {
  const items = [];
  const patterns = [
    /<STOCKITEM([^>]*)>([\s\S]*?)<\/STOCKITEM>/gi,
    /<STOCKITEM\.LIST>([\s\S]*?)<\/STOCKITEM\.LIST>/gi,
    /<STOCKITEMS\.LIST>([\s\S]*?)<\/STOCKITEMS\.LIST>/gi
  ];

  for (const pattern of patterns) {
    const matches = [...xml.matchAll(pattern)];
    if (matches.length > 0) {
      for (const m of matches) {
        let attrs, block;
        if (m.length === 3) {
          attrs = m[1];
          block = m[2];
        } else {
          block = m[1];
          attrs = '';
        }

        let name = '';
        const nameAttrMatch = attrs.match(/NAME="([^"]*)"/i);
        if (nameAttrMatch) name = decodeXmlEntities(nameAttrMatch[1].trim());
        if (!name) {
          const langMatch = block.match(/<LANGUAGENAME\.LIST>[\s\S]*?<NAME\.LIST[\s\S]*?<NAME>([\s\S]*?)<\/NAME>/i);
          if (langMatch) name = decodeXmlEntities(langMatch[1].trim());
        }
        if (!name) {
          const itemNameMatch = block.match(/<STOCKITEMNAME>([\s\S]*?)<\/STOCKITEMNAME>/i);
          if (itemNameMatch) name = decodeXmlEntities(itemNameMatch[1].trim());
        }
        if (!name) continue;

        const guid = extractGuid(block);
        const alterId = extractAlterId(block);
        const hsn = (block.match(/<HSNCODE>([\s\S]*?)<\/HSNCODE>/i)?.[1] || '').trim();
        const gst = parseFloat(block.match(/<GSTRATE>([\s\S]*?)<\/GSTRATE>/i)?.[1]) || 0;
        const unit = (block.match(/<BASEUNITS>([\s\S]*?)<\/BASEUNITS>/i)?.[1] || 'Nos').trim();
        const cost = parseFloat(block.match(/<STANDARDCOST>([\s\S]*?)<\/STANDARDCOST>/i)?.[1]) || 0;
        items.push({ name, guid, alterId, hsn, gst, unit, cost });
      }
      if (items.length > 0) break;
    }
  }
  return items;
}

function parseTallyAddress(block) {
  const lines = [...block.matchAll(/<ADDRESS>([\s\S]*?)<\/ADDRESS>/gi)]
    .map(m => decodeXmlEntities(m[1].trim()))
    .filter(Boolean);
  const city = decodeXmlEntities((block.match(/<LEDGERCITY>([\s\S]*?)<\/LEDGERCITY>/i)?.[1] || '').trim());
  const state = decodeXmlEntities((block.match(/<STATENAME>([\s\S]*?)<\/STATENAME>/i)?.[1] || block.match(/<LEDGERSTATE>([\s\S]*?)<\/LEDGERSTATE>/i)?.[1] || '').trim());
  const pincode = decodeXmlEntities((block.match(/<PINCODE>([\s\S]*?)<\/PINCODE>/i)?.[1] || block.match(/<LEDGERPINCODE>([\s\S]*?)<\/LEDGERPINCODE>/i)?.[1] || '').trim());
  const country = decodeXmlEntities((block.match(/<COUNTRYNAME>([\s\S]*?)<\/COUNTRYNAME>/i)?.[1] || '').trim());

  const streetLines = lines.slice(0, 2);
  const street = streetLines.join(', ');
  let derivedCity = city;
  let derivedState = state;
  let derivedPincode = pincode;

  if (!derivedCity || !derivedState) {
    for (const line of lines) {
      const pinMatch = line.match(/\b(\d{6})\b/);
      if (pinMatch) {
        if (!derivedPincode) derivedPincode = pinMatch[1];
        const withoutPin = line.replace(pinMatch[0], '').replace(/[-,\s]+$/, '').trim();
        const parts = withoutPin.split(/[-,]/).map(p => p.trim()).filter(Boolean);
        if (!derivedCity && parts[0]) derivedCity = parts[0];
        if (!derivedState && parts[1]) derivedState = parts[1];
        break;
      }
    }
  }

  return { address: street || lines.join(', '), city: derivedCity, state: derivedState, pincode: derivedPincode.replace(/\D/g, '').slice(0, 6) || '', country: country || 'India' };
}

function parseLedgers(xml) {
  const ledgers = [];
  const matches = [...xml.matchAll(/<LEDGER([^>]*)>([\s\S]*?)<\/LEDGER>/gi)];
  for (const m of matches) {
    const attrs = m[1];
    const block = m[2] || '';
    let name = '';
    const nameAttrMatch = attrs.match(/NAME="([^"]*)"/i);
    if (nameAttrMatch) name = decodeXmlEntities(nameAttrMatch[1].trim());
    if (!name) {
      const langMatch = block.match(/<LANGUAGENAME\.LIST>[\s\S]*?<NAME\.LIST[\s\S]*?<NAME>([\s\S]*?)<\/NAME>/i);
      if (langMatch) name = decodeXmlEntities(langMatch[1].trim());
    }
    if (!name) {
      const gstNameMatch = block.match(/<LEDGSTNAME>([\s\S]*?)<\/LEDGSTNAME>/i);
      if (gstNameMatch) name = decodeXmlEntities(gstNameMatch[1].trim());
    }
    if (!name) {
      const mailMatch = block.match(/<MAILINGNAME>([\s\S]*?)<\/MAILINGNAME>/i);
      if (mailMatch) name = decodeXmlEntities(mailMatch[1].trim());
    }
    if (!name) continue;
    const parent = decodeXmlEntities((block.match(/<PARENT>([\s\S]*?)<\/PARENT>/i)?.[1] || '').trim());
    if (!parent.toLowerCase().includes('sundry')) continue;
    const guid = extractGuid(block);
    const alterId = extractAlterId(block);
    const gstNumber = decodeXmlEntities((block.match(/<PARTYGSTIN>([\s\S]*?)<\/PARTYGSTIN>/i)?.[1] || block.match(/<GSTIN>([\s\S]*?)<\/GSTIN>/i)?.[1] || 'N/A').trim());
    const openingBalance = parseFloat(block.match(/<OPENINGBALANCE>([\s\S]*?)<\/OPENINGBALANCE>/i)?.[1]) || 0;
    // Try multiple email fields
    const email = decodeXmlEntities((
      block.match(/<EMAIL>([\s\S]*?)<\/EMAIL>/i)?.[1] ||
      block.match(/<LEDGEREMAIL>([\s\S]*?)<\/LEDGEREMAIL>/i)?.[1] ||
      block.match(/<MAILINGEMAIL>([\s\S]*?)<\/MAILINGEMAIL>/i)?.[1] ||
      ''
    ).trim());
    // Try multiple phone number fields!
    const phone = decodeXmlEntities((
      block.match(/<LEDGERMOBILE>([\s\S]*?)<\/LEDGERMOBILE>/i)?.[1] ||
      block.match(/<MOBILE>([\s\S]*?)<\/MOBILE>/i)?.[1] ||
      block.match(/<MOBILENO>([\s\S]*?)<\/MOBILENO>/i)?.[1] ||
      block.match(/<TELEPHONE>([\s\S]*?)<\/TELEPHONE>/i)?.[1] ||
      block.match(/<PHONE>([\s\S]*?)<\/PHONE>/i)?.[1] ||
      block.match(/<PHONENO>([\s\S]*?)<\/PHONENO>/i)?.[1] ||
      block.match(/<CONTACT>([\s\S]*?)<\/CONTACT>/i)?.[1] ||
      ''
    ).trim());
    const contactPerson = decodeXmlEntities((
      block.match(/<MAILINGNAME>([\s\S]*?)<\/MAILINGNAME>/i)?.[1] ||
      block.match(/<CONTACTPERSON>([\s\S]*?)<\/CONTACTPERSON>/i)?.[1] ||
      block.match(/<PERSON>([\s\S]*?)<\/PERSON>/i)?.[1] ||
      ''
    ).trim());
    const isCreditor = parent.toLowerCase().includes('creditor');
    const addrInfo = parseTallyAddress(block);
    ledgers.push({ 
      name, 
      guid, 
      alterId, 
      gstNumber, 
      openingBalance, 
      email, 
      phone, 
      contactPerson, 
      isCreditor,
      // Use state from addrInfo!
      state: addrInfo.state,
      ...addrInfo 
    });
  }
  return ledgers;
}

function normaliseTallyPhone(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.length === 10 ? digits : '';
}

function ledgersToOps(ledgers) {
  const ledgerOps = [], vendorOps = [], clientOps = [];
  for (const l of ledgers) {
    const { name, guid, alterId, gstNumber, openingBalance, email, phone, contactPerson, isCreditor, address, city, state, pincode, country } = l;
    const ledgerGroup = isCreditor ? 'Sundry Creditors' : 'Sundry Debtors';
    const ledgerCode = guid ? `TALLY-${guid.replace(/[^A-Z0-9]/gi, '').slice(0, 20)}` : `TALLY-${name.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 30)}-${Math.random().toString(36).substring(2, 8)}`;
    const lFilter = guid ? { tallyGuid: guid } : { ledgerName: name };
    const cleanPhone = normaliseTallyPhone(phone);
    const rawDigits = phone ? String(phone).replace(/\D/g, '').slice(0, 15) : '';
    const safePhone = cleanPhone || rawDigits || '0000000000';
    const safeEmail = email || `${name.replace(/\s+/g, '').toLowerCase().slice(0, 30)}@tally.sync`;

    ledgerOps.push({
      updateOne: {
        filter: lFilter,
        update: {
          $set: {
            ledgerGroup, gstNumber, openingBalance,
            syncedWithTally: true, lastTallySync: new Date(),
            ...(email ? { email } : {}),
            ...(cleanPhone ? { phone: cleanPhone } : (rawDigits ? { phone: rawDigits } : {})),
            ...(address ? { 'address.street': address } : {}),
            ...(city ? { 'address.city': city } : {}),
            ...(state ? { 'address.state': state } : {}),
            ...(pincode ? { 'address.pincode': pincode } : {}),
            ...(country ? { 'address.country': country } : {}),
            ...(guid ? { tallyGuid: guid } : {}),
            ...(alterId ? { tallyAlterId: alterId } : {})
          },
          $setOnInsert: { ledgerCode, ledgerName: name, contactPerson: contactPerson || name, panNumber: 'N/A', isActive: true }
        },
        upsert: true
      }
    });

    if (isCreditor) {
      vendorOps.push({
        updateOne: {
          filter: guid ? { tallyGuid: guid } : { companyName: name },
          update: {
            $set: {
              tallySynced: true, lastTallySync: new Date(), phone: safePhone, email: safeEmail, contactPerson: contactPerson || name,
              address: address || 'Imported from Tally',
              ...(city ? { city } : {}),
              ...(state ? { state } : {}),
              pincode: pincode || '000000',
              ...(gstNumber && gstNumber !== 'N/A' ? { gstNumber } : {}),
              ...(guid ? { tallyGuid: guid } : {}),
              ...(alterId ? { tallyAlterId: alterId } : {})
            },
            $setOnInsert: {
              vendorId: guid ? `VND-TALLY-${guid.replace(/[^A-Z0-9]/gi, '').slice(0, 20)}` : `VND-TALLY-${name.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 30)}-${Math.random().toString(36).substring(2, 8)}`,
              companyName: name, category: 'General', status: 'Active'
            }
          },
          upsert: true
        }
      });
    } else {
      clientOps.push({
        updateOne: {
          filter: guid ? { tallyGuid: guid } : { name },
          update: {
            $set: {
              tallySynced: true, lastTallySync: new Date(), phone: safePhone, email: safeEmail, contact: contactPerson || name,
              address: address || 'Imported from Tally',
              ...(city ? { city } : {}),
              ...(state ? { state } : {}),
              pincode: pincode || '000000',
              ...(gstNumber && gstNumber !== 'N/A' ? { gstNumber } : {}),
              ...(guid ? { tallyGuid: guid } : {}),
              ...(alterId ? { tallyAlterId: alterId } : {})
            },
            $setOnInsert: {
              clientId: guid ? `CLT-TALLY-${guid.replace(/[^A-Z0-9]/gi, '').slice(0, 20)}` : `CLT-TALLY-${name.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 30)}-${Math.random().toString(36).substring(2, 8)}`,
              name, category: 'Trading', status: 'Active'
            }
          },
          upsert: true
        }
      });
    }
  }
  return { ledgerOps, vendorOps, clientOps };
}

function parseVouchers(xml, voucherType) {
  const vouchers = [];
  const typePattern = new RegExp(`<VOUCHER[^>]*>([\\s\\S]*?)<\\/VOUCHER>`, 'gi');
  for (const m of xml.matchAll(typePattern)) {
    const block = m[1];
    const vt = (block.match(/<VOUCHERTYPENAME>([\s\S]*?)<\/VOUCHERTYPENAME>/i)?.[1] || '').trim();
    if (voucherType && vt.toLowerCase() !== voucherType.toLowerCase()) continue;

    const guid = extractGuid(block);
    const alterId = extractAlterId(block);
    const voucherNo = (block.match(/<VOUCHERNUMBER>([\s\S]*?)<\/VOUCHERNUMBER>/i)?.[1] || '').trim();
    const partyName = (block.match(/<PARTYLEDGERNAME>([\s\S]*?)<\/PARTYLEDGERNAME>/i)?.[1] || '').trim();
    const rawDate = (block.match(/<DATE>([\s\S]*?)<\/DATE>/i)?.[1] || '').trim();
    const amount = Math.abs(parseFloat(block.match(/<AMOUNT>([\s\S]*?)<\/AMOUNT>/i)?.[1]) || 0);
    const narration = (block.match(/<NARRATION>([\s\S]*?)<\/NARRATION>/i)?.[1] || '').trim();
    const vDate = rawDate.length === 8 ? new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`) : new Date();

    const ledgerEntries = [];
    for (const le of block.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/gi)) {
      const lb = le[1];
      const lName = (lb.match(/<LEDGERNAME>([\s\S]*?)<\/LEDGERNAME>/i)?.[1] || '').trim();
      const lAmt = parseFloat(lb.match(/<AMOUNT>([\s\S]*?)<\/AMOUNT>/i)?.[1]) || 0;
      const isDmd = (lb.match(/<ISDEEMEDPOSITIVE>([\s\S]*?)<\/ISDEEMEDPOSITIVE>/i)?.[1] || 'No').trim() === 'Yes';
      if (lName) ledgerEntries.push({ ledgerName: lName, amount: lAmt, isDeemed: isDmd });
    }

    vouchers.push({ guid, alterId, voucherNo, voucherType: vt || voucherType, partyName, amount, narration, vDate, ledgerEntries });
  }
  return vouchers;
}

function vouchersToInvoiceOps(vouchers) {
  return vouchers.map(v => {
    const filter = v.guid ? { tallyGuid: v.guid } : { invoiceNo: v.voucherNo };
    return {
      updateOne: {
        filter,
        update: {
          $set: {
            partyName: v.partyName, grandTotal: v.amount,
            ...(v.guid ? { tallyGuid: v.guid } : {}),
            ...(v.alterId ? { tallyAlterId: v.alterId } : {})
          },
          $setOnInsert: {
            invoiceNo: v.voucherNo, partyName: v.partyName, invoiceDate: v.vDate,
            grandTotal: v.amount, source: 'manual', status: 'Sent', invoiceType: 'single', items: []
          }
        },
        upsert: true
      }
    };
  });
}

function vouchersToTallyVoucherOps(vouchers) {
  return vouchers.map(v => {
    const filter = v.guid ? { tallyGuid: v.guid } : (v.voucherNo ? { voucherNumber: v.voucherNo, voucherType: v.voucherType } : null);
    if (!filter) return null;
    return {
      updateOne: {
        filter,
        update: {
          $set: {
            partyName: v.partyName, amount: v.amount, narration: v.narration,
            voucherDate: v.vDate, ledgerEntries: v.ledgerEntries, source: 'Tally', syncedAt: new Date(),
            ...(v.guid ? { tallyGuid: v.guid } : {}),
            ...(v.alterId ? { tallyAlterId: v.alterId } : {})
          },
          $setOnInsert: {
            voucherType: v.voucherType,
            voucherNumber: v.voucherNo || `TALLY-${Date.now()}`
          }
        },
        upsert: true
      }
    };
  }).filter(Boolean);
}

export async function importFromFiles() {
  const syncId = `FILE-IMPORT-${Date.now()}`;
  const start = Date.now();
  let totalRecords = 0;

  try {
    await fs.mkdir(EXPORT_DIR, { recursive: true });

    // Process Items
    const itemsPath = path.join(EXPORT_DIR, 'items.xml');
    try {
      const itemsXml = await fs.readFile(itemsPath, 'utf8');
      const parsedItems = parseStockItems(itemsXml);
      const ops = parsedItems.map(({ name, guid, alterId, hsn, gst, unit, cost }) => {
        const UNIT_MAP = { Nos: 'units', Kg: 'kg', Ltr: 'liter', Mtr: 'meter', Box: 'box', Pcs: 'piece' };
        const cleanGuid = guid ? guid.replace(/[^A-Z0-9]/gi, '') : null;
        const sku = cleanGuid ? `TALLY-${cleanGuid}` : name.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 30);
        const itemId = cleanGuid ? `TALLY-${cleanGuid}` : `TALLY-${sku}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
        return {
          updateOne: {
            filter: guid ? { tallyGuid: guid } : { name },
            update: {
              $set: {
                itemId, sku,
                hsn, gst, unit: UNIT_MAP[unit] || 'units', costPrice: cost, unitPrice: cost,
                tallySynced: true, lastTallySync: new Date(),
                ...(guid ? { tallyGuid: guid } : {}),
                ...(alterId ? { tallyAlterId: alterId } : {})
              },
              $setOnInsert: { name, sellingPrice: cost, isActive: true }
            },
            upsert: true
          }
        };
      });
      if (ops.length) {
        const r = await ItemMaster.bulkWrite(ops, { ordered: false });
        totalRecords += (r.upsertedCount || 0) + (r.modifiedCount || 0);
      }
    } catch (e) {
      console.log('Items file not found or error reading:', e.message);
    }

    // Process Ledgers
    const ledgersPath = path.join(EXPORT_DIR, 'ledgers.xml');
    try {
      const ledgersXml = await fs.readFile(ledgersPath, 'utf8');
      const parsedLedgers = parseLedgers(ledgersXml);
      const ops = ledgersToOps(parsedLedgers);
      const results = await Promise.all([
        ops.ledgerOps.length ? AccountsLedger.bulkWrite(ops.ledgerOps, { ordered: false }).catch(() => null) : null,
        ops.vendorOps.length ? Vendor.bulkWrite(ops.vendorOps, { ordered: false }).catch(() => null) : null,
        ops.clientOps.length ? Client.bulkWrite(ops.clientOps, { ordered: false }).catch(() => null) : null
      ]);
      totalRecords += results.reduce((s, r) => s + (r ? (r.upsertedCount || 0) + (r.modifiedCount || 0) : 0), 0);
    } catch (e) {
      console.log('Ledgers file not found or error reading:', e.message);
    }

    // Process Vouchers
    const vouchersPath = path.join(EXPORT_DIR, 'vouchers.xml');
    try {
      const vouchersXml = await fs.readFile(vouchersPath, 'utf8');
      const parsedVouchers = parseVouchers(vouchersXml, null);
      const salesPur = parsedVouchers.filter(v => ['Sales', 'Purchase'].includes(v.voucherType));
      const payRec = parsedVouchers.filter(v => ['Payment', 'Receipt', 'Journal', 'Contra'].includes(v.voucherType));
      const ops1 = vouchersToInvoiceOps(salesPur);
      const ops2 = vouchersToTallyVoucherOps(payRec);
      if (ops1.length) {
        const r1 = await Invoice.bulkWrite(ops1, { ordered: false });
        totalRecords += (r1.upsertedCount || 0) + (r1.modifiedCount || 0);
      }
      if (ops2.length) {
        const r2 = await TallyVoucher.bulkWrite(ops2, { ordered: false });
        totalRecords += (r2.upsertedCount || 0) + (r2.modifiedCount || 0);
      }
    } catch (e) {
      console.log('Vouchers file not found or error reading:', e.message);
    }

    const duration = `${((Date.now() - start)/1000).toFixed(1)}s`;
    await TallySyncLog.create({
      syncId,
      type: 'File Import',
      entity: '',
      direction: 'Tally → ERP',
      status: 'Success',
      duration,
      records: totalRecords
    });
    await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date(), lastImportAt: new Date() }, { upsert: true });

    return { ok: true, records: totalRecords };
  } catch (e) {
    const duration = `${((Date.now() - start)/1000).toFixed(1)}s`;
    await TallySyncLog.create({
      syncId,
      type: 'File Import',
      entity: '',
      direction: 'Tally → ERP',
      status: 'Failed',
      duration,
      error: e.message,
      records: 0
    }).catch(() => {});
    return { ok: false, records: 0, error: e.message };
  }
}
