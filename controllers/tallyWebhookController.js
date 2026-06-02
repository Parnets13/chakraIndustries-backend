/**
 * tallyWebhookController.js
 *
 * Receives XML pushed FROM Tally to the ERP.
 * Tally can POST to: POST http://<erp-host>/api/tally/webhook
 *
 * Supports: Stock Items, Ledgers, Sales/Purchase Vouchers, Payment/Receipt Vouchers
 * Uses GUID / AlterID for duplicate prevention.
 */

import express from 'express';
import TallyConfig from '../models/TallyConfig.js';
import TallySyncLog from '../models/TallySyncLog.js';
import TallyVoucher from '../models/TallyVoucher.js';
import ItemMaster from '../models/ItemMaster.js';
import AccountsLedger from '../models/AccountsLedger.js';
import Vendor from '../models/Vendor.js';
import Client from '../models/Client.js';
import Invoice from '../models/Invoice.js';

export const rawXmlParser = express.raw({ type: 'text/xml', limit: '10mb' });

function extractGuid(block) {
  const m = block.match(/<GUID>(.*?)<\/GUID>/i);
  return m ? m[1].trim() : null;
}
function extractAlterId(block) {
  const m = block.match(/<ALTERID[^>]*>(.*?)<\/ALTERID>/i);
  return m ? m[1].trim() : null;
}

async function writeLog({ syncId, type, direction, status, duration, error, records }) {
  try {
    await TallySyncLog.create({ syncId, type, entity: '', direction, status, duration: duration||'0s', error: error||'', records: records||0 });
  } catch (_) {}
}

