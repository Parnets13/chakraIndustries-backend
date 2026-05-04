import Inventory from '../models/Inventory.js';
import Warehouse from '../models/Warehouse.js';
import Batch from '../models/Batch.js';
import StockMovement from '../models/StockMovement.js';

// Get all inventory with warehouse and batch info
export const getAllInventoryData = async (req, res) => {
  try {
    const inventory = await Inventory.find()
      .populate('warehouse', 'warehouseId name location capacity used')
      .populate('category', 'name')
      .populate('grnId', 'grnId')
      .sort({ createdAt: -1 });

    const formattedData = inventory.map(item => ({
      sku: item.sku,
      name: item.name,
      warehouse: item.warehouse?.warehouseId || 'N/A',
      warehouseName: item.warehouse?.name || 'N/A',
      qty: item.quantity,
      batch: item.batch || 'N/A',
      minQty: item.minQuantity,
      status: item.status,
      location: item.location,
      unitPrice: item.unitPrice,
      totalValue: item.totalValue,
      grnId: item.grnId?.grnId || null
    }));

    res.json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching inventory data',
      error: error.message
    });
  }
};

// Get all warehouses with summary
export const getAllWarehousesData = async (req, res) => {
  try {
    const warehouses = await Warehouse.find();

    const warehousesWithData = await Promise.all(
      warehouses.map(async (wh) => {
        const skuCount = await Inventory.countDocuments({ warehouse: wh._id });
        const totalQty = await Inventory.aggregate([
          { $match: { warehouse: wh._id } },
          { $group: { _id: null, total: { $sum: '$quantity' } } }
        ]);

        return {
          id: wh.warehouseId,
          name: wh.name,
          location: wh.location,
          capacity: wh.capacity,
          used: totalQty[0]?.total || 0,
          skus: skuCount,
          manager: wh.manager,
          status: wh.status
        };
      })
    );

    res.json({
      success: true,
      data: warehousesWithData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching warehouse data',
      error: error.message
    });
  }
};

// Get all stock movements
export const getAllMovementsData = async (req, res) => {
  try {
    const movements = await StockMovement.find()
      .populate('inventory', 'sku name')
      .sort({ createdAt: -1 })
      .limit(100);

    const formattedData = movements.map(mov => ({
      id: mov.movementId,
      type: mov.type,
      sku: mov.sku,
      name: mov.itemName,
      qty: mov.quantity,
      from: mov.from,
      to: mov.to,
      date: new Date(mov.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      ref: mov.reference || 'N/A'
    }));

    res.json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching movements data',
      error: error.message
    });
  }
};

// Get all batches with details
export const getAllBatchesData = async (req, res) => {
  try {
    const batches = await Batch.find()
      .populate('inventory', 'sku name unitPrice')
      .populate('warehouse', 'warehouseId name')
      .sort({ createdAt: -1 });

    const formattedData = batches.map(batch => {
      const today = new Date();
      const expiry = new Date(batch.expiryDate);
      const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

      return {
        batch: batch.batchNumber,
        sku: batch.sku,
        item: batch.itemName,
        qty: batch.quantity,
        mfg: new Date(batch.manufacturingDate).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
        exp: new Date(batch.expiryDate).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
        wh: batch.warehouse?.warehouseId || 'N/A',
        status: daysLeft < 0 ? 'Expired' : daysLeft <= 30 ? 'Critical' : 'Active',
        shelfPct: batch.shelfLifePercentage || 100,
        daysLeft
      };
    });

    res.json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching batch data',
      error: error.message
    });
  }
};

