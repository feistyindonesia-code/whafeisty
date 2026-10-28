import { pool } from '../src/services/database/connection';
import { UserModel } from '../src/services/database/models';

async function createSuperAdmin() {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  const name = process.env.SUPERADMIN_NAME || 'Super Admin';

  if (!email || !password || password.length < 12) {
    throw new Error('Set SUPERADMIN_EMAIL and a SUPERADMIN_PASSWORD of at least 12 characters');
  }

  const existing = await UserModel.findByEmail(email);
  if (existing) {
    console.log('SuperAdmin already exists');
    return;
  }

  const user = await UserModel.create(email, password, 'superadmin', name);
  console.log(`SuperAdmin created: ${user.email}`);
}

createSuperAdmin()
  .catch((error) => {
    console.error('Failed to create SuperAdmin:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
