import dotenv from 'dotenv';
import connectDB from './config/database.js';
import User from './models/User.js';
import Permission from './models/Permission.js';

dotenv.config();

const SEED_USERS = [
  {
    name:     process.env.SUPER_ADMIN_NAME     || 'Super Admin',
    email:    process.env.SUPER_ADMIN_EMAIL    || 'admin@chakra.in',
    password: process.env.SUPER_ADMIN_PASSWORD || 'admin123',
    role:     'super_admin',
  },
  { name: 'Priya Sharma', email: 'ceo@chakra.in',        password: 'mgmt123',     role: 'management' },
  { name: 'Ramesh Gupta', email: 'purchase@chakra.in',   password: 'purchase123', role: 'purchase_manager' },
  { name: 'Sunil Das',    email: 'production@chakra.in', password: 'prod123',     role: 'production_manager' },
  { name: 'Vijay Rao',    email: 'dealer@chakra.in',     password: 'dealer123',   role: 'dealer' },
  { name: 'Meera Patel',  email: 'client@chakra.in',     password: 'client123',   role: 'corporate_client' },
];

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

async function seed() {
  await connectDB();

  // Seed users
  for (const u of SEED_USERS) {
    const exists = await User.findOne({ email: u.email });
    if (!exists) {
      await User.create({ ...u, avatar: u.name.split(' ').map(n => n[0]).join('').toUpperCase() });
      console.log(`✅ Created user: ${u.email} (${u.role})`);
    } else {
      if (u.role === 'super_admin') {
        exists.name = u.name;
        exists.password = u.password;
        await exists.save();
        console.log(`🔄 Updated super_admin: ${u.email}`);
      } else {
        console.log(`⏭  Skipped (exists): ${u.email}`);
      }
    }
  }

  // Seed default permissions (only if not already set)
  for (const [role, modules] of Object.entries(DEFAULT_PERMISSIONS)) {
    const exists = await Permission.findOne({ role });
    if (!exists) {
      await Permission.create({ role, modules });
      console.log(`✅ Created permissions for role: ${role}`);
    } else {
      console.log(`⏭  Permissions exist for: ${role}`);
    }
  }

  console.log('\nSeed complete.');
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
