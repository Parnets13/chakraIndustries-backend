import Permission from '../models/Permission.js';
import { logActivity } from '../utils/activityLogger.js';

const DEFAULT_PERMISSIONS = {
  super_admin: {
    users:       { create: true,  read: true,  update: true,  delete: true,  approve: true,  export: true  },
    vendors:     { create: true,  read: true,  update: true,  delete: true,  approve: true,  export: true  },
    procurement: { create: true,  read: true,  update: true,  delete: true,  approve: true,  export: true  },
    inventory:   { create: true,  read: true,  update: true,  delete: true,  approve: true,  export: true  },
    finance:     { create: true,  read: true,  update: true,  delete: true,  approve: true,  export: true  },
    reports:     { create: true,  read: true,  update: true,  delete: true,  approve: true,  export: true  },
    settings:    { create: true,  read: true,  update: true,  delete: true,  approve: true,  export: true  },
  },
  management: {
    users:       { create: false, read: true,  update: false, delete: false, approve: false, export: true  },
    vendors:     { create: false, read: true,  update: false, delete: false, approve: true,  export: true  },
    procurement: { create: false, read: true,  update: false, delete: false, approve: true,  export: true  },
    inventory:   { create: false, read: true,  update: false, delete: false, approve: false, export: true  },
    finance:     { create: false, read: true,  update: false, delete: false, approve: true,  export: true  },
    reports:     { create: false, read: true,  update: false, delete: false, approve: false, export: true  },
    settings:    { create: false, read: true,  update: false, delete: false, approve: false, export: false },
  },
  purchase_manager: {
    users:       { create: false, read: false, update: false, delete: false, approve: false, export: false },
    vendors:     { create: true,  read: true,  update: true,  delete: false, approve: false, export: true  },
    procurement: { create: true,  read: true,  update: true,  delete: false, approve: false, export: true  },
    inventory:   { create: false, read: true,  update: false, delete: false, approve: false, export: false },
    finance:     { create: false, read: true,  update: false, delete: false, approve: false, export: false },
    reports:     { create: false, read: true,  update: false, delete: false, approve: false, export: true  },
    settings:    { create: false, read: false, update: false, delete: false, approve: false, export: false },
  },
  production_manager: {
    users:       { create: false, read: false, update: false, delete: false, approve: false, export: false },
    vendors:     { create: false, read: true,  update: false, delete: false, approve: false, export: false },
    procurement: { create: true,  read: true,  update: false, delete: false, approve: false, export: false },
    inventory:   { create: true,  read: true,  update: true,  delete: false, approve: false, export: true  },
    finance:     { create: false, read: false, update: false, delete: false, approve: false, export: false },
    reports:     { create: false, read: true,  update: false, delete: false, approve: false, export: true  },
    settings:    { create: false, read: false, update: false, delete: false, approve: false, export: false },
  },
  dealer: {
    users:       { create: false, read: false, update: false, delete: false, approve: false, export: false },
    vendors:     { create: false, read: true,  update: false, delete: false, approve: false, export: false },
    procurement: { create: true,  read: true,  update: false, delete: false, approve: false, export: false },
    inventory:   { create: false, read: true,  update: false, delete: false, approve: false, export: false },
    finance:     { create: false, read: true,  update: false, delete: false, approve: false, export: false },
    reports:     { create: false, read: true,  update: false, delete: false, approve: false, export: false },
    settings:    { create: false, read: false, update: false, delete: false, approve: false, export: false },
  },
  corporate_client: {
    users:       { create: false, read: false, update: false, delete: false, approve: false, export: false },
    vendors:     { create: false, read: false, update: false, delete: false, approve: false, export: false },
    procurement: { create: true,  read: true,  update: false, delete: false, approve: false, export: false },
    inventory:   { create: false, read: true,  update: false, delete: false, approve: false, export: false },
    finance:     { create: false, read: true,  update: false, delete: false, approve: false, export: false },
    reports:     { create: false, read: true,  update: false, delete: false, approve: false, export: false },
    settings:    { create: false, read: false, update: false, delete: false, approve: false, export: false },
  },
};

// GET /api/permissions  — get all role permissions
export const getAllPermissions = async (req, res) => {
  try {
    const permissions = await Permission.find().sort({ role: 1 });
    res.json({ success: true, permissions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/permissions/:role
export const getPermissionByRole = async (req, res) => {
  try {
    const perm = await Permission.findOne({ role: req.params.role });
    if (!perm) return res.status(404).json({ success: false, message: 'Permission config not found for this role' });
    res.json({ success: true, permission: perm });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/permissions/:role  — super_admin only
export const updatePermission = async (req, res) => {
  try {
    const { modules } = req.body;
    if (!modules) return res.status(400).json({ success: false, message: 'modules object is required' });

    const perm = await Permission.findOneAndUpdate(
      { role: req.params.role },
      { modules, updatedBy: req.user._id },
      { new: true, upsert: true, runValidators: true }
    );

    await logActivity(req, req.user, 'UPDATE_PERMISSION', {
      module: 'permissions',
      description: `Updated permissions for role: ${req.params.role}`,
      targetType: 'Permission',
      metadata: { role: req.params.role, modules },
    });

    res.json({ success: true, permission: perm });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/permissions/seed  — super_admin only — seeds default permissions
export const seedPermissions = async (req, res) => {
  try {
    const ops = Object.entries(DEFAULT_PERMISSIONS).map(([role, modules]) => ({
      updateOne: {
        filter: { role },
        update: { $setOnInsert: { role, modules, updatedBy: req.user._id } },
        upsert: true,
      },
    }));
    await Permission.bulkWrite(ops);

    await logActivity(req, req.user, 'SEED_PERMISSIONS', {
      module: 'permissions',
      description: 'Default permissions seeded',
    });

    res.json({ success: true, message: 'Default permissions seeded successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
