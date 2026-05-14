import mongoose from 'mongoose';

const bulkOrderApprovalSchema = new mongoose.Schema(
  {
    approvalId: {
      type: String,
      unique: true,
      required: true,
      index: true
    },
    quotationId: {
      type: String,
      required: [true, 'Quotation ID is required'],
      index: true
    },
    clientId: {
      type: String,
      required: [true, 'Client ID is required']
    },
    orderValue: {
      type: Number,
      required: [true, 'Order value is required']
    },
    approvalChain: [{
      level: {
        type: Number,
        required: true
      },
      role: {
        type: String,
        enum: ['Sales Manager', 'Finance Manager', 'Director'],
        required: true
      },
      approver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending'
      },
      remarks: String,
      approvedAt: Date
    }],
    currentLevel: {
      type: Number,
      default: 1
    },
    overallStatus: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending'
    },
    rejectionReason: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

export default mongoose.models.BulkOrderApproval || mongoose.model('BulkOrderApproval', bulkOrderApprovalSchema);
