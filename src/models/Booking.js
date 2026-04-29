const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  date: { type: String, required: true },
  timeSlot: { type: String, required: true },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  jkluId: { type: String, required: true },
  rollNumber: { type: String, required: true },
  formNumber: { type: String, required: true },
  category: { type: String, enum: ['oh-cores', 'volunteers', 'leaders'], default: 'oh-cores' },
  slotIndex: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// Compound unique index — prevents double-booking at DB level
BookingSchema.index({ date: 1, timeSlot: 1, slotIndex: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('Booking', BookingSchema);
