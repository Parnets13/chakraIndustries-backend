import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
  taskId:    { type: String, unique: true, required: true },
  title:     { type: String, required: true },
  priority:  { type: String, enum: ['Normal', 'High', 'Urgent'], default: 'Normal' },
  assignee:  { type: String, default: 'Unassigned' },
  dueDate:   { type: Date },
  tag:       { type: String, default: 'General' },
  module:    { type: String, default: 'General' },
  status: {
    type: String,
    enum: ['todo', 'inProgress', 'done'],
    default: 'todo',
  },
  isRecurring: { type: Boolean, default: false },
  frequency:   { type: String, default: '' },
  time:        { type: String, default: '' },
  isDailyTodo: { type: Boolean, default: false },
  done:        { type: Boolean, default: false },
  overdue:     { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model('Task', taskSchema);
