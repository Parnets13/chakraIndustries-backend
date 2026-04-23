import Category from '../models/Category.js';

const DEFAULT_CATEGORIES = [
  'Raw Material', 'Components', 'Bearings', 'Castings',
  'Seals & Gaskets', 'Electrical', 'Packaging', 'Tools & Consumables',
];

// GET /api/categories — seed defaults if empty
export const getCategories = async (req, res) => {
  try {
    let cats = await Category.find().sort({ createdAt: 1 });
    if (cats.length === 0) {
      await Category.insertMany(DEFAULT_CATEGORIES.map(name => ({ name })));
      cats = await Category.find().sort({ createdAt: 1 });
    }
    res.json({ success: true, data: cats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/categories
export const createCategory = async (req, res) => {
  try {
    console.log('📥 POST /api/categories - Request body:', req.body);
    const cat = await Category.create({ name: req.body.name });
    console.log('✅ Category created:', cat);
    res.status(201).json({ success: true, data: cat });
  } catch (err) {
    console.error('❌ Error creating category:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/categories/:id
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined') {
      return res.status(400).json({ success: false, message: 'Invalid category ID' });
    }
    await Category.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
