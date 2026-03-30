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
    'https://role-oybwcx1qw-aman67032s-projects.vercel.app'
  ],
  credentials: true
}));
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

// Valid dates and time slots
const BLOCKED_DATES = ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27','2026-03-28', '2026-03-30', '2026-04-01', '2026-04-02', '2026-04-03' ,'2026-04-04' ];

// Configuration for OH/Cores
const OH_CORES_CONFIG = {
  dates: ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27'],
  slots: [
    '09:30', '10:00', '10:30', '11:00', '11:30',
    '12:00', '12:30', '13:00', '13:30', '14:00',
    '14:30', '15:00', '15:30', '16:00', '16:30'
  ]
};

// Configuration for Volunteers
const VOLUNTEER_CONFIG = {
  dates: ['2026-03-28', '2026-03-30', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-06'],
  // Base slots available on most days
  commonSlots: [
    '09:30', '09:45', '10:00', '10:15', '10:30', '10:45',
    '11:00', // 1 slot at 11:00
    '11:15', '11:30', '11:45', '12:00', '12:15'
  ]
};

// Helper to get all slots for a category and date
function getSlotsForCategory(category, date) {
  if (category === 'volunteers') {
    const slots = [...VOLUNTEER_CONFIG.commonSlots];
    if (date === '2026-03-28') {
      // March 28 specific: 1:30 to 2:45, then 3:00 to 5:15
      slots.push('13:30', '13:45', '14:00', '14:15', '14:30', '14:45');
      slots.push('15:00', '15:15', '15:30', '15:45', '16:00', '16:15', '16:30', '16:45', '17:00', '17:15');
    } else {
      // Other days: 12:30 to 1:45, then 2:30 to 5:15
      slots.push('12:30', '12:45', '13:00', '13:15', '13:30', '13:45');
      slots.push('14:30', '14:45', '15:00', '15:15', '15:30', '15:45', '16:00', '16:15', '16:30', '16:45', '17:00', '17:15');
    }
    // Map slots with instance index for parallel slots
    const counts = {};
    return slots.map(s => {
      counts[s] = (counts[s] || 0) + 1;
      return { timeSlot: s, slotIndex: counts[s] - 1 };
    });
  }
  // Default to OH/Cores
  return OH_CORES_CONFIG.slots.map(s => ({ timeSlot: s, slotIndex: 0 }));
}

function getValidDatesForCategory(category) {
  return category === 'volunteers' ? VOLUNTEER_CONFIG.dates : OH_CORES_CONFIG.dates;
}

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
    
    // Migration: Update existing bookings that don't have a category
    await Booking.updateMany(
      { category: { $exists: false } },
      { $set: { category: 'oh-cores', slotIndex: 0 } }
    );
    console.log('Migrated old bookings to default category');
  } catch (err) {
    console.error('Error during DB startup tasks:', err);
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

// GET /api/slots?date=2026-03-23&category=oh-cores
app.get('/api/slots', async (req, res) => {
  try {
    const { date, category = 'oh-cores' } = req.query;
    const validDates = getValidDatesForCategory(category);
    
    if (!date || !validDates.includes(date)) {
      return res.status(400).json({ error: 'Invalid or missing date parameter' });
    }

    const allSlots = getSlotsForCategory(category, date);
    const bookings = await Booking.find({ date, category }, { timeSlot: 1, slotIndex: 1, _id: 0 });
    
    const bookedSlotKeys = bookings.map(b => `${b.timeSlot}-${b.slotIndex}`);

    return res.json({
      date,
      category,
      allSlots, // Array of { timeSlot, slotIndex }
      bookedSlots: bookings,
      availableSlots: allSlots.filter(s => !bookedSlotKeys.includes(`${s.timeSlot}-${s.slotIndex}`))
    });
  } catch (err) {
    console.error('Error fetching slots:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/book — Atomically books a slot
app.post('/api/book', async (req, res) => {
  try {
    const { date, timeSlot, slotIndex = 0, category = 'oh-cores', name, phone, jkluId, rollNumber, formNumber } = req.body;

    if (!date || !timeSlot || !name || !phone || !jkluId || !rollNumber || !formNumber) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (BLOCKED_DATES.includes(date)) {
      return res.status(403).json({ error: 'Bookings are currently closed for this date' });
    }
    
    const validDates = getValidDatesForCategory(category);
    if (!validDates.includes(date)) {
      return res.status(400).json({ error: 'Invalid date' });
    }
    
    const allSlotsForDay = getSlotsForCategory(category, date);
    const isValidSlot = allSlotsForDay.some(s => s.timeSlot === timeSlot && s.slotIndex === slotIndex);
    if (!isValidSlot) {
      return res.status(400).json({ error: 'Invalid time slot or index' });
    }

    // First check if slot is already booked
    const existing = await Booking.findOne({ date, timeSlot, slotIndex, category });
    if (existing) {
      return res.status(409).json({ error: 'This slot has already been booked!' });
    }

    // Attempt atomic insert
    try {
      await Booking.create({
        date,
        timeSlot,
        slotIndex,
        category,
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

    return res.status(201).json({ message: 'Slot booked successfully!', date, timeSlot, category });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'This slot has already been booked!' });
    }
    console.error('Error booking slot:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dates?category=oh-cores
app.get('/api/dates', (req, res) => {
  const { category = 'oh-cores' } = req.query;
  res.json({ dates: getValidDatesForCategory(category) });
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
    
    // Create CSV header (using let for content appending)
    let csvContent = 'Date,Time Slot,Category,Instance,Name,Phone,JKLU ID,Roll Number,Form Number,Booking Date\n';
    
    // Add rows
    bookings.forEach(b => {
      const row = [
        b.date,
        b.timeSlot,
        b.category || 'oh-cores',
        (b.slotIndex || 0) + 1,
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
