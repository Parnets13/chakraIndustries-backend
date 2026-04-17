import dotenv from 'dotenv';
import connectDB from './config/database.js';
import User from './models/User.js';

dotenv.config();

// Super admin pulled from .env — change it there anytime
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

async function seed() {
  await connectDB();

  for (const u of SEED_USERS) {
    const exists = await User.findOne({ email: u.email });
    if (!exists) {
      await User.create({
        ...u,
        avatar: u.name.split(' ').map(n => n[0]).join('').toUpperCase(),
      });
      console.log(`✅ Created: ${u.email} (${u.role})`);
    } else {
      // Update super_admin email/password if .env changed
      if (u.role === 'super_admin') {
        exists.name  = u.name;
        exists.password = u.password; // will be re-hashed by pre-save hook
        await exists.save();
        console.log(`🔄 Updated super_admin: ${u.email}`);
      } else {
        console.log(`⏭  Skipped (exists): ${u.email}`);
      }
    }
  }

  console.log('\nSeed complete.');
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
