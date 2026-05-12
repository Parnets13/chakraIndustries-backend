import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Packaging from './models/Packaging.js';

dotenv.config();

const seedPackaging = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing packaging
    await Packaging.deleteMany({});
    console.log('Cleared existing packaging');

    // Default packaging options
    const packagingOptions = [
      {
        packagingId: 'PKG-001',
        name: 'Standard Box',
        description: 'Plain corrugated box with product label',
        type: 'Standard',
        moq: 100,
        extraCost: '₹0',
        extraCostValue: 0,
        leadTime: '0 days',
        leadTimeDays: 0,
        status: 'Active'
      },
      {
        packagingId: 'PKG-002',
        name: 'Custom Branded',
        description: 'Client logo & branding on box',
        type: 'Custom',
        moq: 500,
        extraCost: '₹12/unit',
        extraCostValue: 12,
        leadTime: '5 days',
        leadTimeDays: 5,
        status: 'Active'
      },
      {
        packagingId: 'PKG-003',
        name: 'Bulk Loose',
        description: 'No individual packaging, bulk pallet',
        type: 'Bulk',
        moq: 1000,
        extraCost: '-₹5/unit',
        extraCostValue: -5,
        leadTime: '0 days',
        leadTimeDays: 0,
        status: 'Active'
      },
      {
        packagingId: 'PKG-004',
        name: 'Premium Gift Box',
        description: 'Premium finish with foam insert',
        type: 'Premium',
        moq: 200,
        extraCost: '₹45/unit',
        extraCostValue: 45,
        leadTime: '7 days',
        leadTimeDays: 7,
        status: 'Active'
      },
      {
        packagingId: 'PKG-005',
        name: 'Eco-Friendly Box',
        description: 'Recyclable and biodegradable packaging',
        type: 'Standard',
        moq: 150,
        extraCost: '₹3/unit',
        extraCostValue: 3,
        leadTime: '2 days',
        leadTimeDays: 2,
        status: 'Active'
      },
      {
        packagingId: 'PKG-006',
        name: 'Foam Padded Box',
        description: 'Protective foam padding for fragile items',
        type: 'Custom',
        moq: 300,
        extraCost: '₹8/unit',
        extraCostValue: 8,
        leadTime: '3 days',
        leadTimeDays: 3,
        status: 'Active'
      }
    ];

    // Insert packaging options
    const result = await Packaging.insertMany(packagingOptions);
    console.log(`✅ Seeded ${result.length} packaging options`);

    // Display seeded data
    const allPackaging = await Packaging.find();
    console.log('\nSeeded Packaging Options:');
    allPackaging.forEach(pkg => {
      console.log(`  - ${pkg.packagingId}: ${pkg.name} (${pkg.type})`);
    });

    await mongoose.connection.close();
    console.log('\n✅ Packaging seed completed successfully');
  } catch (error) {
    console.error('❌ Error seeding packaging:', error);
    process.exit(1);
  }
};

seedPackaging();
