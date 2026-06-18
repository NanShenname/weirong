import crypto, { randomUUID } from 'node:crypto';

export const PHONE_RE = /^1[3-9]\d{9}$/;
const MAX_ATTEMPTS = 5;

export function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '').trim();
}

export function validatePhone(phone) {
  return PHONE_RE.test(phone);
}

function hashCode(code, secret) {
  return crypto.createHash('sha256').update(`${secret}:${code}`).digest('hex');
}

export class LogSmsProvider {
  async send({ phone, code, purpose }) {
    console.log(`[SMS:${purpose}] ${phone} 验证码：${code}`);
  }
}

export function createSmsService(db, {
  provider = new LogSmsProvider(),
  ttlSeconds = 300,
  resendSeconds = 60,
  secret = 'sms-code-secret'
} = {}) {
  function ensurePhone(phone) {
    if (!validatePhone(phone)) {
      const error = new Error('请输入有效的中国大陆手机号');
      error.status = 400;
      throw error;
    }
  }

  function getRecent(phone, purpose) {
    const since = new Date(Date.now() - resendSeconds * 1000).toISOString();
    return db.one(
      `SELECT * FROM sms_codes
       WHERE phone = ? AND purpose = ? AND created_at > ? AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [phone, purpose, since]
    );
  }

  async function issueCode({ phone, purpose, ip }) {
    ensurePhone(phone);
    if (getRecent(phone, purpose)) {
      const error = new Error('验证码发送过于频繁，请稍后再试');
      error.status = 429;
      throw error;
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const now = new Date();
    db.run(
      `INSERT INTO sms_codes
       (id, phone, code_hash, purpose, expires_at, request_ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        phone,
        hashCode(code, secret),
        purpose,
        new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
        ip || '',
        now.toISOString()
      ]
    );
    await provider.send({ phone, code, purpose });
    return { ok: true };
  }

  function verifyCode({ phone, code, purpose }) {
    ensurePhone(phone);
    const value = String(code || '').trim();
    if (!/^\d{6}$/.test(value)) {
      const error = new Error('验证码错误或已过期');
      error.status = 400;
      throw error;
    }

    const row = db.one(
      `SELECT * FROM sms_codes
       WHERE phone = ? AND purpose = ? AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [phone, purpose]
    );
    if (!row || row.expires_at < new Date().toISOString() || Number(row.attempts || 0) >= MAX_ATTEMPTS) {
      const error = new Error('验证码错误或已过期');
      error.status = 400;
      throw error;
    }

    const matches = row.code_hash === hashCode(value, secret);
    if (!matches) {
      db.run('UPDATE sms_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
      const error = new Error('验证码错误或已过期');
      error.status = 400;
      throw error;
    }

    db.run('UPDATE sms_codes SET used_at = ?, attempts = attempts + 1 WHERE id = ?', [
      new Date().toISOString(),
      row.id
    ]);
    return true;
  }

  return { issueCode, verifyCode };
}