// Get ageing stock report
export const getAgeingStockData = async (req, res) => {
  try {
    console.log('getAgeingStockData called');
    
    // Fetch all inventory items (not just those with quantity > 0)
    const inventoryItems = await Inventory.find()
      .populate('warehouse', 'warehouseId name')
      .populate('vendorId', 'name')
      .lean()
      .exec();

    console.log(`Found ${inventoryItems.length} total inventory items`);

    if (!inventoryItems || inventoryItems.length === 0) {
      console.log('No inventory items found');
      return res.json({
        success: true,
        data: []
      });
    }

    const ageingData = inventoryItems
      .filter(item => {
        // Include items that have a date reference
        const hasDate = item.lastMovementDate || item.mfgDate || item.createdDate;
        return hasDate;
      })
      .map(item => {
        try {
          // Use lastMovementDate if available, otherwise mfgDate, otherwise createdDate
          const referenceDate = item.lastMovementDate || item.mfgDate || item.createdDate;
          const daysSinceLastMovement = Math.floor((new Date() - new Date(referenceDate)) / (1000 * 60 * 60 * 24));

          let bucket = '0–30';
          if (daysSinceLastMovement > 90) bucket = '90+';
          else if (daysSinceLastMovement > 60) bucket = '61–90';
          else if (daysSinceLastMovement > 30) bucket = '31–60';

          let action = 'No Action';
          let actionColor = '#22c55e';

          if (daysSinceLastMovement > 90) {
            action = item.totalQuantity === 0 ? 'Write-off' : 'Return to Supplier';
            actionColor = '#ef4444';
          } else if (daysSinceLastMovement > 60) {
            action = 'Offer Discount';
            actionColor = '#f59e0b';
          } else if (daysSinceLastMovement > 30) {
            action = 'Monitor';
            actionColor = '#f59e0b';
          }

          // Calculate value
          let value = '₹0';
          if (item.unitPrice && item.unitPrice > 0) {
            const totalValue = item.totalQuantity * item.unitPrice;
            // Format number with commas for Indian locale
            const formattedValue = Math.round(totalValue).toString().replace(/\B(?=(\d{2})+(?!\d))/g, ',');
            value = `₹${formattedValue}`;
          }

          return {
            sku: item.sku || 'N/A',
            item: item.name || 'N/A',
            wh: item.warehouse?.warehouseId || 'N/A',
            qty: item.totalQuantity || 0,
            lastMov: new Date(referenceDate).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
            days: daysSinceLastMovement,
            bucket,
            value,
            action,
            actionColor
          };
        } catch (mapError) {
          console.error('Error mapping inventory item:', item._id, mapError);
          return null;
        }
      })
      .filter(item => item !== null) // Remove any failed mappings
      .sort((a, b) => b.days - a.days); // Sort by days descending

    console.log(`Returning ${ageingData.length} ageing stock items`);
    res.json({
      success: true,
      data: ageingData
    });
  } catch (error) {
    console.error('Error fetching ageing data:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching ageing data',
      error: error.message
    });
  }
};

// Get defective stock
export const getDefectiveStockData = async (req, res) => {
  try {
    // Find items in defective location
    const inventory = await Inventory.find({ 
      'location.zone': 'Defective'
    })
      .populate('warehouse', 'warehouseId name')
      .populate('category', 'name');

    const defectiveData = inventory.map(item => ({
      sku: item.sku,
      name: item.name,
      qty: item.quantity,
      warehouse: item.warehouse?.warehouseId || 'N/A',
      warehouseName: item.warehouse?.name || 'N/A',
      category: item.category?.name || 'N/A',
      location: item.location ? `${item.location.zone}/${item.location.rack}/${item.location.shelf}/${item.location.bin}` : 'N/A',
      unitPrice: item.unitPrice || 0,
      totalValue: (item.quantity * (item.unitPrice || 0)).toLocaleString(),
      dateAdded: new Date(item.createdAt).toLocaleDateString('en-IN'),
      status: 'Defective',
      action: 'Pending Review'
    }));

    res.json({
      success: true,
      data: defectiveData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching defective stock data',
      error: error.message
    });
  }
};

// Get storage locations
export const getStorageLocationData = async (req, res) => {
  try {
    const warehouses = await Warehouse.find();
    
    const storageData = warehouses.map(wh => ({
      id: wh.warehouseId,
      name: wh.name,
      location: wh.location,
      zones: [
        {
          id: `Z-${wh.warehouseId}-A`,
          name: `Zone A — Raw Materials`,
          color: '#3b82f6',
          racks: 2,
          shelves: 4,
          bins: 8
        },
        {
          id: `Z-${wh.warehouseId}-B`,
          name: `Zone B — Finished Goods`,
          color: '#10b981',
          racks: 2,
          shelves: 3,
          bins: 6
        },
        {
          id: `Z-${wh.warehouseId}-C`,
          name: `Zone C — Defective/QC Hold`,
          color: '#ef4444',
          racks: 1,
          shelves: 2,
          bins: 4
        }
      ]
    }));

    res.json({
      success: true,
      data: storageData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching storage location data',
      error: error.message
    });
  }
};

