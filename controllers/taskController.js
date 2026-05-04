import Task from '../models/Task.js';

const genTaskId = async () => {
  const last = await Task.findOne().sort({ createdAt: -1 });
  if (!last) return 'T-001';
  const num = parseInt(last.taskId.replace('T-', '')) || 0;
  return `T-${String(num + 1).padStart(3, '0')}`;
};

// Mark overdue on a list of tasks (mutates + saves)
const markOverdue = async (tasks) => {
  const now = new Date();
  const updates = tasks.filter(t => t.dueDate && t.status !== 'done' && new Date(t.dueDate) < now && !t.overdue);
  if (updates.length) {
    await Task.updateMany(
      { _id: { $in: updates.map(t => t._id) } },
      { $set: { overdue: true } }
    );
    updates.forEach(t => { t.overdue = true; });
  }
};

export const getAll = async (req, res) => {
  try {
    const { status, isDailyTodo, isRecurring, tag, priority, assignee, search } = req.query;
    const filter = {};
    if (status)                        filter.status = status;
    if (isDailyTodo !== undefined)     filter.isDailyTodo = isDailyTodo === 'true';
    if (isRecurring !== undefined)     filter.isRecurring = isRecurring === 'true';
    if (tag)                           filter.tag = tag;
    if (priority)                      filter.priority = priority;
    if (assignee)                      filter.assignee = new RegExp(assignee, 'i');
    if (search)                        filter.title = new RegExp(search, 'i');

    const tasks = await Task.find(filter).sort({ createdAt: -1 });
    await markOverdue(tasks);
    res.json({ success: true, data: tasks });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const getById = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: task });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const create = async (req, res) => {
  try {
    const taskId = await genTaskId();
    const task = await Task.create({ ...req.body, taskId });
    res.status(201).json({ success: true, data: task });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const update = async (req, res) => {
  try {
    // Prevent overwriting taskId or comments via this endpoint
    const { taskId, comments, ...updateData } = req.body;
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
    if (!task) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: task });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateStatus = async (req, res) => {
  try {
    const updateFields = { status: req.body.status };
    if (req.body.status === 'done') updateFields.done = true;
    if (req.body.status !== 'done') updateFields.overdue = false;
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true }
    );
    if (!task) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: task });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const addComment = async (req, res) => {
  try {
    const { text, author } = req.body;
    if (!text) return res.status(400).json({ success: false, message: 'Comment text required' });
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      { $push: { comments: { text, author: author || 'Unknown' } } },
      { new: true }
    );
    if (!task) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: task });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const deleteComment = async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      { $pull: { comments: { _id: req.params.commentId } } },
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

// Bulk operations
export const bulkUpdateStatus = async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!ids?.length || !status) return res.status(400).json({ success: false, message: 'ids and status required' });
    await Task.updateMany({ _id: { $in: ids } }, { $set: { status, done: status === 'done' } });
    res.json({ success: true, message: `${ids.length} tasks updated` });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const bulkDelete = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ success: false, message: 'ids required' });
    await Task.deleteMany({ _id: { $in: ids } });
    res.json({ success: true, message: `${ids.length} tasks deleted` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
