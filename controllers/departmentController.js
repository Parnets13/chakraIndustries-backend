import Department from '../models/Department.js';

const DEFAULTS = ['Production', 'Maintenance', 'Admin', 'Logistics', 'Finance'];

export const getDepartments = async (req, res) => {
  try {
    let depts = await Department.find().sort({ createdAt: 1 });
    if (depts.length === 0) {
      await Department.insertMany(DEFAULTS.map(name => ({ name })));
      depts = await Department.find().sort({ createdAt: 1 });
    }
    res.json({ success: true, data: depts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createDepartment = async (req, res) => {
  try {
    const dept = await Department.create({ name: req.body.name });
    res.status(201).json({ success: true, data: dept });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteDepartment = async (req, res) => {
  try {
    await Department.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
