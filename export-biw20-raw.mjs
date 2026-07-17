#!/usr/bin/env node
/**
 * export-biw20-raw.mjs
 * 
 * Direct export of BIW20 voucher from Tally with COMPLETE RAW response body
 * captured and logged WITHOUT any parsing, summarization, or filtering.
 * 
 * Includes ALL XML tags: <LINEERROR>, <LASTVCHID>, <CMPINFO>, <EXCEPTION>, etc.
 */

import axios from 'axios';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

// ─── MONGO CONNECTION ─────────────────────────────────────────────────────────
const MONGO_URL = process.env.MONGO_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/chakra';

console.log('[BIW20 Export] Connecting to MongoDB...');
console.log('[BIW20 Export] URI:', MONGO_URL.substring(0, 80) + '...');
try {
  await mongoose.connect(MONGO_URL, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 30000,
  });
  console.log('[BIW20 Export] ✅ MongoDB connected');
} catch (err) {
  console.error('[BIW20 Export] ❌ MongoDB connection failed:', err.message);
  console.error('[BIW20 Export] Make sure MongoDB is accessible or network is working');
  process.exit(1);
}

// ─── IMPORT CONFIG AFTER MONGOOSE ────────────────────────────────────────────
import TallyConfig from './models/TallyConfig.js';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveUrl(cfg) {
  const port = cfg.port || '9000';

  // Priority 1: tallyLocalUrl
  const local = (cfg.tallyLocalUrl || '').trim();
  if (local) {
    if (local.match(/:\d+$/) || local.startsWith('https://')) return local.replace(/\/$/, '');
    return `${local.replace(/\/$/, '')}:${port}`;
  }

  // Priority 2: serverUrl (skip cloud URLs)
  const server = (cfg.serverUrl || '').trim();
  if (server && !server.includes('majesticmall.net') && !server.includes('erp.')) {
    if (server.match(/:\d+$/) || server.startsWith('https://')) return server.replace(/\/$/, '');
    return `${server.replace(/\/$/, '')}:${port}`;
  }

  // Fallback: localhost
  return `http://localhost:${port}`;
}

// ─── MAIN EXPORT LOGIC ────────────────────────────────────────────────────────

async function exportBIW20() {
  console.log('\n[BIW20 Export] Fetching Tally config...');
  
  let cfg = await TallyConfig.findOne();
  if (!cfg) {
    console.error('[BIW20 Export] ❌ No Tally config found. Setup Tally first.');
    process.exit(1);
  }
  
  if (!cfg.companyName) {
    console.error('[BIW20 Export] ❌ Company name not configured in Tally settings.');
    process.exit(1);
  }

  const company = (cfg.companyName || '').trim().toUpperCase();
  const tallyUrl = resolveUrl(cfg);

  console.log(`[BIW20 Export] Tally URL: ${tallyUrl}`);
  console.log(`[BIW20 Export] Company: ${company}`);

  // ─── Build XML request to fetch Day Book (all vouchers) with broad date range ──
  // This is the exact format from tallySyncStream.js that is proven to work.
  
  const xmlRequest = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY><SVSHOWERRORLIST>Yes</SVSHOWERRORLIST><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>20240101</SVFROMDATE><SVTODATE>20261231</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;

  console.log('\n[BIW20 Export] Sending XML request to Tally...\n');
  console.log('─'.repeat(80));
  console.log('XML Request:');
  console.log('─'.repeat(80));
  console.log(xmlRequest);
  console.log('─'.repeat(80));
  
  try {
    const response = await axios.post(tallyUrl, xmlRequest, {
      headers: {
        'Content-Type': 'text/xml',
        'Accept': '*/*',
      },
      timeout: 120000,
      validateStatus: () => true,  // Don't throw on any status code
    });

    console.log('\n[BIW20 Export] ✅ Response received from Tally');
    console.log(`[BIW20 Export] HTTP Status: ${response.status}`);
    console.log(`[BIW20 Export] Response size: ${String(response.data).length} bytes\n`);

    // ─── LOG THE COMPLETE RAW RESPONSE BODY ────────────────────────────────────
    console.log('═'.repeat(80));
    console.log('COMPLETE RAW RESPONSE BODY FROM TALLY');
    console.log('═'.repeat(80));
    console.log(response.data);
    console.log('═'.repeat(80));
    
    // ─── ALSO OUTPUT RESPONSE HEADERS ──────────────────────────────────────────
    console.log('\n[BIW20 Export] Response Headers:');
    console.log(JSON.stringify(response.headers, null, 2));

    process.exit(0);

  } catch (err) {
    console.error('\n[BIW20 Export] ❌ Request failed:');
    console.error('Error message:', err.message);
    if (err.response) {
      console.error('HTTP Status:', err.response.status);
      console.error('Response data:', err.response.data);
    }
    if (err.code) {
      console.error('Error code:', err.code);
    }
    process.exit(1);
  }
}

// ─── RUN ──────────────────────────────────────────────────────────────────────

exportBIW20().finally(async () => {
  await mongoose.disconnect();
});
