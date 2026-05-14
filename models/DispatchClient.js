import mongoose from 'mongoose';

const dispatchClientSchema = new mongoose.Schema({
  // Reference to corporate client
  corporateClientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CorporateClient',
    required: true,
    index: true
  },
  
  // Client identification
  clientCode: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  clientName: {
    type: String,
    required: true,
    index: true
  },
  
  // Primary delivery address
  deliveryAddress: {
    street: { type: String, required: true },
    area: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    country: { type: String, default: 'India' },
    landmark: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    }
  },
  
  // Alternative delivery addresses
  alternateAddresses: [{
    name: String,
    street: String,
    area: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: 'India' },
    landmark: String,
    isDefault: { type: Boolean, default: false },
    coordinates: {
      latitude: Number,
      longitude: Number
    }
  }],
  
  // Contact details for delivery
  contactPerson: {
    type: String,
    required: true
  },
  
  phone: {
    type: String,
    required: true
  },
  
  alternatePhone: String,
  
  email: {
    type: String,
    required: true
  },
  
  // Delivery preferences
  deliveryPreferences: {
    preferredTimeSlot: {
      type: String,
      enum: ['Morning (9-12)', 'Afternoon (12-15)', 'Evening (15-18)', 'Any Time'],
      default: 'Any Time'
    },
    
    deliveryInstructions: String,
    
    requiresAppointment: {
      type: Boolean,
      default: false
    },
    
    appointmentLeadTime: {
      type: Number,
      default: 24 // hours
    },
    
    specialHandling: {
      fragile: { type: Boolean, default: false },
      hazardous: { type: Boolean, default: false },
      temperatureControlled: { type: Boolean, default: false },
      highValue: { type: Boolean, default: false }
    },
    
    packagingRequirements: {
      type: String,
      enum: ['Standard', 'Eco-Friendly', 'Premium', 'Custom'],
      default: 'Standard'
    }
  },
  
  // Logistics details
  logisticsInfo: {
    preferredCarrier: String,
    
    serviceType: {
      type: String,
      enum: ['Standard', 'Express', 'Same Day', 'Next Day'],
      default: 'Standard'
    },
    
    insuranceRequired: {
      type: Boolean,
      default: false
    },
    
    maxInsuranceValue: {
      type: Number,
      default: 0
    },
    
    deliveryCharges: {
      freeDeliveryThreshold: { type: Number, default: 0 },
      standardCharges: { type: Number, default: 0 },
      expressCharges: { type: Number, default: 0 }
    }
  },
  
  // Access and security
  accessDetails: {
    gatePass: {
      required: { type: Boolean, default: false },
      contactPerson: String,
      contactNumber: String
    },
    
    securityClearance: {
      required: { type: Boolean, default: false },
      validUpto: Date,
      clearanceNumber: String
    },
    
    workingHours: {
      monday: { start: String, end: String },
      tuesday: { start: String, end: String },
      wednesday: { start: String, end: String },
      thursday: { start: String, end: String },
      friday: { start: String, end: String },
      saturday: { start: String, end: String },
      sunday: { start: String, end: String }
    }
  },
  
  // Delivery history and performance
  deliveryStats: {
    totalDeliveries: { type: Number, default: 0 },
    successfulDeliveries: { type: Number, default: 0 },
    failedDeliveries: { type: Number, default: 0 },
    averageDeliveryTime: { type: Number, default: 0 }, // in hours
    lastDeliveryDate: Date,
    deliveryRating: { type: Number, default: 5, min: 1, max: 5 }
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Sync status
  syncedAt: {
    type: Date,
    default: Date.now
  },
  
  lastUpdatedFromCorporate: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for performance
dispatchClientSchema.index({ corporateClientId: 1, isActive: 1 });
dispatchClientSchema.index({ clientCode: 1, isActive: 1 });
dispatchClientSchema.index({ 'deliveryAddress.pincode': 1 });
dispatchClientSchema.index({ 'deliveryAddress.city': 1 });

// Methods for delivery management
dispatchClientSchema.methods.updateDeliveryStats = function(successful = true, deliveryTime = 0) {
  this.deliveryStats.totalDeliveries += 1;
  if (successful) {
    this.deliveryStats.successfulDeliveries += 1;
  } else {
    this.deliveryStats.failedDeliveries += 1;
  }
  
  if (deliveryTime > 0) {
    const currentAvg = this.deliveryStats.averageDeliveryTime;
    const totalDeliveries = this.deliveryStats.totalDeliveries;
    this.deliveryStats.averageDeliveryTime = ((currentAvg * (totalDeliveries - 1)) + deliveryTime) / totalDeliveries;
  }
  
  this.deliveryStats.lastDeliveryDate = new Date();
  return this.save();
};

dispatchClientSchema.methods.getPreferredAddress = function() {
  const defaultAlt = this.alternateAddresses.find(addr => addr.isDefault);
  return defaultAlt || this.deliveryAddress;
};

export default mongoose.model('DispatchClient', dispatchClientSchema);