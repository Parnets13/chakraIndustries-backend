import mongoose from 'mongoose';
import dotenv from 'dotenv';
import BOM from '../models/BOM.js';

dotenv.config();

const seedBOMs = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Clear existing BOMs
    await BOM.deleteMany({});
    console.log('Cleared existing BOMs');

    // Sample BOM data with Project IDs
    const boms = [
      {
        projectId: 'PROJ-EA-001',
        product: 'Engine Assembly A',
        version: 'v1.0',
        type: 'Finished Good',
        uom: 'Set',
        description: 'Complete engine assembly with all components',
        components: [
          { itemName: 'Piston Ring 80mm', qty: 4, unit: 'Nos' },
          { itemName: 'Cylinder Liner', qty: 4, unit: 'Nos' },
          { itemName: 'Crankshaft Seal', qty: 2, unit: 'Nos' },
          { itemName: 'Bearing 6205', qty: 4, unit: 'Nos' },
          { itemName: 'Valve Spring Set', qty: 8, unit: 'Nos' },
          { itemName: 'Timing Chain Kit', qty: 1, unit: 'Set' }
        ],
        status: 'Active'
      },
      {
        projectId: 'PROJ-GB-002',
        product: 'Gearbox Unit B',
        version: 'v1.0',
        type: 'Finished Good',
        uom: 'Set',
        description: 'Gearbox assembly with all gears and bearings',
        components: [
          { itemName: 'Gear Set', qty: 2, unit: 'Set' },
          { itemName: 'Bearing 6305', qty: 3, unit: 'Nos' },
          { itemName: 'Shaft Steel', qty: 2, unit: 'Nos' },
          { itemName: 'Seal Ring', qty: 4, unit: 'Nos' }
        ],
        status: 'Active'
      },
      {
        projectId: 'PROJ-CA-003',
        product: 'Clutch Assembly C',
        version: 'v1.0',
        type: 'Finished Good',
        uom: 'Set',
        description: 'Clutch assembly with friction plates',
        components: [
          { itemName: 'Friction Plate', qty: 6, unit: 'Nos' },
          { itemName: 'Steel Plate', qty: 5, unit: 'Nos' },
          { itemName: 'Spring Set', qty: 1, unit: 'Set' },
          { itemName: 'Pressure Plate', qty: 1, unit: 'Nos' }
        ],
        status: 'Active'
      },
      {
        projectId: 'PROJ-HP-004',
        product: 'Hydraulic Pump D',
        version: 'v1.0',
        type: 'Finished Good',
        uom: 'Nos',
        description: 'Hydraulic pump for industrial use',
        components: [
          { itemName: 'Pump Body', qty: 1, unit: 'Nos' },
          { itemName: 'Piston', qty: 9, unit: 'Nos' },
          { itemName: 'Valve Spool', qty: 2, unit: 'Nos' },
          { itemName: 'Seal Kit', qty: 1, unit: 'Set' }
        ],
        status: 'Active'
      },
      {
        projectId: 'PROJ-CP-005',
        product: 'Control Panel E',
        version: 'v1.0',
        type: 'Finished Good',
        uom: 'Nos',
        description: 'Electrical control panel with PLC',
        components: [
          { itemName: 'PLC Module', qty: 1, unit: 'Nos' },
          { itemName: 'Relay Card', qty: 4, unit: 'Nos' },
          { itemName: 'Power Supply', qty: 1, unit: 'Nos' },
          { itemName: 'Cable Harness', qty: 1, unit: 'Set' }
        ],
        status: 'Active'
      }
    ];

    const inserted = await BOM.insertMany(boms);
    console.log(`✅ Seeded ${inserted.length} BOMs successfully`);

    // Display inserted data
    console.log('\n📋 Inserted BOMs:');
    inserted.forEach(bom => {
      console.log(`  - ${bom.projectId} | ${bom.product} (${bom.version}) - ${bom.components.length} components`);
    });

    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  } catch (error) {
    console.error('❌ Error seeding BOMs:', error.message);
    process.exit(1);
  }
};

seedBOMs();
