// Run this once to create your admin login: npm run create-admin
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const Admin = require('../models/Admin');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.\n');

    const username = await ask('Choose an admin username: ');
    const password = await ask('Choose an admin password: ');

    const existing = await Admin.findOne({ username });
    if (existing) {
      console.log('\n⚠️  That username already exists. Delete it in MongoDB first if you want to reset it.');
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await Admin.create({ username, password: hashedPassword });

    console.log('\n✅ Admin account created! You can now log in at /admin with that username and password.');
    process.exit(0);
  } catch (err) {
    console.error('Error creating admin:', err.message);
    process.exit(1);
  }
}

run();
