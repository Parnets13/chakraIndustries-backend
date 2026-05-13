import PickingList from '../models/PickingList.js';
import InventoryItem from '../models/InventoryItem.js';

// Get picking stats
export const getPickingStats = async (req, res) => {
  try {
    const [total, pending, inProgress, completed] = await Promise.all([
      PickingList.countDocuments(),
      PickingList.countDocuments({ status: 'Pending' }),
      PickingList.countDocuments({ status: 'In Progress' }),
      PickingList.countDocuments({ status: 'Completed' }),
    ]);
    res.json({ success: true, data: { total, pending, inProgress, completed } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

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
    
    // Validate required fields
    if (!orderId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'orderId and items array are required'
      });
    }
    
    // Generate pick ID
    const pickId = `PCK-${String(await PickingList.countDocuments() + 1).padStart(3, '0')}`;
    
    // Enrich items
    const enrichedItems = items.map((item) => {
      return {
        inventory: item.inventoryId || null,
        sku: item.sku || 'N/A',
        itemName: item.itemName || 'Unknown Item',
        quantity: item.quantity || 0,
        location: item.location || 'N/A',
        picked: false
      };
    });
    
    // Create picking list without picker field if not valid
    const pickingListData = {
      pickId,
      orderId,
      items: enrichedItems,
      status: 'Pending'
    };
    
    // Only add picker if it's a valid ObjectId
    if (pickerId && pickerId.match(/^[0-9a-fA-F]{24}$/)) {
      pickingListData.picker = pickerId;
    }
    
    const pickingList = new PickingList(pickingListData);
    await pickingList.save();
    
    res.status(201).json({
      success: true,
      message: 'Picking list created successfully',
      data: pickingList
    });
  } catch (error) {
    console.error('Error creating picking list:', error);
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
