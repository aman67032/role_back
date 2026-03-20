const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Booking = require('./models/Booking');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

// Valid dates and time slots
const VALID_DATES = ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26'];
const TIME_SLOTS = [
  '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00',
  '14:30', '15:00', '15:30', '16:00', '16:30'
];

// GET /api/slots?date=2026-03-23
app.get('/api/slots', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date || !VALID_DATES.includes(date)) {
      return res.status(400).json({ error: 'Invalid or missing date parameter' });
    }

    const bookings = await Booking.find({ date }, { timeSlot: 1, _id: 0 });
    const bookedSlots = bookings.map(b => b.timeSlot);

    return res.json({
      date,
      allSlots: TIME_SLOTS,
      bookedSlots,
      availableSlots: TIME_SLOTS.filter(s => !bookedSlots.includes(s))
    });
  } catch (err) {
    console.error('Error fetching slots:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/book — Atomically books a slot
app.post('/api/book', async (req, res) => {
  try {
    const { date, timeSlot, name, phone, jkluId, rollNumber, formNumber } = req.body;

    if (!date || !timeSlot || !name || !phone || !jkluId || !rollNumber || !formNumber) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (!VALID_DATES.includes(date)) {
      return res.status(400).json({ error: 'Invalid date' });
    }
    if (!TIME_SLOTS.includes(timeSlot)) {
      return res.status(400).json({ error: 'Invalid time slot' });
    }

    // First check if slot is already booked
    const existing = await Booking.findOne({ date, timeSlot });
    if (existing) {
      return res.status(409).json({ error: 'This slot has already been booked!' });
    }

    // Attempt atomic insert — only succeeds if no duplicate exists (unique index)
    try {
      await Booking.create({
        date,
        timeSlot,
        name,
        phone,
        jkluId,
        rollNumber,
        formNumber
      });
    } catch (dupErr) {
      // Duplicate key error = someone else booked it between our check and insert
      if (dupErr.code === 11000) {
        return res.status(409).json({ error: 'This slot has already been booked!' });
      }
      throw dupErr;
    }

    return res.status(201).json({ message: 'Slot booked successfully!', date, timeSlot });
  } catch (err) {
    // Handle duplicate key error (backup for race condition)
    if (err.code === 11000) {
      return res.status(409).json({ error: 'This slot has already been booked!' });
    }
    console.error('Error booking slot:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dates
app.get('/api/dates', (_req, res) => {
  res.json({ dates: VALID_DATES });
});

// Connect to MongoDB and start server
mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
