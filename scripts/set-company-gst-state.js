/**
 * Sets the company GSTIN and state in TallyConfig.
 * Run: node scripts/set-company-gst-state.js
 * 
 * SRI CHAKRA INDUSTRIES is in Karnataka → state = "Karnataka"
 * Update GSTIN below with the actual GSTIN of Sri Chakra Industries.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import TallyConfig from '../models/TallyConfig.js';

await mongoose.connect(process.env.MONGO_URI);

// ── UPDATE THESE TWO VALUES ──────────────────────────────────────────────────
const COMPANY_STATE = 'Karnataka';          // State where Sri Chakra Industries is registered
const COMPANY_GSTIN = '29XXXXXXXXXXXXX';    // Replace with actual GSTIN of Sri Chakra Industries
// ────────────────────────────────────────────────────────────────────────────

const before = await TallyConfig.findOne().lean();
console.log('BEFORE:', { state: before?.state, gstin: before?.gstin });

const result = await TallyConfig.findOneAndUpdate(
  {},
  { $set: { state: COMPANY_STATE, gstin: COMPANY_GSTIN } },
  { sort: { _id: 1 }, new: true }
);

console.log('AFTER :', { state: result?.state, gstin: result?.gstin });
console.log('✅ Done — redeploy or restart backend for this to take effect in exports.');

await mongoose.disconnect();
