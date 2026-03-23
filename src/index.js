const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Booking = require('./models/Booking.js');
const Admin = require('./models/Admin.js');

dotenv.config();

const app = express();
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5000',
    'https://role-self-phi.vercel.app',
    'https://role-oybwcx1qw-aman67032s-projects.vercel.app',
    /^https:\/\/role-.*\.vercel\.app$/
  ],
  credentials: true
}));
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

// Valid dates and time slots
const VALID_DATES = ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27'];
const TIME_SLOTS = [
  '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00',
  '14:30', '15:00', '15:30', '16:00', '16:30'
];

// Cached MongoDB connection for serverless
let isConnected = false;
async function connectDB() {
  if (isConnected) return;
  await mongoose.connect(MONGODB_URI);
  isConnected = true;
  console.log('Connected to MongoDB');

  // Ensure default admin user exists
  try {
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash('Ajkiopo', 10);
    await Admin.findOneAndUpdate(
      { username: 'jklu' },
      { username: 'jklu', password: hashedPassword },
      { upsert: true }
    );
    console.log('Admin user verified in DB (with hashed password)');
  } catch (err) {
    console.error('Error verifying admin user:', err);
  }
}

// Middleware to ensure DB connection on every request (for serverless)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('DB connection error:', err);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// Root route
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'EP Slot Booking API' });
});

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
      if (dupErr.code === 11000) {
        return res.status(409).json({ error: 'This slot has already been booked!' });
      }
      throw dupErr;
    }

    return res.status(201).json({ message: 'Slot booked successfully!', date, timeSlot });
  } catch (err) {
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

// Admin Login Route
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ username });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const bcrypt = require('bcryptjs');
    let isMatch = false;
    
    // Fallback: Check if password is mathematically matching the hash, 
    // OR if it exactly matches a leftover plain-text password in the database.
    if (admin.password === password) {
      isMatch = true;
      // Auto-migrate the plain-text password to a secure hash
      admin.password = await bcrypt.hash(password, 10);
      await admin.save();
    } else {
      isMatch = await bcrypt.compare(password, admin.password);
    }

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { id: admin._id, username: admin.username },
      process.env.JWT_SECRET || 'super-secret-key-for-ep-slots',
      { expiresIn: '1d' }
    );

    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ error: 'Login error' });
  }
});

// Admin Bookings Route - Protected
app.get('/api/admin/bookings', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized access' });
    }
    
    const token = authHeader.split(' ')[1];
    const jwt = require('jsonwebtoken');
    
    try {
      jwt.verify(token, process.env.JWT_SECRET || 'super-secret-key-for-ep-slots');
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Fetch all bookings and sort by date then timeSlot
    const bookings = await Booking.find().sort({ date: 1, timeSlot: 1 });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching bookings' });
  }
});

// Admin Export Bookings - CSV
app.get('/api/admin/bookings/export', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized access' });
    }
    
    const token = authHeader.split(' ')[1];
    const jwt = require('jsonwebtoken');
    
    try {
      jwt.verify(token, process.env.JWT_SECRET || 'super-secret-key-for-ep-slots');
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const bookings = await Booking.find().sort({ date: 1, timeSlot: 1 });
    
    // Create CSV header
    let csvContent = 'Date,Time Slot,Name,Phone,JKLU ID,Roll Number,Form Number,Booking Date\n';
    
    // Add rows
    bookings.forEach(b => {
      const row = [
        b.date,
        b.timeSlot,
        `"${b.name.replace(/"/g, '""')}"`,
        `'${b.phone}`, // Added ' to prevent Excel from scientific notation
        b.jkluId,
        b.rollNumber,
        b.formNumber,
        new Date(b.createdAt).toLocaleString()
      ].join(',');
      csvContent += row + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=ep_all_bookings.csv');
    res.status(200).send(csvContent);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Error exporting bookings' });
  }
});

// For local development
if (process.env.NODE_ENV !== 'production') {
  connectDB().then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }).catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
}

// Export for Vercel serverless
module.exports = app;
