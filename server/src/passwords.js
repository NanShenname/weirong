import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const SPECIAL_RE = /[^A-Za-z0-9]/;

export function validatePassword(password, username = '') {
  const errors = [];
  if (!password || password.length < 12) errors.push('密码至少 12 位');
  if (!/[a-z]/.test(password)) errors.push('需要包含小写字母');
  if (!/[A-Z]/.test(password)) errors.push('需要包含大写字母');
  if (!/[0-9]/.test(password)) errors.push('需要包含数字');
  if (!SPECIAL_RE.test(password)) errors.push('需要包含特殊字符');
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    errors.push('密码不能包含用户名');
  }
  return { valid: errors.length === 0, errors };
}

export function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const special = '!@#$%^&*()-_=+';
  const bytes = crypto.randomBytes(18);
  let text = 'Aa1!';
  for (const byte of bytes) {
    text += (alphabet + special)[byte % (alphabet.length + special.length)];
  }
  return text.slice(0, 18);
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}
