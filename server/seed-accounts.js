import 'dotenv/config';
import mongoose from 'mongoose';
import { hash } from './utils/password.js';
import { connectDB } from './config/database.js';
import User from './models/User.js';
import { seedStages } from './seed.js';

// حسابات تجربة (تُنشأ أو تُحدَّث عند كل تشغيل). غيّر كلمات المرور أو احذف الحسابات قبل أي استخدام حقيقي.
const ACCOUNTS = [
  { fullName: 'مدير النظام',      username: 'admin',      email: 'admin@jasad.local',      password: 'Admin@Jasad2026',   roles: ['ADMIN'],      stageId: null },
  { fullName: 'أمين مرحلة تجريبي', username: 'supervisor', email: 'supervisor@jasad.local', password: 'Super@Jasad2026',   roles: ['SUPERVISOR'], stageId: 4 },
  { fullName: 'خادم تجريبي',       username: 'servant',    email: 'servant@jasad.local',    password: 'Servant@Jasad2026', roles: ['SERVANT'],    stageId: 4 },
  { fullName: 'مشرف مساعد تجريبي', username: 'assistant',  email: 'assistant@jasad.local',  password: 'Assist@Jasad2026',  roles: ['ASSISTANT'],  stageId: 4 },
  { fullName: 'خادم ثاني تجريبي',  username: 'servant2',   email: 'servant2@jasad.local',   password: 'Servant@Jasad2026', roles: ['SERVANT'],    stageId: 4 },
  { fullName: 'خادم الغياب',       username: 'attendance', email: 'attendance@jasad.local', password: 'Attend@Jasad2026',  roles: ['ATTENDANCE'], stageId: null },
  { fullName: 'خادم المخزن',       username: 'storekeeper', email: 'storekeeper@jasad.local', password: 'Store@Jasad2026',  roles: ['STOREKEEPER'], stageId: null }
];

try {
  await connectDB();
  await seedStages();

  for (const a of ACCOUNTS) {
    await User.updateOne(
      { username: a.username },
      {
        $set: {
          fullName: a.fullName,
          email: a.email,
          passwordHash: hash(a.password),
          status: 'ACTIVE',
          roles: a.roles,
          stageId: a.stageId
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
    console.log(`OK  ${a.username.padEnd(12)} | ${a.password.padEnd(18)} | ${a.roles.join(',')}`);
  }
} catch (error) {
  console.error('Seed accounts failed:', error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
