
import dotenv from 'dotenv';
import connectDB from './config/database.js';
import User from './models/User.js';

dotenv.config();

async function listUsers() {
  try {
    await connectDB();
    console.log('Connected to DB');
    
    const users = await User.find({}).select('name email role isActive');
    console.log('\n=== Users in DB ===');
    users.forEach(u => {
      console.log(`- ${u.name} (${u.email}) - ${u.role} - Active: ${u.isActive}`);
    });
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

listUsers();

