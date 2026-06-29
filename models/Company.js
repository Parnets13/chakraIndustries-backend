import mongoose from 'mongoose';

const companySchema = new mongoose.Schema({
  companyName:  { type: String, required: true, trim: true, unique: true },
  gstNumber:    { type: String, trim: true, default: '' },
  address:      { type: String, default: '' },
  email:        { type: String, default: '' },
  phone:        { type: String, default: '' },
  // Aliases — alternate names found in PDFs that map to this company
  aliases:      [{ type: String, trim: true }],
}, { timestamps: true });

companySchema.index({ companyName: 1 });

export default mongoose.model('Company', companySchema);
