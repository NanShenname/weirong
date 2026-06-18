import { writeAudit } from './audit.js';
import { hashPassword, validatePassword, verifyPassword } from './passwords.js';
import { sanitizeUser } from './users.js';
import { normalizePhone } from './sms.js';

const LOCK_MINUTES = 15;

const USER_WITH_ORG_SQL = `
  SELECT u.*, o.name as org_name, o.type as org_type
  FROM users u
  LEFT JOIN organizations o ON u.org_id = o.id
`;

export function currentUser(db, req) {
  if (!req.session?.userId) return null;
  const row = db.one(`${USER_WITH_ORG_SQL} WHERE u.id = ? AND u.enabled = 1`, [req.session.userId]);
  return sanitizeUser(row);
}

export function requireAuth(db) {
  return (req, res, next) => {
    const user = currentUser(db, req);
    if (!user) return res.status(401).json({ error: '请先登录' });
    req.user = user;
    next();
  };
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

const SMS_LOGIN_MESSAGE = '如手机号已绑定，验证码已发送';

export function authRoutes(db, smsService) {
  return {
    async login(req, res) {
      const username = String(req.body.username || '').trim();
      const password = String(req.body.password || '');
      const row = db.one(`${USER_WITH_ORG_SQL} WHERE u.username = ?`, [username]);
      const ip = req.ip;

      if (!row || !row.enabled) {
        writeAudit(db, { action: 'LOGIN_FAILED', detail: `unknown:${username}`, ip });
        return res.status(401).json({ error: '账号或密码错误' });
      }

      // 临时禁用锁定检查
      // if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      //   return res.status(423).json({ error: '登录失败次数过多，请稍后再试' });
      // }

      const ok = await verifyPassword(password, row.password_hash);
      if (!ok) {
        // 临时禁用锁定机制，只记录失败次数不锁定
        const attempts = Number(row.failed_attempts || 0) + 1;
        db.run('UPDATE users SET failed_attempts = ?, updated_at = ? WHERE id = ?', [
          attempts,
          new Date().toISOString(),
          row.id
        ]);
        writeAudit(db, { actorUserId: row.id, action: 'LOGIN_FAILED', detail: `attempts:${attempts}`, ip });
        return res.status(401).json({ error: '账号或密码错误' });
      }

      const now = new Date().toISOString();
      db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?', [
        now,
        now,
        row.id
      ]);
      req.session.userId = row.id;
      writeAudit(db, { actorUserId: row.id, action: 'LOGIN_SUCCESS', ip });
      res.json({ user: sanitizeUser({ ...row, failed_attempts: 0, last_login_at: now }) });
    },

    async requestSmsLogin(req, res) {
      const phone = normalizePhone(req.body.phone);
      const ip = req.ip;

      const row = db.one(`${USER_WITH_ORG_SQL} WHERE u.phone = ? AND u.phone_verified = 1 AND u.enabled = 1`, [phone]);
      if (!row) {
        writeAudit(db, { action: 'SMS_LOGIN_REQUEST_IGNORED', detail: phone, ip });
        return res.json({ message: SMS_LOGIN_MESSAGE });
      }
      try {
        await smsService.issueCode({ phone, purpose: 'login', ip });
      } catch (error) {
        return res.status(error.status || 500).json({ error: error.message || '验证码发送失败' });
      }
      writeAudit(db, { actorUserId: row.id, action: 'SMS_LOGIN_REQUESTED', detail: phone, ip });
      res.json({ message: SMS_LOGIN_MESSAGE });
    },

    smsLogin(req, res) {
      const phone = normalizePhone(req.body.phone);
      const code = String(req.body.code || '').trim();

      const row = db.one(`${USER_WITH_ORG_SQL} WHERE u.phone = ? AND u.phone_verified = 1 AND u.enabled = 1`, [phone]);
      if (!row) {
        writeAudit(db, { action: 'SMS_LOGIN_FAILED', detail: phone, ip: req.ip });
        return res.status(401).json({ error: '手机号或验证码错误' });
      }
      try {
        smsService.verifyCode({ phone, code, purpose: 'login' });
      } catch (error) {
        writeAudit(db, { actorUserId: row.id, action: 'SMS_LOGIN_FAILED', detail: phone, ip: req.ip });
        return res.status(error.status || 400).json({ error: error.message || '验证码错误或已过期' });
      }
      const now = new Date().toISOString();
      db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?', [
        now,
        now,
        row.id
      ]);
      req.session.userId = row.id;
      writeAudit(db, { actorUserId: row.id, action: 'SMS_LOGIN_SUCCESS', detail: phone, ip: req.ip });
      res.json({ user: sanitizeUser({ ...row, failed_attempts: 0, last_login_at: now }) });
    },

    me(req, res) {
      res.json({ user: currentUser(db, req) });
    },

    logout(req, res) {
      const actorUserId = req.session?.userId || null;
      req.session.destroy(() => {
        writeAudit(db, { actorUserId, action: 'LOGOUT', ip: req.ip });
        res.clearCookie('sid');
        res.json({ ok: true });
      });
    },

    async changePassword(req, res) {
      const row = db.one(`${USER_WITH_ORG_SQL} WHERE u.id = ?`, [req.session.userId]);
      const currentPassword = String(req.body.currentPassword || '');
      const newPassword = String(req.body.newPassword || '');
      if (!(await verifyPassword(currentPassword, row.password_hash))) {
        return res.status(400).json({ error: '当前密码不正确' });
      }
      const validation = validatePassword(newPassword, row.username);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.errors.join('；') });
      }
      const now = new Date().toISOString();
      db.run('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', [
        await hashPassword(newPassword),
        now,
        row.id
      ]);
      writeAudit(db, { actorUserId: row.id, action: 'PASSWORD_CHANGED', ip: req.ip });
      const updated = db.one(`${USER_WITH_ORG_SQL} WHERE u.id = ?`, [row.id]);
      res.json({ user: sanitizeUser(updated) });
    },

    async requestPhoneBind(req, res) {
      if (req.user.phone && req.user.phoneVerified) {
        return res.status(400).json({ error: '当前账号已绑定手机号，无需再次验证' });
      }
      const phone = normalizePhone(req.body.phone);
      const existing = db.one('SELECT id FROM users WHERE phone = ? AND id != ?', [phone, req.user.id]);
      if (existing) return res.status(409).json({ error: '手机号已被其他用户绑定' });
      try {
        await smsService.issueCode({ phone, purpose: 'bind', ip: req.ip });
      } catch (error) {
        return res.status(error.status || 500).json({ error: error.message || '验证码发送失败' });
      }
      writeAudit(db, { actorUserId: req.user.id, action: 'PHONE_BIND_REQUESTED', detail: phone, ip: req.ip });
      res.json({ message: '验证码已发送' });
    },

    confirmPhoneBind(req, res) {
      if (req.user.phone && req.user.phoneVerified) {
        return res.status(400).json({ error: '当前账号已绑定手机号，无需再次验证' });
      }
      const phone = normalizePhone(req.body.phone);
      const code = String(req.body.code || '').trim();
      const existing = db.one('SELECT id FROM users WHERE phone = ? AND id != ?', [phone, req.user.id]);
      if (existing) return res.status(409).json({ error: '手机号已被其他用户绑定' });
      try {
        smsService.verifyCode({ phone, code, purpose: 'bind' });
        db.run('UPDATE users SET phone = ?, phone_verified = 1, updated_at = ? WHERE id = ?', [
          phone,
          new Date().toISOString(),
          req.user.id
        ]);
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message || '验证码错误或已过期' });
      }
      const updated = db.one(`${USER_WITH_ORG_SQL} WHERE u.id = ?`, [req.user.id]);
      res.json({ user: sanitizeUser(updated) });
    }
  };
}
