import { createDatabase } from './server/src/database.js';
import { hashPassword, verifyPassword } from './server/src/passwords.js';

const db = await createDatabase(process.env.DATABASE_PATH || './data/safety-hazard.sqlite');

// 先验证当前密码是否正确
const row = db.one('SELECT * FROM users WHERE username = ?', ['admin']);
const testOk = await verifyPassword('Casia123456!', row.password_hash);
console.log('当前密码验证结果:', testOk);

if (!testOk) {
  // 密码不对，重新设置
  const newHash = await hashPassword('Casia123456!');
  db.run('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, must_change_password = 0 WHERE username = ?', [newHash, 'admin']);
  console.log('密码已重新设置');
} else {
  db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE username = ?', ['admin']);
  console.log('密码正确，仅解锁');
}

// 再次验证
const row2 = db.one('SELECT failed_attempts, locked_until FROM users WHERE username = ?', ['admin']);
console.log('失败次数:', row2.failed_attempts);
console.log('锁定至:', row2.locked_until || '未锁定');

// 确保持久化到磁盘
db.persist();
console.log('✅ 账号已解锁并持久化！');

db.close();
