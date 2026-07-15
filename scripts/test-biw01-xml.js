
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from '../services/tallyExportService.js';

dotenv.config();

console.log('Testing invoice BIW01 XML generation');

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    try {
      const invoice = await Invoice.findOne({ invoiceNo: 'BIW01' });
      if (!invoice) {
        console.log('Invoice BIW01 not found!');
        process.exit(1);
      }
      console.log('Found invoice BIW01:', invoice.invoiceNo);
      const normalizedVoucher = normalizeToTallyVoucher(invoice);
      console.log('Voucher normalized successfully');
      const xml = serializeTallyVoucher(normalizedVoucher, 'Create');
      console.log('Generated XML:');
      console.log(xml);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      mongoose.connection.close();
    }
  })
  .catch(err => {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1);
  });
