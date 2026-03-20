import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Booking from './models/Booking';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI!;

// Valid dates and time slots
const VALID_DATES = ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26'];
const TIME_SLOTS = [
  '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00',
  '14:30', '15:00', '15:30', '16:00', '16:30'
];

// GET /api/slots?date=2026-03-23
// Returns list of booked time slots for that date
app.get('/api/slots', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date || typeof date !== 'string' || !VALID_DATES.includes(date)) {
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

// POST /api/book
// Atomically books a slot — prevents race conditions
app.post('/api/book', async (req, res) => {
  try {
    const { date, timeSlot, name, phone, jkluId, rollNumber, formNumber } = req.body;

    // Validation
    if (!date || !timeSlot || !name || !phone || !jkluId || !rollNumber || !formNumber) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (!VALID_DATES.includes(date)) {
      return res.status(400).json({ error: 'Invalid date' });
    }
    if (!TIME_SLOTS.includes(timeSlot)) {
      return res.status(400).json({ error: 'Invalid time slot' });
    }

    // Atomic upsert — only the FIRST request wins
    // findOneAndUpdate with upsert + setOnInsert ensures atomicity
    const result = await Booking.findOneAndUpdate(
      { date, timeSlot },                       // filter: look for existing booking
      {
        $setOnInsert: {                          // only set these if inserting (not updating)
          date,
          timeSlot,
          name,
          phone,
          jkluId,
          rollNumber,
          formNumber,
          createdAt: new Date()
        }
      },
      {
        upsert: true,                            // create if doesn't exist
        new: false,                              // return the OLD document (null if newly inserted)
        rawResult: true
      }
    );

    // If the document existed before our upsert, the slot was already taken
    if (result.lastErrorObject && !result.lastErrorObject.updatedExisting === false) {
      // Check if it was a new insert or existing
      if (result.value && !result.lastErrorObject.upserted) {
        return res.status(409).json({ error: 'This slot has already been booked!' });
      }
    }

    // Double check: if rawResult shows it was NOT an upsert (doc already existed)
    if (result.lastErrorObject && result.lastErrorObject.updatedExisting) {
      return res.status(409).json({ error: 'This slot has already been booked!' });
    }

    return res.status(201).json({ message: 'Slot booked successfully!', date, timeSlot });
  } catch (err: any) {
    // Handle duplicate key error (backup for race condition)
    if (err.code === 11000) {
      return res.status(409).json({ error: 'This slot has already been booked!' });
    }
    console.error('Error booking slot:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dates — returns available dates
app.get('/api/dates', (_req, res) => {
  res.json({ dates: VALID_DATES });
});

// Connect to MongoDB and start server
mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
