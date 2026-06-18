
import 'dotenv/config';
import { createDatabase } from './server/src/database.js';
import { verifyPassword } from './server/src/passwords.js';

const db = await createDatabase('./data/safety-hazard.sqlite');
const row = db.one('SELECT username, must_change_password, enabled, locked_until, failed_attempts, password_hash FROM users WHERE username = ?', ['admin']);

console.log('=== admin 用户信息 ===');
console.log('用户名:', row.username);
console.log('是否启用:', row.enabled);
console.log('是否需要改密:', row.must_change_password);
console.log('失败次数:', row.failed_attempts);
console.log('锁定至:', row.locked_until || '未锁定');
console.log('密码哈希:', row.password_hash ? row.password_hash.substring(0, 20) + '...' : '无');

// 验证密码
const ok = await verifyPassword('Casia123456!', row.password_hash);
console.log('密码 Casia123456! 验证结果:', ok ? '✅ 匹配' : '❌ 不匹配');

process.exit(0);
