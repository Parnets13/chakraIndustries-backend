import PickingList from '../models/PickingList.js';
import Inventory from '../models/Inventory.js';

// Get all picking lists
export const getAllPickingLists = async (req, res) => {
  try {
    const { status } = req.query;
    
    let query = {};
    
    if (status && status !== 'All') {
      query.status = status;
    }
    
    const pickingLists = await PickingList.find(query)
      .populate('items.inventory', 'sku name warehouse')
      .populate('picker', 'name email')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: pickingLists
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching picking lists',
      error: error.message
    });
  }
};

// Get single picking list
export const getPickingListById = async (req, res) => {
  try {
    const pickingList = await PickingList.findById(req.params.id)
      .populate('items.inventory', 'sku name warehouse location')
      .populate('picker', 'name email');
    
    if (!pickingList) {
      return res.status(404).json({
        success: false,
        message: 'Picking list not found'
      });
    }
    
    res.json({
      success: true,
      data: pickingList
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching picking list',
      error: error.message
    });
  }
};

// Create picking list
export const createPickingList = async (req, res) => {
  try {
    const { orderId, items, pickerId } = req.body;
    
    // Generate pick ID
    const pickId = `PCK-${String(await PickingList.countDocuments() + 1).padStart(3, '0')}`;
    
    // Validate and enrich items
    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const inventory = await Inventory.findById(item.inventoryId);
        if (!inventory) {
          throw new Error(`Inventory item ${item.inventoryId} not found`);
        }
        
        if (inventory.quantity < item.quantity) {
          throw new Error(`Insufficient stock for ${inventory.sku}`);
        }
        
        return {
          inventory: item.inventoryId,
          sku: inventory.sku,
          itemName: inventory.name,
          quantity: item.quantity,
          location: item.location || `${inventory.location?.zone || 'N/A'} / ${inventory.location?.rack || 'N/A'}`,
          picked: false
        };
      })
    );
    
    const pickingList = new PickingList({
      pickId,
      orderId,
      items: enrichedItems,
      picker: pickerId,
      status: 'Pending'
    });
    
    await pickingList.save();
    
    res.status(201).json({
      success: true,
      message: 'Picking list created successfully',
      data: pickingList
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating picking list',
      error: error.message
    });
  }
};

// Update picking list
export const updatePickingList = async (req, res) => {
  try {
    const pickingList = await PickingList.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!pickingList) {
      return res.status(404).json({
        success: false,
        message: 'Picking list not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Picking list updated successfully',
      data: pickingList
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error updating picking list',
      error: error.message
    });
  }
};

// Mark item as picked
export const markItemPicked = async (req, res) => {
  try {
    const { itemId } = req.params;
    
    const pickingList = await PickingList.findById(req.params.id);
    
    if (!pickingList) {
      return res.status(404).json({
        success: false,
        message: 'Picking list not found'
      });
    }
    
    const item = pickingList.items.id(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in picking list'
      });
    }
    
    item.picked = true;
    
    // Check if all items are picked
    const allPicked = pickingList.items.every(i => i.picked);
    if (allPicked) {
      pickingList.status = 'Completed';
    } else if (pickingList.status === 'Pending') {
      pickingList.status = 'In Progress';
    }
    
    await pickingList.save();
    
    res.json({
      success: true,
      message: 'Item marked as picked',
      data: pickingList
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error marking item as picked',
      error: error.message
    });
  }
};

// Delete picking list
export const deletePickingList = async (req, res) => {
  try {
    const pickingList = await PickingList.findByIdAndDelete(req.params.id);
    
    if (!pickingList) {
      return res.status(404).json({
        success: false,
        message: 'Picking list not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Picking list deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting picking list',
      error: error.message
    });
  }
};
