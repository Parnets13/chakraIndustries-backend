import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ItemMaster from '../models/ItemMaster.js';
import Inventory from '../models/Inventory.js';
import Warehouse from '../models/Warehouse.js';

dotenv.config();

const seedData = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Clear existing data
    await ItemMaster.deleteMany({});
    await Inventory.deleteMany({});
    await Warehouse.deleteMany({});
    console.log('Cleared existing data');

    // Create sample warehouses
    const warehouses = await Warehouse.insertMany([
      {
        warehouseId: 'WH-001',
        name: 'Main Warehouse',
        location: 'Mumbai',
        manager: 'Rajesh Kumar',
        capacity: 10000,
        phone: '9876543210',
        address: 'Industrial Area, Mumbai',
        type: 'Raw Material',
        status: 'Active'
      },
      {
        warehouseId: 'WH-002',
        name: 'Secondary Warehouse',
        location: 'Pune',
        manager: 'Priya Singh',
        capacity: 5000,
        phone: '9876543211',
        address: 'Tech Park, Pune',
        type: 'Raw Material',
        status: 'Active'
      }
    ]);
    console.log(`Created ${warehouses.length} warehouses`);

    // Create sample materials
    const materials = [
      {
        itemId: 'MAT-001',
        sku: 'PISTON-RING-80',
        name: 'Piston Ring 80mm',
        description: 'High-quality piston ring for engine assembly',
        unit: 'piece',
        unitPrice: 150,
        costPrice: 100,
        sellingPrice: 200,
        minQuantity: 50,
        maxQuantity: 500,
        reorderPoint: 100,
        status: 'Active',
        isActive: true,
        gst: 18
      },
      {
        itemId: 'MAT-002',
        sku: 'CYLINDER-LINER',
        name: 'Cylinder Liner',
        description: 'Precision-engineered cylinder liner',
        unit: 'piece',
        unitPrice: 500,
        costPrice: 350,
        sellingPrice: 700,
        minQuantity: 20,
        maxQuantity: 200,
        reorderPoint: 50,
        status: 'Active',
        isActive: true,
        gst: 18
      },
      {
        itemId: 'MAT-003',
        sku: 'CRANKSHAFT-SEAL',
        name: 'Crankshaft Seal',
        description: 'Oil seal for crankshaft assembly',
        unit: 'piece',
        unitPrice: 200,
        costPrice: 120,
        sellingPrice: 300,
        minQuantity: 30,
        maxQuantity: 300,
        reorderPoint: 75,
        status: 'Active',
        isActive: true,
        gst: 18
      },
      {
        itemId: 'MAT-004',
        sku: 'BEARING-6205',
        name: 'Bearing 6205',
        description: 'Deep groove ball bearing',
        unit: 'piece',
        unitPrice: 250,
        costPrice: 150,
        sellingPrice: 350,
        minQuantity: 40,
        maxQuantity: 400,
        reorderPoint: 100,
        status: 'Active',
        isActive: true,
        gst: 18
      },
      {
        itemId: 'MAT-005',
        sku: 'VALVE-SPRING-SET',
        name: 'Valve Spring Set',
        description: 'Complete valve spring assembly',
        unit: 'piece',
        unitPrice: 300,
        costPrice: 200,
        sellingPrice: 450,
        minQuantity: 25,
        maxQuantity: 250,
        reorderPoint: 60,
        status: 'Active',
        isActive: true,
        gst: 18
      },
      {
        itemId: 'MAT-006',
        sku: 'TIMING-CHAIN-KIT',
        name: 'Timing Chain Kit',
        description: 'Complete timing chain assembly with sprockets',
        unit: 'piece',
        unitPrice: 800,
        costPrice: 500,
        sellingPrice: 1200,
        minQuantity: 10,
        maxQuantity: 100,
        reorderPoint: 25,
        status: 'Active',
        isActive: true,
        gst: 18
      },
      {
        itemId: 'MAT-007',
        sku: 'GEAR-SET-SMALL',
        name: 'Gear Set Small',
        description: 'Small precision gear set for gearbox',
        unit: 'piece',
        unitPrice: 600,
        costPrice: 400,
        sellingPrice: 900,
        minQuantity: 15,
        maxQuantity: 150,
        reorderPoint: 40,
        status: 'Active',
        isActive: true,
        gst: 18
      },
      {
        itemId: 'MAT-008',
        sku: 'GEAR-SET-LARGE',
        name: 'Gear Set Large',
        description: 'Large precision gear set for gearbox',
        unit: 'piece',
        unitPrice: 1000,
        costPrice: 650,
        sellingPrice: 1500,
        minQuantity: 10,
        maxQuantity: 100,
        reorderPoint: 25,
        status: 'Active',
        isActive: true,
        gst: 18
      }
    ];

    const createdMaterials = await ItemMaster.insertMany(materials);
    console.log(`Created ${createdMaterials.length} materials`);

    // Create inventory records for each material
    const inventoryRecords = [];
    for (const material of createdMaterials) {
      for (let i = 0; i < warehouses.length; i++) {
        const warehouse = warehouses[i];
        inventoryRecords.push({
          sku: `${material.sku}-WH${i + 1}`,  // Make SKU unique per warehouse
          name: material.name,
          itemMasterId: material._id,
          warehouse: warehouse._id,
          totalQuantity: 500,
          availableQuantity: 450,
          reservedQuantity: 50,
          minQuantity: 100,
          unit: material.unit,
          status: 'Active',
          unitPrice: material.costPrice
        });
      }
    }

    await Inventory.insertMany(inventoryRecords);
    console.log(`Created ${inventoryRecords.length} inventory records`);

    console.log('✓ BOM data seeded successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding data:', error);
    process.exit(1);
  }
};

seedData();
