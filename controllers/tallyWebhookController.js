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
function decodeXml(s) {
  if (!s) return '';
  let v = String(s);
  for (let i = 0; i < 2; i++) {
    v = v.replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&apos;/gi,"'");
  }
  return v;
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
    // ── Auth check ─────────────────────────────────────────────────────────
    // Accepts secret from env (fast, no DB hit) OR DB config (legacy)
    const envSecret = (process.env.TALLY_WEBHOOK_SECRET || '').trim();
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    const dbSecret = (cfg?.authType === 'API Key' && cfg?.apiKey) ? cfg.apiKey : '';
    const expectedSecret = envSecret || dbSecret;

    if (expectedSecret) {
      const received = (req.headers['x-tally-secret'] || req.headers['authorization']?.replace('Bearer ', '') || '').trim();
      if (received !== expectedSecret) {
        return res.status(401).json({ success: false, message: 'Unauthorized — invalid webhook secret' });
      }
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
        const cleanGuid = guid ? guid.replace(/[^A-Z0-9]/gi, '') : null;
        const sku = cleanGuid ? `TALLY-${cleanGuid}` : name.replace(/[^A-Z0-9]/gi,'-').toUpperCase().slice(0,30);
        const itemId = cleanGuid ? `TALLY-${cleanGuid}` : `TALLY-${sku}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
        ops.push({ updateOne:{
          filter: guid ? { tallyGuid: guid } : { name },
          update:{
            $set:{ itemId, sku, hsn, gst, unit:uMap[unit]||'units', costPrice:cost, unitPrice:cost,
                   tallySynced:true, lastTallySync:new Date(), status:'Active', isActive:true,
                   ...(guid ? { tallyGuid:guid } : {}),
                   ...(alterId ? { tallyAlterId:alterId } : {}) },
            $setOnInsert:{ name, sellingPrice:cost, isActive: true },
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
        const name = decodeXml(match[1]?.trim()); if (!name) continue;
        const block       = match[2];
        const guid        = extractGuid(block);
        const alterId     = extractAlterId(block);
        const parent      = decodeXml((block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1]||'').trim());
        if (!parent.includes('Sundry')) continue;
        const gstNumber      = decodeXml((block.match(/<PARTYGSTIN>(.*?)<\/PARTYGSTIN>/i)?.[1]||'N/A').trim());
        const openingBalance = parseFloat(block.match(/<OPENINGBALANCE>(.*?)<\/OPENINGBALANCE>/i)?.[1])||0;
        const email          = decodeXml((block.match(/<EMAIL>(.*?)<\/EMAIL>/i)?.[1]||'').trim());
        const phone          = decodeXml((block.match(/<LEDGERMOBILE>(.*?)<\/LEDGERMOBILE>/i)?.[1]||'').trim());
        const contactPerson  = decodeXml((block.match(/<MAILINGNAME>(.*?)<\/MAILINGNAME>/i)?.[1]||'').trim());
        const isCreditor     = parent.includes('Creditor');
        const ledgerGroup    = isCreditor ? 'Sundry Creditors' : 'Sundry Debtors';
        const ledgerCode     = `TALLY-${name.replace(/[^A-Z0-9]/gi,'-').toUpperCase().slice(0,20)}-${Date.now()%10000}`;
        // Parse address
        const addrLines = [...block.matchAll(/<ADDRESS>([\s\S]*?)<\/ADDRESS>/gi)].map(a=>decodeXml(a[1].trim())).filter(Boolean);
        const wCity    = decodeXml((block.match(/<LEDGERCITY>(.*?)<\/LEDGERCITY>/i)?.[1]||'').trim());
        const wState   = decodeXml((block.match(/<STATENAME>(.*?)<\/STATENAME>/i)?.[1]||'').trim());
        const wPincode = decodeXml((block.match(/<PINCODE>(.*?)<\/PINCODE>/i)?.[1]||'').trim()).replace(/\D/g,'').slice(0,6);
        let wDCity=wCity, wDState=wState, wDPin=wPincode;
        if (!wDCity||!wDState) { for(const ln of addrLines){ const pm=ln.match(/\b(\d{6})\b/); if(pm){ if(!wDPin)wDPin=pm[1]; const pts=ln.replace(pm[0],'').replace(/[-,\s]+$/,'').split(/[,\-]/).map(p=>p.trim()).filter(Boolean); if(!wDCity&&pts[0])wDCity=pts[0]; if(!wDState&&pts[1])wDState=pts[1]; break; }}}
        const wAddr = addrLines.slice(0,2).join(', ');
        // Normalise phone
        const _wd=phone?String(phone).replace(/\D/g,''):''; const _wc=(()=>{let d=_wd;if(d.length===12&&d.startsWith('91'))d=d.slice(2);if(d.length===11&&d.startsWith('0'))d=d.slice(1);return d.length===10?d:'';})(); const wSafePhone=_wc||_wd.slice(0,15)||'0000000000'; const wSafeEmail=email||`${name.replace(/\s+/g,'').toLowerCase().slice(0,30)}@tally.sync`;
        const lFilter = guid ? { tallyGuid:guid } : { ledgerName:name };
        ledgerOps.push({ updateOne:{
          filter:lFilter,
          update:{
            $set:{ ledgerGroup, gstNumber, openingBalance, syncedWithTally:true, lastTallySync:new Date(),
                   ...(email?{email}:{}), ...(wSafePhone!=='0000000000'?{phone:wSafePhone}:{}),
                   ...(wAddr?{'address.street':wAddr}:{}), ...(wDCity?{'address.city':wDCity}:{}),
                   ...(wDState?{'address.state':wDState}:{}), ...(wDPin?{'address.pincode':wDPin}:{}),
                   ...(guid?{tallyGuid:guid}:{}), ...(alterId?{tallyAlterId:alterId}:{}) },
            $setOnInsert:{ ledgerCode, ledgerName:name, contactPerson:contactPerson||name, panNumber:'N/A', isActive:true },
          },
          upsert:true,
        }});
        if (isCreditor) {
          const _vd = phone ? String(phone).replace(/\D/g,'') : '';
          const _vc = (() => { let d=_vd; if(d.length===12&&d.startsWith('91'))d=d.slice(2); if(d.length===11&&d.startsWith('0'))d=d.slice(1); return d.length===10?d:''; })();
          const vSafePhone = _vc || _vd.slice(0,15) || '0000000000';
          const vSafeEmail = email || `${name.replace(/\s+/g,'').toLowerCase().slice(0,30)}@tally.sync`;
          vendorOps.push({ updateOne:{
            filter: guid ? {tallyGuid:guid} : {companyName:name},
            update:{
              $set:{ tallySynced:true, lastTallySync:new Date(),
                     ...(vSafePhone !== '0000000000' ? {phone:vSafePhone} : {}),
                     ...(email ? {email:vSafeEmail} : {}),
                     ...(contactPerson ? {contactPerson} : {}),
                     ...(wAddr  ? {address:wAddr}   : {}),
                     ...(wDCity ? {city:wDCity}      : {}),
                     ...(wDState ? {state:wDState}   : {}),
                     ...(wDPin  ? {pincode:wDPin}    : {}),
                     ...(gstNumber&&gstNumber!=='N/A' ? {gstNumber} : {}),
                     ...(guid?{tallyGuid:guid}:{}), ...(alterId?{tallyAlterId:alterId}:{}) },
              $setOnInsert:{ vendorId:`VND-TLY-${Date.now()%100000}`, companyName:name, category:'General',
                             contactPerson:contactPerson||name, phone:vSafePhone, email:vSafeEmail,
                             address:wAddr||'Webhook Import', city:wDCity||'Unknown',
                             state:wDState||'Unknown', pincode:wDPin||'000000', status:'Active' },
            },
            upsert:true,
          }});
        } else {
          const _cd = phone ? String(phone).replace(/\D/g,'') : '';
          const _cc = (() => { let d=_cd; if(d.length===12&&d.startsWith('91'))d=d.slice(2); if(d.length===11&&d.startsWith('0'))d=d.slice(1); return d.length===10?d:''; })();
          const cSafePhone = _cc || _cd.slice(0,15) || '0000000000';
          const cSafeEmail = email || `${name.replace(/\s+/g,'').toLowerCase().slice(0,30)}@tally.sync`;
          clientOps.push({ updateOne:{
            filter: guid ? {tallyGuid:guid} : {name},
            update:{
              $set:{ tallySynced:true, lastTallySync:new Date(),
                     ...(cSafePhone !== '0000000000' ? {phone:cSafePhone} : {}),
                     ...(email ? {email:cSafeEmail} : {}),
                     ...(contactPerson ? {contact:contactPerson} : {}),
                     ...(wAddr  ? {address:wAddr}   : {}),
                     ...(wDCity ? {city:wDCity}      : {}),
                     ...(gstNumber&&gstNumber!=='N/A' ? {gstNumber} : {}),
                     ...(guid?{tallyGuid:guid}:{}), ...(alterId?{tallyAlterId:alterId}:{}) },
              $setOnInsert:{ clientId:`CLT-TLY-${Date.now()%100000}`, name, contact:contactPerson||name,
                             phone:cSafePhone, email:cSafeEmail,
                             city:wDCity||'Unknown', category:'Trading', status:'Active' },
            },
            upsert:true,
          }});
        }
      }
      await Promise.all([
        ledgerOps.length ? AccountsLedger.bulkWrite(ledgerOps,{ordered:false}).catch(e => {
          console.error('[TallyWebhook] AccountsLedger.bulkWrite failed:', e.message);
          return null;
        }) : Promise.resolve(),
        vendorOps.length ? Vendor.bulkWrite(vendorOps,{ordered:false}).catch(e => {
          console.error('[TallyWebhook] Vendor.bulkWrite failed:', e.message);
          return null;
        }) : Promise.resolve(),
        clientOps.length ? Client.bulkWrite(clientOps,{ordered:false}).catch(e => {
          console.error('[TallyWebhook] Client.bulkWrite failed:', e.message);
          return null;
        }) : Promise.resolve(),
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
            $set:{ partyName, grandTotal, source:'Tally', ...(guid?{tallyGuid:guid}:{}), ...(alterId?{tallyAlterId:alterId}:{}) },
            $setOnInsert:{ invoiceNo, partyName, invoiceDate, grandTotal, source:'Tally', status:'Sent', invoiceType:'single', items:[] },
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
    await TallyConfig.findOneAndUpdate(
  {},
  { lastSyncAt: new Date() },
  {
    sort: { _id: 1 },
    upsert: true
  }
);
    res.json({ success:true, message:`Webhook processed — ${records} records updated`, records });
  } catch (err) {
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId:`WEBHOOK-ERR-${Date.now()}`, type:'Full', direction:'Tally → ERP', status:'Failed', duration, error:err.message, records:0 });
    console.error('[TallyWebhook]', err.message);
    res.status(500).json({ success:false, message:err.message });
  }
};
