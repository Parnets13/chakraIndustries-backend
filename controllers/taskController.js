import Task from '../models/Task.js';

const genTaskId = async () => {
  const last = await Task.findOne().sort({ createdAt: -1 });
  if (!last) return 'T-001';
  const num = parseInt(last.taskId.replace('T-', '')) || 0;
  return `T-${String(num + 1).padStart(3, '0')}`;
};

export const getAll = async (req, res) => {
  try {
    const { status, isDailyTodo, isRecurring } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (isDailyTodo !== undefined) filter.isDailyTodo = isDailyTodo === 'true';
    if (isRecurring !== undefined) filter.isRecurring = isRecurring === 'true';
    const tasks = await Task.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: tasks });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const create = async (req, res) => {
  try {
    const taskId = await genTaskId();
    const task = await Task.create({ ...req.body, taskId });
    res.status(201).json({ success: true, data: task });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateStatus = async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status, done: req.body.done },
      { new: true }
    );
    if (!task) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: task });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const remove = async (req, res) => {
  try {
    await Task.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
