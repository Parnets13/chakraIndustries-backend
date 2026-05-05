import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/database.js';
import Warehouse from './models/Warehouse.js';
import Inventory from './models/Inventory.js';
import Batch from './models/Batch.js';
import StockMovement from './models/StockMovement.js';
import DefectiveStock from './models/DefectiveStock.js';
import PickingList from './models/PickingList.js';
import Category from './models/Category.js';

dotenv.config();

const seedInventoryData = async () => {
  try {
    await connectDB();
    
    console.log('Clearing existing inventory data...');
    await Warehouse.deleteMany({});
    await Inventory.deleteMany({});
    await Batch.deleteMany({});
    await StockMovement.deleteMany({});
    await DefectiveStock.deleteMany({});
    await PickingList.deleteMany({});
    
    // Create warehouses
    console.log('Creating warehouses...');
    const warehouses = await Warehouse.insertMany([
      {
        warehouseId: 'WH-01',
        name: 'Main Warehouse',
        location: 'Pune - Sector 4',
        capacity: 5000,
        used: 3200,
        manager: 'Rajesh Patil',
        status: 'Active',
        zones: [
          {
            zoneId: 'Z-A',
            name: 'Zone A — Raw Materials',
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
          }
        ]
      },
      {
        warehouseId: 'WH-02',
        name: 'Secondary Store',
        location: 'Pune - Sector 7',
        capacity: 2000,
        used: 1100,
        manager: 'Meena Joshi',
        status: 'Active',
        zones: []
      },
      {
        warehouseId: 'WH-03',
        name: 'Finished Goods',
        location: 'Nashik Plant',
        capacity: 3000,
        used: 2400,
        manager: 'Suresh Rao',
        status: 'Active',
        zones: []
      }
    ]);
    
    // Get a category for inventory items
    const category = await Category.findOne();
    
    // Create inventory items
    console.log('Creating inventory items...');
    const now = new Date();
    const inventoryItems = await Inventory.insertMany([
      {
        sku: 'SKU-1042',
        name: 'Bearing 6205',
        category: category?._id,
        warehouse: warehouses[0]._id,
        quantity: 12,
        totalQuantity: 12,
        minQuantity: 50,
        unit: 'units',
        batch: 'B-2024-04',
        unitPrice: 120,
        location: { zone: 'Z-A', rack: 'R-A1', shelf: 'S-A1-1', bin: 'BIN-A1-1-01' },
        lastMovementDate: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
        mfgDate: new Date('2024-04-01'),
        createdDate: new Date('2024-04-01')
      },
      {
        sku: 'SKU-2187',
        name: 'Oil Seal 35x52',
        category: category?._id,
        warehouse: warehouses[1]._id,
        quantity: 8,
        totalQuantity: 8,
        minQuantity: 30,
        unit: 'units',
        batch: 'B-2024-03',
        unitPrice: 115,
        location: { zone: 'Z-A', rack: 'R-A2', shelf: 'S-A2-1', bin: 'BIN-A2-1-01' },
        lastMovementDate: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
        mfgDate: new Date('2024-03-01'),
        createdDate: new Date('2024-03-01')
      },
      {
        sku: 'SKU-0934',
        name: 'Gasket Set A',
        category: category?._id,
        warehouse: warehouses[0]._id,
        quantity: 5,
        totalQuantity: 5,
        minQuantity: 25,
        unit: 'units',
        batch: 'B-2024-04',
        unitPrice: 650,
        location: { zone: 'Z-A', rack: 'R-A2', shelf: 'S-A2-1', bin: 'BIN-A2-1-01' },
        lastMovementDate: new Date(now.getTime() - 75 * 24 * 60 * 60 * 1000), // 75 days ago
        mfgDate: new Date('2024-02-01'),
        createdDate: new Date('2024-02-01')
      },
      {
        sku: 'SKU-3301',
        name: 'Piston Ring 80mm',
        category: category?._id,
        warehouse: warehouses[2]._id,
        quantity: 340,
        totalQuantity: 340,
        minQuantity: 40,
        unit: 'units',
        batch: 'B-2024-02',
        unitPrice: 280,
        location: { zone: 'Z-B', rack: 'R-B1', shelf: 'S-B1-1', bin: 'BIN-B1-1-01' },
        lastMovementDate: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        mfgDate: new Date('2024-02-01'),
        createdDate: new Date('2024-02-01')
      },
      {
        sku: 'SKU-4412',
        name: 'Crankshaft Seal',
        category: category?._id,
        warehouse: warehouses[0]._id,
        quantity: 220,
        totalQuantity: 220,
        minQuantity: 20,
        unit: 'units',
        batch: 'B-2024-04',
        unitPrice: 450,
        location: { zone: 'Z-A', rack: 'R-A1', shelf: 'S-A1-2', bin: 'BIN-A1-2-01' },
        lastMovementDate: new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000), // 120 days ago
        mfgDate: new Date('2024-01-01'),
        createdDate: new Date('2024-01-01')
      },
      {
        sku: 'SKU-5523',
        name: 'Valve Spring Set',
        category: category?._id,
        warehouse: warehouses[1]._id,
        quantity: 180,
        totalQuantity: 180,
        minQuantity: 30,
        unit: 'units',
        batch: 'B-2024-03',
        unitPrice: 320,
        location: { zone: 'Z-B', rack: 'R-B1', shelf: 'S-B1-1', bin: 'BIN-B1-1-01' },
        lastMovementDate: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000), // 35 days ago
        mfgDate: new Date('2024-03-01'),
        createdDate: new Date('2024-03-01')
      },
      {
        sku: 'SKU-6634',
        name: 'Timing Chain Kit',
        category: category?._id,
        warehouse: warehouses[2]._id,
        quantity: 0,
        totalQuantity: 0,
        minQuantity: 10,
        unit: 'units',
        batch: 'B-2024-01',
        unitPrice: 1200,
        location: { zone: 'Z-C', rack: 'R-C1', shelf: 'S-C1-1', bin: 'BIN-C1-1-01' },
        lastMovementDate: new Date(now.getTime() - 150 * 24 * 60 * 60 * 1000), // 150 days ago
        mfgDate: new Date('2024-01-01'),
        createdDate: new Date('2024-01-01')
      },
      {
        sku: 'SKU-7745',
        name: 'Clutch Plate Set',
        category: category?._id,
        warehouse: warehouses[0]._id,
        quantity: 95,
        totalQuantity: 95,
        minQuantity: 15,
        unit: 'units',
        batch: 'B-2024-04',
        unitPrice: 300,
        location: { zone: 'Z-B', rack: 'R-B1', shelf: 'S-B1-2', bin: 'BIN-B1-2-01' },
        lastMovementDate: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000), // 25 days ago
        mfgDate: new Date('2024-04-01'),
        createdDate: new Date('2024-04-01')
      }
    ]);
    
    // Create batches
    console.log('Creating batches...');
    await Batch.insertMany([
      {
        batchNo: 'B-2024-04',
        sku: inventoryItems[0].sku,
        itemName: inventoryItems[0].name,
        quantity: 12,
        unitPrice: inventoryItems[0].unitPrice,
        warehouse: 'WH-01',
        mfgDate: new Date('2024-04-01'),
        expiryDate: new Date('2026-04-01'),
        status: 'Critical',
        inventoryId: inventoryItems[0]._id
      },
      {
        batchNo: 'B-2024-03',
        sku: inventoryItems[5].sku,
        itemName: inventoryItems[5].name,
        quantity: 180,
        unitPrice: inventoryItems[5].unitPrice,
        warehouse: 'WH-02',
        mfgDate: new Date('2024-03-01'),
        expiryDate: new Date('2026-03-01'),
        status: 'Active',
        inventoryId: inventoryItems[5]._id
      },
      {
        batchNo: 'B-2024-02',
        sku: inventoryItems[3].sku,
        itemName: inventoryItems[3].name,
        quantity: 340,
        unitPrice: inventoryItems[3].unitPrice,
        warehouse: 'WH-03',
        mfgDate: new Date('2024-02-01'),
        expiryDate: new Date('2026-02-01'),
        status: 'Active',
        inventoryId: inventoryItems[3]._id
      },
      {
        batchNo: 'B-2024-01',
        sku: inventoryItems[6].sku,
        itemName: inventoryItems[6].name,
        quantity: 0,
        unitPrice: inventoryItems[6].unitPrice,
        warehouse: 'WH-03',
        mfgDate: new Date('2024-01-01'),
        expiryDate: new Date('2026-01-01'),
        status: 'Active',
        inventoryId: inventoryItems[6]._id
      }
    ]);
    
    // Create stock movements
    console.log('Creating stock movements...');
    await StockMovement.insertMany([
      {
        movementId: 'MV-001',
        type: 'Inward',
        sku: inventoryItems[3].sku,
        name: inventoryItems[3].name,
        qty: 200,
        from: 'Supplier',
        to: 'WH-01',
        ref: 'GRN-0234'
      },
      {
        movementId: 'MV-002',
        type: 'Outward',
        sku: inventoryItems[4].sku,
        name: inventoryItems[4].name,
        qty: 50,
        from: 'WH-01',
        to: 'Production',
        ref: 'WO-0891'
      },
      {
        movementId: 'MV-003',
        type: 'Transfer',
        sku: inventoryItems[5].sku,
        name: inventoryItems[5].name,
        qty: 30,
        from: 'WH-02',
        to: 'WH-01',
        ref: 'TR-0045'
      }
    ]);
    
    // Create defective stock
    console.log('Creating defective stock records...');
    await DefectiveStock.insertMany([
      {
        defectId: 'DEF-001',
        inventory: inventoryItems[0]._id,
        sku: inventoryItems[0].sku,
        itemName: inventoryItems[0].name,
        quantity: 3,
        defectType: 'Dimensional',
        source: 'GRN Inspection',
        stage: 'QC Hold',
        daysAged: 1
      },
      {
        defectId: 'DEF-002',
        inventory: inventoryItems[4]._id,
        sku: inventoryItems[4].sku,
        itemName: inventoryItems[4].name,
        quantity: 5,
        defectType: 'Surface Defect',
        source: 'Production',
        stage: 'Defective Bin',
        daysAged: 2
      }
    ]);
    
    // Create picking lists
    console.log('Creating picking lists...');
    await PickingList.insertMany([
      {
        pickId: 'PCK-001',
        orderId: 'ORD-2024-089',
        items: [
          {
            inventory: inventoryItems[3]._id,
            sku: inventoryItems[3].sku,
            itemName: inventoryItems[3].name,
            quantity: 50,
            location: 'WH-01 / A3',
            picked: true
          }
        ],
        status: 'Completed'
      },
      {
        pickId: 'PCK-002',
        orderId: 'ORD-2024-089',
        items: [
          {
            inventory: inventoryItems[4]._id,
            sku: inventoryItems[4].sku,
            itemName: inventoryItems[4].name,
            quantity: 20,
            location: 'WH-01 / B2',
            picked: false
          }
        ],
        status: 'In Progress'
      }
    ]);
    
    console.log('✅ Inventory data seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding inventory data:', error);
    process.exit(1);
  }
};

seedInventoryData();
