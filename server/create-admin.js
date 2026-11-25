
import 'dotenv/config';
import mongoose from 'mongoose';
import { hash } from './utils/password.js';
import { connectDB } from './config/database.js';
import User from './models/User.js';
import { seedStages } from './seed.js';

async function createAdmin() {
  try {
    const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_PASSWORD } =
      process.env;

    if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        'Set ADMIN_NAME, ADMIN_EMAIL, ADMIN_USERNAME and ADMIN_PASSWORD in .env first.'
      );
    }

    if (ADMIN_PASSWORD.length < 8) {
      throw new Error('Admin password must be at least 8 characters.');
    }

    await connectDB();
    await seedStages();

    const email = ADMIN_EMAIL.trim().toLowerCase();
    const username = ADMIN_USERNAME.trim().toLowerCase();

    const existing = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existing) {
      throw new Error(
        'An account with this email or username already exists. No account was changed.'
      );
    }

    await User.create({
      fullName: ADMIN_NAME.trim(),
      email,
      username,
      passwordHash: hash(ADMIN_PASSWORD),
      status: 'ACTIVE',
      roles: ['ADMIN'],
      stageId: null,
    });

    console.log('تم إنشاء حساب أمين الخدمة بنجاح.');
    console.log(`Email: ${email}`);
    console.log(`Username: ${username}`);
  } catch (error) {
    console.error('Admin setup failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

await createAdmin();
