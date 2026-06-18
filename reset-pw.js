import 'dotenv/config';
import { createDatabase } from './server/src/database.js';
import { hashPassword } from './server/src/passwords.js';

// 连接你的数据库
const db = await createDatabase(process.env.DATABASE_PATH || './data/safety-hazard.sqlite');

// 生成加密密码（用项目自带函数）
const correctHash = await hashPassword('Casia123456!');

// 写入数据库，同时关闭强制改密
db.run(`UPDATE users SET password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL WHERE username = 'admin'`, [correctHash]);

console.log('✅ 密码重置成功！');
console.log('账号：admin');
console.log('密码：Casia123456!');
process.exit(0);
