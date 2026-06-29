import mongoose from 'mongoose';

const connectorRegistrationSchema = new mongoose.Schema({
  machineId:        { type: String, required: true, unique: true },
  computerName:     { type: String, default: '' },
  windowsUsername:  { type: String, default: '' },
  operatingSystem:  { type: String, default: '' },
  connectorVersion: { type: String, default: '1.0.0' },
  tallyVersion:     { type: String, default: '' },
  connectorId:      { type: String, required: true, unique: true },
  isActive:         { type: Boolean, default: true },
  lastSeenAt:       { type: Date, default: Date.now },
  syncInterval:     { type: Number, default: 300 }, // seconds
}, { timestamps: true });

export default mongoose.model('ConnectorRegistration', connectorRegistrationSchema);
