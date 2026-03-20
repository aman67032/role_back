import mongoose, { Schema, Document } from 'mongoose';

export interface IBooking extends Document {
  date: string;       // e.g. "2026-03-23"
  timeSlot: string;   // e.g. "09:30"
  name: string;
  phone: string;
  jkluId: string;
  rollNumber: string;
  formNumber: string;
  createdAt: Date;
}

const BookingSchema = new Schema<IBooking>({
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

export default mongoose.model<IBooking>('Booking', BookingSchema);
