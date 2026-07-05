import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';

await mongoose.connect(process.env.MONGO_URI);

const inv = await Invoice.findOne({ invoiceNo: 'BIW76' }).lean();
console.log('BIW76 invoiceDate:', inv?.invoiceDate, typeof inv?.invoiceDate);
console.log('BIW76 grandTotal:', inv?.grandTotal);
console.log('BIW76 cgst:', inv?.items?.[0]?.cgst, 'sgst:', inv?.items?.[0]?.sgst);

const po = await PurchaseOrder.findOne({ poId: 'PO-2026-008' }).lean();
console.log('PO-2026-008 deliveryDate:', po?.deliveryDate);
console.log('PO-2026-008 orderDate:', po?.orderDate);
console.log('PO-2026-008 createdAt:', po?.createdAt);
console.log('PO-2026-008 poDate:', po?.poDate);

await mongoose.disconnect();