// Get pincode stock
export const getPincodeStockData = async (req, res) => {
  try {
    const inventory = await Inventory.find()
      .populate('warehouse', 'warehouseId name location')
      .populate('category', 'name');

    console.log('Inventory items found:', inventory.length);

    // Group by pincode (using warehouse location as pincode for now)
    const pincodeMap = {};
    
    inventory.forEach(item => {
      if (!item || !item.warehouse) return;
      
      const pincode = item.warehouse?.location?.split(',')[0] || '000000';
      const city = item.warehouse?.location?.split(',')[1]?.trim() || 'Unknown';
      
      if (!pincodeMap[pincode]) {
        pincodeMap[pincode] = {
          pincode,
          city,
          godowns: {}
        };
      }
      
      const godownId = item.warehouse?.warehouseId || 'DEFAULT';
      if (!pincodeMap[pincode].godowns[godownId]) {
        pincodeMap[pincode].godowns[godownId] = {
          id: godownId,
          name: item.warehouse?.name || 'Default Godown',
          locations: []
        };
      }
      
      // Format location properly - convert object to string
      let locationStr = 'N/A';
      if (item.location) {
        if (typeof item.location === 'object') {
          const parts = [];
          if (item.location.zone) parts.push(item.location.zone);
          if (item.location.rack) parts.push(item.location.rack);
          if (item.location.shelf) parts.push(item.location.shelf);
          if (item.location.bin) parts.push(item.location.bin);
          locationStr = parts.length > 0 ? parts.join('-') : 'N/A';
        } else {
          locationStr = String(item.location);
        }
      }
      
      pincodeMap[pincode].godowns[godownId].locations.push({
        sku: String(item.sku || 'N/A'),
        name: String(item.name || 'Unknown Item'),
        qty: Number(item.quantity || 0),
        loc: locationStr
      });
    });

    // Convert to array and ensure all data is properly formatted
    const pincodeData = Object.values(pincodeMap).map(p => {
      if (!p || typeof p !== 'object') return null;
      
      const godownsArray = Object.values(p.godowns || {}).map(g => {
        if (!g || typeof g !== 'object') return null;
        return {
          id: String(g.id || ''),
          name: String(g.name || ''),
          locations: Array.isArray(g.locations) ? g.locations.map(loc => ({
            sku: String(loc.sku || 'N/A'),
            name: String(loc.name || 'Unknown'),
            qty: Number(loc.qty || 0),
            loc: String(loc.loc || 'N/A')
          })) : []
        };
      }).filter(g => g !== null);
      
      return {
        pincode: String(p.pincode || ''),
        city: String(p.city || ''),
        godowns: godownsArray
      };
    }).filter(item => item !== null && item.pincode && item.godowns && item.godowns.length > 0);

    console.log('Pincode data prepared:', pincodeData.length, 'pincodes');
    console.log('Sample data:', JSON.stringify(pincodeData[0], null, 2));

    res.json({
      success: true,
      data: pincodeData
    });
  } catch (error) {
    console.error('Error in getPincodeStockData:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching pincode stock data',
      error: error.message,
      data: []
    });
  }
};

// Create new inventory item
export const createInventoryItem = async (req, res) => {
  try {
    // Handle both 'qty' and 'quantity' field names
    const { sku, name, warehouse, quantity, qty, minQuantity, batch, unitPrice, category } = req.body;
    const finalQuantity = quantity || qty || 0;

    // If warehouse is a string (warehouseId), look it up
    let warehouseId = warehouse;
    if (warehouse && typeof warehouse === 'string') {
      const wh = await Warehouse.findOne({ warehouseId: warehouse.toUpperCase() });
      if (!wh) {
        return res.status(404).json({
          success: false,
          message: `Warehouse '${warehouse}' not found`
        });
      }
      warehouseId = wh._id;
    }

    const inventory = new Inventory({
      sku: sku.toUpperCase(),
      name,
      warehouse: warehouseId,
      quantity: finalQuantity,
      minQuantity: minQuantity || 0,
      batch,
      unitPrice: unitPrice || 0,
      category
    });

    await inventory.save();

    // Update warehouse used capacity
    if (warehouseId) {
      await Warehouse.findByIdAndUpdate(
        warehouseId,
        { $inc: { used: finalQuantity } }
      );
    }

    res.status(201).json({
      success: true,
      message: 'Inventory item created successfully',
      data: inventory
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating inventory item',
      error: error.message
    });
  }
};

