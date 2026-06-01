import mongoose from 'mongoose';

const docketTrackingSchema = new mongoose.Schema({
  // Auto-generated fields
  docketId: {
    type: String,
    trim: true
  },
  
  // Material Return Integration
  mrId: {
    type: String,
    trim: true,
    ref: 'MaterialReturn'
  },
  returnRequestId: {
    type: String,
    trim: true
  },
  returnType: {
    type: String,
    trim: true
  },
  invoiceNo: {
    type: String,
    trim: true
  },
  
  // Product Details
  productName: {
    type: String,
    trim: true
  },
  productSku: {
    type: String,
    trim: true
  },
  qty: {
    type: Number,
    default: 1
  },
  shipmentValue: {
    type: Number,
    default: 0
  },
  
  // Supplier and Location
  supplier: {
    type: String,
    trim: true
  },
  sourceLocation: {
    type: String,
    trim: true
  },
  destWarehouse: {
    type: String,
    trim: true
  },
  
  // Transport Details
  awbLrNumber: {
    type: String,
    trim: true
  },
  courierPartner: {
    type: String,
    enum: ['VRL Logistics', 'Delhivery', 'Blue Dart', 'DTDC', 'FedEx', 'Aramex', 'Ecom Express', 'Xpressbees', 'Ekart', 'Other'],
    trim: true,
    default: 'VRL Logistics'
  },
  vehicleName: {
    type: String,
    trim: true
  },
  vehicleNumber: {
    type: String,
    trim: true
  },
  driverName: {
    type: String,
    trim: true
  },
  driverMobile: {
    type: String,
    trim: true
  },
  
  // Location Details (Auto-fetch from masters)
  pickupLocation: {
    type: String,
    trim: true
  },
  deliveryLocation: {
    type: String,
    trim: true
  },
  
  // Date Management
  pickupDate: {
    type: Date,
    default: Date.now
  },
  dispatchDate: {
    type: Date
  },
  lastScanTime: {
    type: Date
  },
  estimatedDelivery: {
    type: Date
  },
  actualDeliveryDate: {
    type: Date
  },
  
  // Tracking Information
  lastScanLocation: {
    type: String,
    trim: true
  },
  transitDays: {
    type: Number,
    default: 0
  },
  
  // Shipment Details
  shipmentWeight: {
    type: Number,
    default: 0
  },
  packagesCount: {
    type: Number,
    default: 1
  },
  transportCost: {
    type: Number,
    default: 0
  },
  shipmentType: {
    type: String,
    enum: ['Standard', 'Express', 'Overnight', 'Economy'],
    default: 'Standard'
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Critical'],
    default: 'Medium'
  },
  
  // Status Management
  transportStatus: {
    type: String,
    enum: ['pickup_pending', 'picked_up', 'in_transit', 'reached_hub', 'out_for_delivery', 'delivered', 'delayed', 'damaged', 'returned', 'cancelled', 'closed'],
    default: 'pickup_pending'
  },
  warehouseStatus: {
    type: String,
    enum: ['Not Started', 'Awaited', 'Received', 'Processing', 'Completed'],
    default: 'Not Started'
  },
  qcStatus: {
    type: String,
    enum: ['Pending', 'In Progress', 'Passed', 'Failed', 'Completed'],
    default: 'Pending'
  },
  financeStatus: {
    type: String,
    enum: ['Not Initiated', 'Pending', 'Credit Note Issued', 'Completed'],
    default: 'Not Initiated'
  },
  podStatus: {
    type: String,
    enum: ['pending', 'uploaded', 'verified', 'rejected'],
    default: 'pending'
  },
  damageStatus: {
    type: String,
    enum: ['none', 'minor', 'major', 'total_loss'],
    default: 'none'
  },
  assignedTeam: {
    type: String,
    trim: true,
    default: 'Logistics Team'
  },
  
  // Additional Information
  delayReason: {
    type: String,
    trim: true
  },
  remarks: {
    type: String,
    trim: true
  },
  
  // Tracking History with enhanced structure
  trackingHistory: [{
    status: {
      type: String,
      required: true
    },
    location: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    remarks: String,
    updatedBy: String,
    courierUpdate: {
      type: Boolean,
      default: false
    }
  }],
  
  // Enhanced Material Details
  materialDetails: {
    description: String,
    quantity: Number,
    weight: Number,
    value: Number,
    unit: String,
    invoiceNumber: String,
    returnAmount: Number
  },
  
  // Enhanced Contact Details
  contactDetails: {
    supplierName: String,
    supplierContact: String,
    transporterContact: String,
    driverContact: String
  },
  
  // File Attachments
  attachments: [{
    fileName: String,
    fileType: String,
    fileUrl: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    uploadedBy: String,
    category: {
      type: String,
      enum: ['POD', 'LR_Copy', 'Invoice', 'Damage_Report', 'Other'],
      default: 'Other'
    }
  }],
  
  // POD Information
  podDetails: {
    receivedBy: String,
    receivedDate: Date,
    receivedTime: String,
    signature: String,
    podImage: String,
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending'
    }
  },
  
  // SLA and Performance Metrics
  slaDetails: {
    expectedSLA: Number, // in hours
    actualSLA: Number,
    slaBreached: {
      type: Boolean,
      default: false
    }
  },
  
  // Integration References
  integrationRefs: {
    warehouseId: String,
    vendorId: String,
    customerId: String,
    dispatchId: String,
    qcId: String
  },
  
  // System Fields
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: String,
    default: 'system'
  },
  updatedBy: String
}, {
  timestamps: true
});

// Indexes for better query performance
docketTrackingSchema.index({ docketId: 1 });
docketTrackingSchema.index({ mrId: 1 });
docketTrackingSchema.index({ awbLrNumber: 1 });
docketTrackingSchema.index({ supplierName: 1 });
docketTrackingSchema.index({ materialStatus: 1 });
docketTrackingSchema.index({ dispatchDate: 1 });
docketTrackingSchema.index({ expectedArrival: 1 });

// Virtual for calculating delay
docketTrackingSchema.virtual('isDelayed').get(function() {
  if (this.materialStatus === 'delivered') return false;
  return new Date() > this.expectedArrival;
});

// Virtual for calculating days in transit
docketTrackingSchema.virtual('daysInTransit').get(function() {
  const startDate = this.dispatchDate;
  const endDate = this.actualArrival || new Date();
  return Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
});

// Pre-save middleware to add tracking history
docketTrackingSchema.pre('save', function(next) {
  if (this.isModified('materialStatus')) {
    this.trackingHistory.push({
      status: this.materialStatus,
      timestamp: new Date(),
      remarks: `Status updated to ${this.materialStatus}`
    });
  }
  next();
});

// Static method to get dashboard stats
docketTrackingSchema.statics.getDashboardStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$materialStatus',
        count: { $sum: 1 },
        totalValue: { $sum: '$materialDetails.value' }
      }
    }
  ]);

  const delayed = await this.countDocuments({
    materialStatus: { $nin: ['delivered', 'cancelled'] },
    expectedArrival: { $lt: new Date() }
  });

  return {
    byStatus: stats,
    delayed,
    total: await this.countDocuments({ isActive: true })
  };
};

// Static method to search dockets
docketTrackingSchema.statics.searchDockets = function(searchTerm) {
  const regex = new RegExp(searchTerm, 'i');
  return this.find({
    $or: [
      { docketId: regex },
      { mrId: regex },
      { awbLrNumber: regex },
      { supplierName: regex },
      { transporter: regex },
      { vehicleNo: regex }
    ],
    isActive: true
  });
};

export default mongoose.model('DocketTracking', docketTrackingSchema);