export const tallyWebhook = async (req, res) => {
  const start  = Date.now();
  const syncId = `WEBHOOK-${Date.now()}`;

  try {
    const cfg = await TallyConfig.findOne();
    if (cfg?.apiKey && cfg.authType === 'API Key') {
      const secret = req.headers['x-tally-secret'] || req.headers['authorization']?.replace('Bearer ','');
      if (secret !== cfg.apiKey) return res.status(401).json({ success:false, message:'Unauthorized' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (req.body||'');
    if (!rawBody) return res.status(400).json({ success:false, message:'Empty body' });

    let records = 0;
    let type = 'Full';

    // ── Stock Items ──────────────────────────────────────────────────────────
    if (rawBody.includes('<STOCKITEM')) {
      type = 'Item Master';
      const matches = [...rawBody.matchAll(/<STOCKITEM[^>]*NAME="([^"]*)"[^>]*>([\s\S]*?)<\/STOCKITEM>/gi)];
      const ops = [];
      for (const match of matches) {
        const name = match[1]?.trim(); if (!name) continue;
        const block   = match[2];
        const guid    = extractGuid(block);
        const alterId = extractAlterId(block);
        const hsn     = (block.match(/<HSNCODE>(.*?)<\/HSNCODE>/i)?.[1]||'').trim();
        const gst     = parseFloat(block.match(/<GSTRATE>(.*?)<\/GSTRATE>/i)?.[1])||0;
        const unit    = (block.match(/<BASEUNITS>(.*?)<\/BASEUNITS>/i)?.[1]||'Nos').trim();
        const cost    = parseFloat(block.match(/<STANDARDCOST>(.*?)<\/STANDARDCOST>/i)?.[1])||0;
        const uMap    = {Nos:'units',Kg:'kg',Ltr:'liter',Mtr:'meter',Box:'box',Pcs:'piece'};
        const sku     = name.replace(/[^A-Z0-9]/gi,'-').toUpperCase().slice(0,30);
        const filter  = guid ? { tallyGuid: guid } : { name };
        ops.push({ updateOne:{
          filter,
          update:{
            $set:{ hsn, gst, unit:uMap[unit]||'units', costPrice:cost, unitPrice:cost,
                   tallySynced:true, lastTallySync:new Date(),
                   ...(guid ? { tallyGuid:guid } : {}),
                   ...(alterId ? { tallyAlterId:alterId } : {}) },
            $setOnInsert:{ itemId:`TALLY-${sku}`, sku, name, sellingPrice:cost, isActive:true },
          },
          upsert:true,
        }});
      }
      if (ops.length) { await ItemMaster.bulkWrite(ops, { ordered:false }); records += ops.length; }
    }

    // ── Ledgers ───────────────────────────────────────────────────────────────
    if (rawBody.includes('<LEDGER')) {
      type = 'Ledger';
      const matches = [...rawBody.matchAll(/<LEDGER[^>]*NAME="([^"]*)"[^>]*>([\s\S]*?)<\/LEDGER>/gi)];
      const ledgerOps = [], vendorOps = [], clientOps = [];
      for (const match of matches) {
        const name = match[1]?.trim(); if (!name) continue;
        const block       = match[2];
        const guid        = extractGuid(block);
        const alterId     = extractAlterId(block);
        const parent      = (block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1]||'').trim();
        if (!parent.includes('Sundry')) continue;
        const gstNumber      = (block.match(/<PARTYGSTIN>(.*?)<\/PARTYGSTIN>/i)?.[1]||'N/A').trim();
        const openingBalance = parseFloat(block.match(/<OPENINGBALANCE>(.*?)<\/OPENINGBALANCE>/i)?.[1])||0;
        const email          = (block.match(/<EMAIL>(.*?)<\/EMAIL>/i)?.[1]||'').trim();
        const phone          = (block.match(/<LEDGERMOBILE>(.*?)<\/LEDGERMOBILE>/i)?.[1]||'').trim();
        const isCreditor     = parent.includes('Creditor');
        const ledgerGroup    = isCreditor ? 'Sundry Creditors' : 'Sundry Debtors';
        const ledgerCode     = `TALLY-${name.replace(/[^A-Z0-9]/gi,'-').toUpperCase().slice(0,20)}-${Date.now()%10000}`;
        const lFilter = guid ? { tallyGuid:guid } : { ledgerName:name };
        ledgerOps.push({ updateOne:{
          filter:lFilter,
          update:{
            $set:{ ledgerGroup, gstNumber, openingBalance, email, phone, syncedWithTally:true, lastTallySync:new Date(),
                   ...(guid?{tallyGuid:guid}:{}), ...(alterId?{tallyAlterId:alterId}:{}) },
            $setOnInsert:{ ledgerCode, ledgerName:name, contactPerson:name, panNumber:'N/A', isActive:true },
          },
          upsert:true,
        }});
        if (isCreditor) {
          vendorOps.push({ updateOne:{
            filter: guid ? {tallyGuid:guid} : {companyName:name},
            update:{
              $set:{ email:email||undefined, phone:phone||undefined, gstNumber:gstNumber||undefined,
                     tallySynced:true, lastTallySync:new Date(),
                     ...(guid?{tallyGuid:guid}:{}), ...(alterId?{tallyAlterId:alterId}:{}) },
              $setOnInsert:{ vendorId:`VND-TLY-${Date.now()%100000}`, companyName:name, category:'General',
                             contactPerson:name, phone:phone||'0000000000',
                             email:email||`${name.replace(/\s+/g,'').toLowerCase()}@tally.sync`,
                             address:'Webhook Import', city:'Unknown', state:'Unknown', pincode:'000000', status:'Active' },
            },
            upsert:true,
          }});
        } else {
          clientOps.push({ updateOne:{
            filter: guid ? {tallyGuid:guid} : {name},
            update:{
              $set:{ email:email||undefined, phone:phone||undefined, gstNumber:gstNumber||undefined,
                     tallySynced:true, lastTallySync:new Date(),
                     ...(guid?{tallyGuid:guid}:{}), ...(alterId?{tallyAlterId:alterId}:{}) },
              $setOnInsert:{ clientId:`CLT-TLY-${Date.now()%100000}`, name, contact:name,
                             phone:phone||'0000000000',
                             email:email||`${name.replace(/\s+/g,'').toLowerCase()}@tally.sync`,
                             city:'Unknown', category:'Trading', status:'Active' },
            },
            upsert:true,
          }});
        }
      }
      await Promise.all([
        ledgerOps.length ? AccountsLedger.bulkWrite(ledgerOps,{ordered:false}) : Promise.resolve(),
        vendorOps.length ? Vendor.bulkWrite(vendorOps,{ordered:false}) : Promise.resolve(),
        clientOps.length ? Client.bulkWrite(clientOps,{ordered:false}) : Promise.resolve(),
      ]);
      records += ledgerOps.length;
    }

    // ── Sales Vouchers ────────────────────────────────────────────────────────
    if (rawBody.includes('<VOUCHER') && rawBody.toUpperCase().includes('VCHTYPE="SALES"')) {
      type = 'Sales';
      const vMatches = [...rawBody.matchAll(/<VOUCHER[^>]*VCHTYPE="Sales"[^>]*>([\s\S]*?)<\/VOUCHER>/gi)];
      const ops = [];
      for (const match of vMatches) {
        const block      = match[1];
        const guid       = extractGuid(block);
        const alterId    = extractAlterId(block);
        const invoiceNo  = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1]||'').trim();
        if (!invoiceNo) continue;
        const partyName  = (block.match(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/i)?.[1]||'Unknown').trim();
        const rawDate    = (block.match(/<DATE>(.*?)<\/DATE>/i)?.[1]||'').trim();
        const grandTotal = Math.abs(parseFloat(block.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1])||0);
        const invoiceDate = rawDate.length===8 ? new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`) : new Date();
        const filter = guid ? { tallyGuid:guid } : { invoiceNo };
        ops.push({ updateOne:{
          filter,
          update:{
            $set:{ partyName, grandTotal, ...(guid?{tallyGuid:guid}:{}), ...(alterId?{tallyAlterId:alterId}:{}) },
            $setOnInsert:{ invoiceNo, partyName, invoiceDate, grandTotal, source:'manual', status:'Sent', invoiceType:'single', items:[] },
          },
          upsert:true,
        }});
      }
      if (ops.length) { await Invoice.bulkWrite(ops,{ordered:false}); records += ops.length; }
    }

    // ── Payment & Receipt Vouchers ────────────────────────────────────────────
    const pmtTypes = ['Payment','Receipt'];
    for (const vt of pmtTypes) {
      const vtUpper = vt.toUpperCase();
      if (!rawBody.toUpperCase().includes(`VCHTYPE="${vtUpper}"`)) continue;
      if (type === 'Full') type = vt;
      const vMatches = [...rawBody.matchAll(new RegExp(`<VOUCHER[^>]*VCHTYPE="${vt}"[^>]*>([\\s\\S]*?)<\\/VOUCHER>`, 'gi'))];
      const ops = [];
      for (const match of vMatches) {
        const block      = match[1];
        const guid       = extractGuid(block);
        const alterId    = extractAlterId(block);
        const vNo        = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1]||'').trim();
        const partyName  = (block.match(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/i)?.[1]||'').trim();
        const rawDate    = (block.match(/<DATE>(.*?)<\/DATE>/i)?.[1]||'').trim();
        const amount     = Math.abs(parseFloat(block.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1])||0);
        const narration  = (block.match(/<NARRATION>(.*?)<\/NARRATION>/i)?.[1]||'').trim();
        const vDate      = rawDate.length===8 ? new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`) : new Date();
        const ledgerEntries = [];
        for (const le of block.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/gi)) {
          const lb = le[1];
          const lName  = (lb.match(/<LEDGERNAME>(.*?)<\/LEDGERNAME>/i)?.[1]||'').trim();
          const lAmt   = parseFloat(lb.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1])||0;
          const isDmd  = (lb.match(/<ISDEEMEDPOSITIVE>(.*?)<\/ISDEEMEDPOSITIVE>/i)?.[1]||'No').trim()==='Yes';
          if (lName) ledgerEntries.push({ ledgerName:lName, amount:lAmt, isDeemed:isDmd });
        }
        const filter = guid ? { tallyGuid:guid } : { voucherNumber:vNo||`TALLY-${Date.now()}`, voucherType:vt };
        ops.push({ updateOne:{
          filter,
          update:{
            $set:{ partyName, amount, narration, voucherDate:vDate, ledgerEntries, source:'Tally', syncedAt:new Date(),
                   ...(guid?{tallyGuid:guid}:{}), ...(alterId?{tallyAlterId:alterId}:{}) },
            $setOnInsert:{ voucherType:vt, voucherNumber:vNo||`TALLY-${Date.now()}` },
          },
          upsert:true,
        }});
      }
      if (ops.length) { await TallyVoucher.bulkWrite(ops,{ordered:false}); records += ops.length; }
    }

    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type, direction:'Tally → ERP', status:'Success', duration, records });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{upsert:true});
    res.json({ success:true, message:`Webhook processed — ${records} records updated`, records });
  } catch (err) {
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId:`WEBHOOK-ERR-${Date.now()}`, type:'Full', direction:'Tally → ERP', status:'Failed', duration, error:err.message, records:0 });
    console.error('[TallyWebhook]', err.message);
    res.status(500).json({ success:false, message:err.message });
  }
};
