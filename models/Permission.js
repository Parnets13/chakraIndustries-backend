import mongoose from 'mongoose';

/**
 * Stores per-role permission matrix.
 * Each document = one role's full permission set.
 * Modules: users, vendors, procurement, inventory, finance, reports, settings
 * Actions: create, read, update, delete, approve, export
 */

const modulePermissionSchema = new mongoose.Schema(
  {
    create:  { type: Boolean, default: false },
    read:    { type: Boolean, default: false },
    update:  { type: Boolean, default: false },
    delete:  { type: Boolean, default: false },
    approve: { type: Boolean, default: false },
    export:  { type: Boolean, default: false },
  },
  { _id: false }
);

const permissionSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: true,
      unique: true,
      enum: ['super_admin', 'management', 'purchase_manager', 'production_manager', 'dealer', 'corporate_client'],
    },
    modules: {
      users:       { type: modulePermissionSchema, default: () => ({}) },
      vendors:     { type: modulePermissionSchema, default: () => ({}) },
      procurement: { type: modulePermissionSchema, default: () => ({}) },
      inventory:   { type: modulePermissionSchema, default: () => ({}) },
      finance:     { type: modulePermissionSchema, default: () => ({}) },
      reports:     { type: modulePermissionSchema, default: () => ({}) },
      settings:    { type: modulePermissionSchema, default: () => ({}) },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default mongoose.model('Permission', permissionSchema);
