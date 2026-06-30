import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Warehouse from '../models/Warehouse.js';

dotenv.config();

const seedWarehouses = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Clear existing warehouses
    await Warehouse.deleteMany({});
    console.log('Cleared existing warehouses');

    // Create sample warehouses
    const warehouses = [
      {
        warehouseId: 'WH-001',
        name: 'Main Warehouse - Delhi',
        location: 'Delhi, India',
        capacity: 10000,
        used: 0,
        manager: 'Rajesh Kumar',
        status: 'Active',
        zones: [
          {
            zoneId: 'Z-A',
            name: 'Zone A - Raw Materials',
            color: '#3b82f6',
            racks: [
              {
                rackId: 'R-A1',
                name: 'Rack A1',
                shelves: [
                  { shelfId: 'S-A1-1', bins: ['BIN-A1-1-01', 'BIN-A1-1-02', 'BIN-A1-1-03'] },
                  { shelfId: 'S-A1-2', bins: ['BIN-A1-2-01', 'BIN-A1-2-02'] }
                ]
              }
            ]
          },
          {
            zoneId: 'Z-B',
            name: 'Zone B - Finished Goods',
            color: '#10b981',
            racks: [
              {
                rackId: 'R-B1',
                name: 'Rack B1',
                shelves: [
                  { shelfId: 'S-B1-1', bins: ['BIN-B1-1-01', 'BIN-B1-1-02'] }
                ]
              }
            ]
          }
        ]
      },
      {
        warehouseId: 'WH-002',
        name: 'Secondary Warehouse - Mumbai',
        location: 'Mumbai, India',
        capacity: 8000,
        used: 0,
        manager: 'Priya Singh',
        status: 'Active',
        zones: [
          {
            zoneId: 'Z-C',
            name: 'Zone C - Components',
            color: '#f59e0b',
            racks: [
              {
                rackId: 'R-C1',
                name: 'Rack C1',
                shelves: [
                  { shelfId: 'S-C1-1', bins: ['BIN-C1-1-01', 'BIN-C1-1-02'] }
                ]
              }
            ]
          }
        ]
      },
      {
        warehouseId: 'WH-003',
        name: 'Distribution Center - Bangalore',
        location: 'Bangalore, India',
        capacity: 12000,
        used: 0,
        manager: 'Amit Patel',
        status: 'Active',
        zones: [
          {
            zoneId: 'Z-D',
            name: 'Zone D - Distribution',
            color: '#ef4444',
            racks: [
              {
                rackId: 'R-D1',
                name: 'Rack D1',
                shelves: [
                  { shelfId: 'S-D1-1', bins: ['BIN-D1-1-01', 'BIN-D1-1-02', 'BIN-D1-1-03'] }
                ]
              }
            ]
          }
        ]
      }
    ];

    const created = await Warehouse.insertMany(warehouses);
    console.log(`✓ Created ${created.length} warehouses`);

    await mongoose.connection.close();
    console.log('Database connection closed');
  } catch (error) {
    console.error('Error seeding warehouses:', error);
    process.exit(1);
  }
};

seedWarehouses();
