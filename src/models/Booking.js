const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  date: { type: String, required: true },
  timeSlot: { type: String, required: true },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  jkluId: { type: String, required: true },
  rollNumber: { type: String, required: true },
  formNumber: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Compound unique index — prevents double-booking at DB level
BookingSchema.index({ date: 1, timeSlot: 1 }, { unique: true });

module.exports = mongoose.model('Booking', BookingSchema);