// Create new warehouse
export const createWarehouseItem = async (req, res) => {
  try {
    const { warehouseId, id, name, location, capacity, manager } = req.body;
    const finalId = warehouseId || id;

    if (!finalId || !name || !location) {
      return res.status(400).json({
        success: false,
        message: 'warehouseId, name, and location are required'
      });
    }

    // Check if warehouse already exists
    const existing = await Warehouse.findOne({ warehouseId: finalId.toUpperCase() });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Warehouse '${finalId}' already exists`
      });
    }

    const warehouse = new Warehouse({
      warehouseId: finalId.toUpperCase(),
      name,
      location,
      capacity: capacity || 0,
      manager: manager || '',
      used: 0,
      status: 'Active'
    });

    await warehouse.save();

    res.status(201).json({
      success: true,
      message: 'Warehouse created successfully',
      data: warehouse
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating warehouse',
      error: error.message
    });
  }
};

// Create stock movement
export const createMovementItem = async (req, res) => {
  try {
    const { type, inventory, sku, itemName, quantity, qty, from, to, reference } = req.body;
    const finalQuantity = quantity || qty || 0;

    // If inventory is a SKU string, find the inventory item
    let inventoryId = inventory;
    let skuValue = sku;
    let itemNameValue = itemName;

    if (sku && !inventory) {
      const inv = await Inventory.findOne({ sku: sku.toUpperCase() });
      if (!inv) {
        return res.status(404).json({
          success: false,
          message: `Inventory item with SKU '${sku}' not found`
        });
      }
      inventoryId = inv._id;
      skuValue = inv.sku;
      itemNameValue = inv.name;
    } else if (inventory && typeof inventory === 'string') {
      const inv = await Inventory.findOne({ sku: inventory.toUpperCase() });
      if (!inv) {
        return res.status(404).json({
          success: false,
          message: `Inventory item with SKU '${inventory}' not found`
        });
      }
      inventoryId = inv._id;
      skuValue = inv.sku;
      itemNameValue = inv.name;
    }

    const movementId = `MV-${Date.now()}`;
    const movement = new StockMovement({
      movementId,
      type,
      inventory: inventoryId,
      sku: skuValue,
      itemName: itemNameValue,
      quantity: finalQuantity,
      from,
      to,
      reference
    });

    await movement.save();

    res.status(201).json({
      success: true,
      message: 'Movement recorded successfully',
      data: movement
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating movement',
      error: error.message
    });
  }
};

// Create batch
export const createBatchItem = async (req, res) => {
  try {
    const { inventory, sku, quantity, qty, manufacturingDate, expiryDate, warehouse, mfg, exp, itemName, batchNumber: providedBatchNumber } = req.body;
    
    console.log('Batch creation request:', {
      inventory,
      sku,
      quantity,
      qty,
      manufacturingDate,
      expiryDate,
      warehouse,
      mfg,
      exp,
      itemName,
      providedBatchNumber
    });

    const finalQuantity = quantity || qty || 0;
    const finalMfg = manufacturingDate || mfg;
    const finalExp = expiryDate || exp;

    // Validate required fields
    if (!finalMfg || !finalExp) {
      return res.status(400).json({
        success: false,
        message: 'Manufacturing date and expiry date are required',
        received: { finalMfg, finalExp }
      });
    }

    // If inventory is a SKU string, find the inventory item
    let inventoryId = inventory;
    let skuValue = sku;
    let itemNameValue = itemName || '';

    if (sku && !inventory) {
      const inv = await Inventory.findOne({ sku: sku.toUpperCase() });
      if (!inv) {
        return res.status(404).json({
          success: false,
          message: `Inventory item with SKU '${sku}' not found`
        });
      }
      inventoryId = inv._id;
      skuValue = inv.sku;
      itemNameValue = inv.name;
    } else if (inventory && typeof inventory === 'string') {
      const inv = await Inventory.findOne({ sku: inventory.toUpperCase() });
      if (!inv) {
        return res.status(404).json({
          success: false,
          message: `Inventory item with SKU '${inventory}' not found`
        });
      }
      inventoryId = inv._id;
      skuValue = inv.sku;
      itemNameValue = inv.name;
    } else if (inventory && typeof inventory === 'object' && inventory._id) {
      inventoryId = inventory._id;
      skuValue = inventory.sku;
      itemNameValue = inventory.name;
    }

    // Look up warehouse if it's a string
    let warehouseId = warehouse;
    if (warehouse && typeof warehouse === 'string') {
      const wh = await Warehouse.findOne({ warehouseId: warehouse.toUpperCase() });
      if (wh) {
        warehouseId = wh._id;
      } else {
        console.warn(`Warehouse '${warehouse}' not found, proceeding without warehouse reference`);
      }
    }

    // Use provided batch number or generate one
    const batchNumber = providedBatchNumber || `B-${new Date(finalMfg).getFullYear()}-${String(new Date(finalMfg).getMonth() + 1).padStart(2, '0')}`;

    const batch = new Batch({
      batchNumber,
      inventory: inventoryId,
      sku: skuValue,
      itemName: itemNameValue,
      quantity: finalQuantity,
      warehouse: warehouseId,
      manufacturingDate: finalMfg,
      expiryDate: finalExp
    });

    await batch.save();

    res.status(201).json({
      success: true,
      message: 'Batch created successfully',
      data: batch
    });
  } catch (error) {
    console.error('Batch creation error:', error);
    res.status(400).json({
      success: false,
      message: 'Error creating batch',
      error: error.message
    });
  }
};

export const createDefectiveStockItem = async (req, res) => {
  try {
    const { sku, name, quantity, qty, warehouse, warehouseName, category, unitPrice } = req.body;
    
    console.log('=== CREATE DEFECTIVE STOCK ===');
    console.log('Received data:', { sku, name, quantity, qty, warehouse, warehouseName, category, unitPrice });
    
    const finalQuantity = quantity || qty || 0;

    // Validate required fields 
    if (!sku || sku.trim() === '') {
      console.error('❌ Validation failed: SKU is missing');
      return res.status(400).json({
        success: false,
        message: 'SKU is required'
      });
    }
    
    if (!name || name.trim() === '') {
      console.error('❌ Validation failed: Name is missing');
      return res.status(400).json({
        success: false,
        message: 'Name is required'
      });
    }

    if (finalQuantity <= 0) {
      console.error('❌ Validation failed: Quantity must be greater than 0');
      return res.status(400).json({
        success: false,
        message: 'Quantity must be greater than 0'
      });
    }

    console.log('✅ Basic validation passed');

    // Look up warehouse and convert to ObjectId
    let warehouseId = warehouse;
    console.log('Looking up warehouse:', warehouse);
    
    if (warehouse && typeof warehouse === 'string') {
      try {
        const wh = await Warehouse.findOne({ warehouseId: warehouse.toUpperCase() });
        if (wh) {
          warehouseId = wh._id;
          console.log('✅ Warehouse found:', wh.warehouseId, '→', warehouseId);
        } else {
          console.log('⚠️ Warehouse not found by warehouseId, trying fallback');
          // Fallback to first warehouse if not found
          const firstWh = await Warehouse.findOne();
          if (firstWh) {
            warehouseId = firstWh._id;
            console.log('✅ Using fallback warehouse:', firstWh.warehouseId, '→', warehouseId);
          } else {
            console.error('❌ No warehouse found in system');
            return res.status(400).json({
              success: false,
              message: 'No warehouse found in system'
            });
          }
        }
      } catch (whError) {
        console.error('❌ Warehouse lookup error:', whError.message);
        return res.status(400).json({
          success: false,
          message: 'Error looking up warehouse: ' + whError.message
        });
      }
    }

    console.log('Final warehouseId:', warehouseId);

    // Find or create inventory item
    console.log('Looking up inventory with SKU:', sku.toUpperCase());
    let inventory = await Inventory.findOne({ sku: sku.toUpperCase() });
    
    if (!inventory) {
      console.log('Creating new inventory item');
      // Create new inventory item if it doesn't exist
      inventory = new Inventory({
        sku: sku.toUpperCase(),
        name: name,
        category: category,
        quantity: finalQuantity,
        unitPrice: unitPrice || 0,
        warehouse: warehouseId,
        location: {
          zone: 'Defective',
          rack: 'QC',
          shelf: 'Hold',
          bin: 'Defective Bin'
        }
        // Status will be auto-calculated by pre-save hook based on quantity
      });
      console.log('New inventory object created, saving...');
      await inventory.save();
      console.log('✅ New inventory saved successfully');
    } else {
      console.log('Updating existing inventory item');
      // Update existing inventory to mark as defective
      inventory.quantity = finalQuantity;
      inventory.unitPrice = unitPrice || inventory.unitPrice;
      inventory.warehouse = warehouseId;
      inventory.location = {
        zone: 'Defective',
        rack: 'QC',
        shelf: 'Hold',
        bin: 'Defective Bin'
      };
      // Status will be auto-calculated by pre-save hook based on quantity
      await inventory.save();
      console.log('✅ Existing inventory updated successfully');
    }

    console.log('Sending success response');
    res.status(201).json({
      success: true,
      message: 'Defective stock item created successfully',
      data: {
        sku: inventory.sku,
        name: inventory.name,
        qty: finalQuantity,
        warehouse: warehouseId,
        warehouseName: warehouseName || warehouse,
        category: inventory.category,
        location: inventory.location,
        unitPrice: inventory.unitPrice,
        totalValue: (finalQuantity * inventory.unitPrice).toLocaleString(),
        dateAdded: new Date().toLocaleDateString('en-IN'),
        status: inventory.status,
        action: 'Pending Review'
      }
    });
  } catch (error) {
    console.error('❌ DEFECTIVE STOCK CREATION ERROR:');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Full error:', error);
    
    res.status(400).json({
      success: false,
      message: 'Error creating defective stock item',
      error: error.message,
      details: error.stack
    });
  }
};
