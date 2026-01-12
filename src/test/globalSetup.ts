import { execSync } from 'child_process';
import * as dotenv from 'dotenv';

export default async function globalSetup() {
  // Load environment variables
  dotenv.config();

  // Set NODE_ENV to test
  process.env.NODE_ENV = 'test';

  // Use test database URL
  const testDbUrl = process.env.TEST_DATABASE_URL || 
    'postgresql://postgres:postgres@localhost:5432/library_inventory_test?schema=public';
  
  process.env.DATABASE_URL = testDbUrl;

  console.log('Setting up test database...');

  try {
    // Drop and recreate test database
    execSync('npx prisma migrate reset --force --skip-seed', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: testDbUrl }
    });

    // Run migrations
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: testDbUrl }
    });

    // Generate Prisma client
    execSync('npx prisma generate', {
      stdio: 'inherit'
    });

    console.log('Test database setup complete!');
  } catch (error) {
    console.error('Failed to setup test database:', error);
    throw error;
  }
}
