import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/database.js';
import Inventory from '../models/Inventory.js';
import Warehouse from '../models/Warehouse.js';

dotenv.config();

const seedAgeingData = async () => {
  try {
    await connectDB();
    
    console.log('Fetching warehouses...');
    const warehouses = await Warehouse.find().limit(3);
    
    if (warehouses.length === 0) {
      console.log('No warehouses found. Creating test warehouse...');
      const wh = await Warehouse.create({
        warehouseId: 'WH-TEST-01',
        name: 'Test Warehouse',
        location: 'Test Location',
        capacity: 5000,
        used: 1000,
        manager: 'Test Manager',
        status: 'Active'
      });
      warehouses.push(wh);
    }

    console.log('Creating ageing inventory items...');
    
    const today = new Date();
    const ageingItems = [
      {
        sku: 'SKU-AGEING-001',
        name: 'Old Stock Item 1',
        warehouse: warehouses[0]._id,
        totalQuantity: 50,
        availableQuantity: 50,
        reservedQuantity: 0,
        minQuantity: 10,
        unit: 'units',
        unitPrice: 150,
        status: 'Active',
        lastMovementDate: new Date(today.getTime() - 120 * 24 * 60 * 60 * 1000), // 120 days ago
        createdDate: new Date(today.getTime() - 120 * 24 * 60 * 60 * 1000)
      },
      {
        sku: 'SKU-AGEING-002',
        name: 'Old Stock Item 2',
        warehouse: warehouses[0]._id,
        totalQuantity: 30,
        availableQuantity: 30,
        reservedQuantity: 0,
        minQuantity: 10,
        unit: 'units',
        unitPrice: 200,
        status: 'Active',
        lastMovementDate: new Date(today.getTime() - 75 * 24 * 60 * 60 * 1000), // 75 days ago
        createdDate: new Date(today.getTime() - 75 * 24 * 60 * 60 * 1000)
      },
      {
        sku: 'SKU-AGEING-003',
        name: 'Medium Age Stock',
        warehouse: warehouses[1]?._id || warehouses[0]._id,
        totalQuantity: 100,
        availableQuantity: 100,
        reservedQuantity: 0,
        minQuantity: 20,
        unit: 'units',
        unitPrice: 120,
        status: 'Active',
        lastMovementDate: new Date(today.getTime() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
        createdDate: new Date(today.getTime() - 45 * 24 * 60 * 60 * 1000)
      },
      {
        sku: 'SKU-AGEING-004',
        name: 'Recent Stock',
        warehouse: warehouses[2]?._id || warehouses[0]._id,
        totalQuantity: 80,
        availableQuantity: 80,
        reservedQuantity: 0,
        minQuantity: 15,
        unit: 'units',
        unitPrice: 180,
        status: 'Active',
        lastMovementDate: new Date(today.getTime() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
        createdDate: new Date(today.getTime() - 15 * 24 * 60 * 60 * 1000)
      },
      {
        sku: 'SKU-AGEING-005',
        name: 'Very Old Stock',
        warehouse: warehouses[0]._id,
        totalQuantity: 20,
        availableQuantity: 20,
        reservedQuantity: 0,
        minQuantity: 5,
        unit: 'units',
        unitPrice: 250,
        status: 'Active',
        lastMovementDate: new Date(today.getTime() - 150 * 24 * 60 * 60 * 1000), // 150 days ago
        createdDate: new Date(today.getTime() - 150 * 24 * 60 * 60 * 1000)
      }
    ];

    await Inventory.insertMany(ageingItems);
    console.log('✅ Ageing inventory data seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding ageing data:', error);
    process.exit(1);
  }
};

seedAgeingData();
