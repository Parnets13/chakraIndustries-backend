import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema({
  author:  { type: String, default: 'Unknown' },
  text:    { type: String, required: true },
}, { timestamps: true });

const taskSchema = new mongoose.Schema({
  taskId:      { type: String, unique: true, required: true },
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  priority:    { type: String, enum: ['Normal', 'High', 'Urgent', 'Low'], default: 'Normal' },
  assignee:    { type: String, default: 'Unassigned' },
  dueDate:     { type: Date },
  tag:         { type: String, default: 'General' },
  module:      { type: String, default: 'General' },
  status: {
    type: String,
    enum: ['todo', 'inProgress', 'done'],
    default: 'todo',
  },
  isRecurring: { type: Boolean, default: false },
  frequency:   { type: String, enum: ['daily', 'weekly', 'monthly', ''], default: '' },
  time:        { type: String, default: '' },
  isDailyTodo: { type: Boolean, default: false },
  done:        { type: Boolean, default: false },
  overdue:     { type: Boolean, default: false },
  comments:    [commentSchema],
}, { timestamps: true });

// Auto-mark overdue on fetch
taskSchema.methods.checkOverdue = function () {
  if (this.dueDate && this.status !== 'done') {
    this.overdue = new Date(this.dueDate) < new Date();
  }
};

export default mongoose.model('Task', taskSchema);
