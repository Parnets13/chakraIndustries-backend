import BOM from '../models/BOM.js';
import ItemMaster from '../models/ItemMaster.js';
import Inventory from '../models/Inventory.js';

// Get all raw materials for BOM dropdown - from Inventory stock table
export const getRawMaterials = async (req, res) => {
  try {
    // Get unique materials from Inventory (stock table) with active status
    const inventoryMaterials = await Inventory.find({
      status: { $ne: 'Dead' }
    })
    .select('_id itemMasterId sku name unit availableQuantity')
    .populate('itemMasterId', '_id costPrice')
    .lean();

    // Group by itemMasterId to get unique materials
    const uniqueMaterials = {};
    inventoryMaterials.forEach(inv => {
      const key = inv.itemMasterId?._id || inv._id;
      if (!uniqueMaterials[key]) {
        uniqueMaterials[key] = {
          _id: inv.itemMasterId?._id || inv._id,
          sku: inv.sku,
          name: inv.name,
          unit: inv.unit,
          costPrice: inv.itemMasterId?.costPrice || 0,
          availableStock: inv.availableQuantity
        };
      }
    });

    // If no inventory materials, fallback to ItemMaster
    let materials = Object.values(uniqueMaterials);
    if (materials.length === 0) {
      const itemMasterMaterials = await ItemMaster.find({
        status: 'Active',
        isActive: true
      }).select('_id itemId sku name unit costPrice');

      materials = itemMasterMaterials.map(m => ({
        _id: m._id,
        itemId: m.itemId,
        sku: m.sku,
        name: m.name,
        unit: m.unit,
        costPrice: m.costPrice,
        availableStock: 0
      }));
    }

    res.json({
      success: true,
      data: materials
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get material details with inventory stock
export const getMaterialWithStock = async (req, res) => {
  try {
    const { materialId } = req.params;

    // First try to get from ItemMaster
    const material = await ItemMaster.findById(materialId);
    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    // Get available stock from inventory
    const inventory = await Inventory.find({
      itemMasterId: materialId,
      status: { $ne: 'Dead' }
    });

    const totalStock = inventory.reduce((sum, inv) => sum + inv.availableQuantity, 0);

    // Get material name from inventory if available, otherwise from ItemMaster
    let materialName = material.name;
    let materialSku = material.sku;
    if (inventory.length > 0) {
      materialName = inventory[0].name || material.name;
      materialSku = inventory[0].sku || material.sku;
    }

    res.json({
      success: true,
      data: {
        _id: material._id,
        itemId: material.itemId,
        sku: materialSku,
        name: materialName,
        unit: material.unit,
        costPrice: material.costPrice,
        availableStock: totalStock,
        inventoryDetails: inventory.map(inv => ({
          warehouse: inv.warehouse,
          available: inv.availableQuantity,
          total: inv.totalQuantity
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create BOM with materials
export const createBOM = async (req, res) => {
  try {
    const { projectId, product, version, type, uom, description, materials } = req.body;

    // Validate required fields
    if (!projectId || !product || !materials || materials.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'projectId, product, and materials are required'
      });
    }

    // Check for duplicate materials
    const materialIds = materials.map(m => m.materialId);
    if (new Set(materialIds).size !== materialIds.length) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate materials not allowed'
      });
    }

    // Validate quantities
    for (const material of materials) {
      if (!material.quantity || material.quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: 'All materials must have quantity greater than zero'
        });
      }
    }

    // Fetch material details and calculate costs
    const enrichedMaterials = [];
    let totalCost = 0;

    for (const material of materials) {
      const itemMaster = await ItemMaster.findById(material.materialId);
      if (!itemMaster) {
        return res.status(404).json({
          success: false,
          message: `Material ${material.materialId} not found`
        });
      }

      // Get available stock
      const inventory = await Inventory.find({
        itemMasterId: material.materialId,
        status: { $ne: 'Dead' }
      });
      const availableStock = inventory.reduce((sum, inv) => sum + inv.availableQuantity, 0);

      const materialCost = material.quantity * (itemMaster.costPrice || 0);
      totalCost += materialCost;

      enrichedMaterials.push({
        materialId: material.materialId,
        materialName: itemMaster.name,
        sku: itemMaster.sku,
        quantity: material.quantity,
        unit: material.unit || itemMaster.unit,
        availableStock,
        costPrice: itemMaster.costPrice,
        totalCost: materialCost
      });
    }

    // Create BOM
    const bom = new BOM({
      projectId,
      product,
      version: version || 'v1.0',
      type: type || 'Finished Good',
      uom: uom || 'Set',
      description,
      materials: enrichedMaterials,
      totalMaterialCost: totalCost,
      status: 'Active'
    });

    const saved = await bom.save();
    const populated = await BOM.findById(saved._id).populate('materials.materialId', 'name sku unit');

    res.status(201).json({
      success: true,
      message: 'BOM created successfully',
      data: populated
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Get all BOMs
export const getBOMs = async (req, res) => {
  try {
    const boms = await BOM.find()
      .populate('materials.materialId', 'name sku unit costPrice')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: boms });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get BOM by ID
export const getBOMById = async (req, res) => {
  try {
    const bom = await BOM.findById(req.params.id)
      .populate('materials.materialId', 'name sku unit costPrice');

    if (!bom) {
      return res.status(404).json({ success: false, message: 'BOM not found' });
    }

    res.json({ success: true, data: bom });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update BOM
export const updateBOM = async (req, res) => {
  try {
    const { materials, ...updateData } = req.body;

    // If materials are being updated, validate them
    if (materials && materials.length > 0) {
      // Check for duplicates
      const materialIds = materials.map(m => m.materialId);
      if (new Set(materialIds).size !== materialIds.length) {
        return res.status(400).json({
          success: false,
          message: 'Duplicate materials not allowed'
        });
      }

      // Validate quantities
      for (const material of materials) {
        if (!material.quantity || material.quantity <= 0) {
          return res.status(400).json({
            success: false,
            message: 'All materials must have quantity greater than zero'
          });
        }
      }

      // Enrich materials with details
      const enrichedMaterials = [];
      let totalCost = 0;

      for (const material of materials) {
        const itemMaster = await ItemMaster.findById(material.materialId);
        if (!itemMaster) {
          return res.status(404).json({
            success: false,
            message: `Material ${material.materialId} not found`
          });
        }

        const inventory = await Inventory.find({
          itemMasterId: material.materialId,
          status: { $ne: 'Dead' }
        });
        const availableStock = inventory.reduce((sum, inv) => sum + inv.availableQuantity, 0);

        const materialCost = material.quantity * (itemMaster.costPrice || 0);
        totalCost += materialCost;

        enrichedMaterials.push({
          materialId: material.materialId,
          materialName: itemMaster.name,
          sku: itemMaster.sku,
          quantity: material.quantity,
          unit: material.unit || itemMaster.unit,
          availableStock,
          costPrice: itemMaster.costPrice,
          totalCost: materialCost
        });
      }

      updateData.materials = enrichedMaterials;
      updateData.totalMaterialCost = totalCost;
    }

    updateData.updatedAt = new Date();

    const bom = await BOM.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true
    }).populate('materials.materialId', 'name sku unit costPrice');

    if (!bom) {
      return res.status(404).json({ success: false, message: 'BOM not found' });
    }

    res.json({ success: true, message: 'BOM updated successfully', data: bom });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Delete BOM
export const deleteBOM = async (req, res) => {
  try {
    const bom = await BOM.findByIdAndDelete(req.params.id);
    if (!bom) {
      return res.status(404).json({ success: false, message: 'BOM not found' });
    }

    res.json({ success: true, message: 'BOM deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get BOM by project ID
export const getBOMByProjectId = async (req, res) => {
  try {
    const { projectId } = req.params;
    const bom = await BOM.findOne({ projectId })
      .populate('materials.materialId', 'name sku unit costPrice');

    if (!bom) {
      return res.status(404).json({ success: false, message: 'BOM not found for this project' });
    }

    res.json({ success: true, data: bom });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Validate material availability for BOM
export const validateMaterialAvailability = async (req, res) => {
  try {
    const { materials } = req.body;

    if (!materials || materials.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Materials array is required'
      });
    }

    const validation = [];
    let allAvailable = true;

    for (const material of materials) {
      const inventory = await Inventory.find({
        itemMasterId: material.materialId,
        status: { $ne: 'Dead' }
      });

      const totalStock = inventory.reduce((sum, inv) => sum + inv.availableQuantity, 0);
      const isAvailable = totalStock >= material.quantity;

      if (!isAvailable) {
        allAvailable = false;
      }

      validation.push({
        materialId: material.materialId,
        requiredQuantity: material.quantity,
        availableQuantity: totalStock,
        isAvailable,
        shortfall: Math.max(0, material.quantity - totalStock)
      });
    }

    res.json({
      success: true,
      data: {
        allAvailable,
        materials: validation
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
