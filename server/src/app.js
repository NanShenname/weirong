import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { createDatabase } from './database.js';
import { authRoutes, currentUser, requireAdmin, requireAuth } from './auth.js';
import { writeAudit } from './audit.js';
import { hashPassword, validatePassword, generateTemporaryPassword } from './passwords.js';
import { sanitizeUser, seedDefaultUsers } from './users.js';
import { BailianProvider } from './ai/bailianProvider.js';
import { LogSmsProvider, createSmsService, normalizePhone, validatePhone } from './sms.js';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const HAZARD_LABELS = [
  '超速行驶',
  '分心驾驶',
  '超载运输',
  '不规范变道',
  '瓶颈路段',
  '用电隐患',
  '材料堆放',
  '道路施工',
  '滑塌风险'
];
const HAZARD_LABEL_SET = new Set(HAZARD_LABELS);

function toBool(value) {
  return value ? 1 : 0;
}

function parseHazardLabels(value) {
  let labels = [];
  if (Array.isArray(value)) {
    labels = value;
  } else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      labels = Array.isArray(parsed) ? parsed : value.split(/[、,，]/);
    } catch {
      labels = value.split(/[、,，]/);
    }
  }
  return [...new Set(labels.map((label) => String(label).trim()).filter((label) => HAZARD_LABEL_SET.has(label)))];
}

function stringifyHazardLabels(value) {
  return JSON.stringify(parseHazardLabels(value));
}

function mapInspection(row, index = 0) {
  const hazardLabels = parseHazardLabels(row.hazard_labels);
  return {
    id: row.id,
    sequence: index + 1,
    date: row.date,
    inspector: row.inspector || '',
    imageUrl: row.image_url,
    hazardLabels,
    hazardDescription: row.hazard_description,
    rectificationSuggestion: row.rectification_suggestion,
    status: row.status,
    modelName: row.model_name || '',
    ownerUserId: row.owner_user_id,
    orgId: row.org_id || '',
    orgName: row.org_name || '',
    sourceOrgId: row.source_org_id || '',
    sourceOrgName: row.source_org_name || '',
    assignedToOrgId: row.assigned_to_org_id || '',
    assignedToOrgName: row.assigned_to_org_name || '',
    // 隐患治理阶段
    rectificationDate: row.rectification_date || '',
    rectificationMeasure: row.rectification_measure || '',
    rectificationResponsiblePerson: row.rectification_responsible_person || '',
    rectificationImageUrl: row.rectification_image_url || '',
    // 验收阶段
    acceptanceDate: row.acceptance_date || '',
    acceptanceResult: row.acceptance_result || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recordText: `${hazardLabels.length ? `隐患类型：${hazardLabels.join('、')}\n` : ''}${row.hazard_description}\n整改建议：${row.rectification_suggestion}`
  };
}

function parseEnvOptions(options = {}) {
  return {
    databasePath: options.databasePath || process.env.DATABASE_PATH || './data/safety-hazard.sqlite',
    uploadDir: options.uploadDir || process.env.UPLOAD_DIR || './uploads',
    sessionSecret: options.sessionSecret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    maxUploadMb: Number(options.maxUploadMb || process.env.MAX_UPLOAD_MB || 8),
    seedUsers: options.seedUsers,
    aiProvider: options.aiProvider || new BailianProvider(process.env),
    smsProvider: options.smsProvider || new LogSmsProvider(),
    smsCodeTtlSeconds: Number(options.smsCodeTtlSeconds || process.env.SMS_CODE_TTL_SECONDS || 300),
    smsResendSeconds: Number(options.smsResendSeconds || process.env.SMS_RESEND_SECONDS || 60)
  };
}

export async function createApp(options = {}) {
  const config = parseEnvOptions(options);
  const db = await createDatabase(config.databasePath);
  const smsService = createSmsService(db, {
    provider: config.smsProvider,
    ttlSeconds: config.smsCodeTtlSeconds,
    resendSeconds: config.smsResendSeconds,
    secret: config.sessionSecret
  });
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const generatedUsers = await seedDefaultUsers(db, config.seedUsers);

  if (generatedUsers.length && !options.seedUsers) {
    console.log('首次启动已生成默认账号临时密码，请登录后立即修改：');
    for (const user of generatedUsers) {
      console.log(`${user.username} (${user.role}): ${user.temporaryPassword}`);
    }
  }

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '.png';
      cb(null, `${Date.now()}-${randomUUID()}${ext}`);
    }
  });
  const upload = multer({
    storage,
    limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!IMAGE_TYPES.has(file.mimetype)) return cb(new Error('仅支持 PNG、JPG、WEBP 图片'));
      cb(null, true);
    }
  });

  const app = express();
  app.locals.db = db;
  app.locals.generatedUsers = generatedUsers;
  app.use(helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      directives: {
        "img-src": ["'self'", 'data:', 'blob:']
      }
    }
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    session({
      name: 'sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 8
      }
    })
  );
  app.use('/uploads', express.static(config.uploadDir));
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/auth/sms/request', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/auth/phone/request-bind', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));

  const auth = authRoutes(db, smsService);
  app.post('/api/auth/login', auth.login);
  app.post('/api/auth/sms/request', auth.requestSmsLogin);
  app.post('/api/auth/sms/login', auth.smsLogin);
  app.post('/api/auth/logout', auth.logout);
  app.get('/api/auth/me', auth.me);
  app.post('/api/auth/change-password', requireAuth(db), auth.changePassword);
  app.post('/api/auth/phone/request-bind', requireAuth(db), auth.requestPhoneBind);
  app.post('/api/auth/phone/confirm-bind', requireAuth(db), auth.confirmPhoneBind);

  app.get('/api/users', requireAuth(db), requireAdmin, (req, res) => {
      const users = db.all(`
        SELECT u.*, o.name as org_name, o.type as org_type
        FROM users u
        LEFT JOIN organizations o ON u.org_id = o.id
        ORDER BY u.role, u.username
      `).map(sanitizeUser);
      res.json({ users });
    });

  app.post('/api/users', requireAuth(db), requireAdmin, async (req, res) => {
      const username = String(req.body.username || '').trim();
      const displayName = String(req.body.displayName || username).trim();
      const role = req.body.role === 'admin' ? 'admin' : 'user';
      const password = String(req.body.password || generateTemporaryPassword());
      const phone = normalizePhone(req.body.phone);
      const orgId = req.body.orgId || null;
      const validation = validatePassword(password, username);
      if (!username) return res.status(400).json({ error: '用户名不能为空' });
      if (phone && !validatePhone(phone)) return res.status(400).json({ error: '请输入有效的中国大陆手机号' });
      if (!validation.valid) return res.status(400).json({ error: validation.errors.join('；') });
      const now = new Date().toISOString();
      try {
        db.run(
          `INSERT INTO users
           (id, username, display_name, role, org_id, phone, phone_verified, password_hash, enabled, must_change_password, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
          [randomUUID(), username, displayName, role, orgId, phone || null, phone ? 1 : 0, await hashPassword(password), now, now]
        );
        writeAudit(db, { actorUserId: req.user.id, action: 'USER_CREATED', detail: username, ip: req.ip });
        const user = sanitizeUser(db.one(`SELECT u.*, o.name as org_name, o.type as org_type FROM users u LEFT JOIN organizations o ON u.org_id = o.id WHERE u.username = ?`, [username]));
        res.status(201).json({ user, temporaryPassword: req.body.password ? undefined : password });
      } catch {
        res.status(409).json({ error: '用户名已存在' });
      }
    });

  app.patch('/api/users/:id', requireAuth(db), requireAdmin, async (req, res) => {
      const row = db.one('SELECT * FROM users WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ error: '用户不存在' });
      const enabled = req.body.enabled === undefined ? Boolean(row.enabled) : Boolean(req.body.enabled);
      const role = req.body.role === 'admin' || req.body.role === 'user' ? req.body.role : row.role;
      const phoneProvided = Object.prototype.hasOwnProperty.call(req.body, 'phone');
      const phone = phoneProvided ? normalizePhone(req.body.phone) : (row.phone || '');
      const orgIdProvided = Object.prototype.hasOwnProperty.call(req.body, 'orgId');
      const orgId = orgIdProvided ? (req.body.orgId || null) : row.org_id;
      if (phoneProvided && phone && !validatePhone(phone)) return res.status(400).json({ error: '请输入有效的中国大陆手机号' });
      try {
        db.run('UPDATE users SET enabled = ?, role = ?, org_id = ?, phone = ?, phone_verified = ?, updated_at = ? WHERE id = ?', [
        toBool(enabled),
        role,
        orgId,
        phone || null,
        phone ? 1 : 0,
        new Date().toISOString(),
        row.id
        ]);
      } catch {
        return res.status(409).json({ error: '手机号已被其他用户绑定' });
      }
      writeAudit(db, { actorUserId: req.user.id, action: 'USER_UPDATED', detail: row.username, ip: req.ip });
      res.json({ user: sanitizeUser(db.one('SELECT u.*, o.name as org_name, o.type as org_type FROM users u LEFT JOIN organizations o ON u.org_id = o.id WHERE u.id = ?', [row.id])) });
    });

  app.delete('/api/users/:id', requireAuth(db), requireAdmin, (req, res) => {
    const row = db.one('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: '用户不存在' });
    if (row.id === req.user.id) return res.status(400).json({ error: '不能删除当前登录用户' });
    db.run('DELETE FROM users WHERE id = ?', [row.id]);
    writeAudit(db, { actorUserId: req.user.id, action: 'USER_DELETED', detail: row.username, ip: req.ip });
    res.json({ ok: true });
  });

  app.post('/api/users/:id/reset-password', requireAuth(db), requireAdmin, async (req, res) => {
    const row = db.one('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: '用户不存在' });
    const password = generateTemporaryPassword();
    db.run('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?', [
      await hashPassword(password),
      new Date().toISOString(),
      row.id
    ]);
    writeAudit(db, { actorUserId: req.user.id, action: 'PASSWORD_RESET', detail: row.username, ip: req.ip });
    res.json({ temporaryPassword: password });
  });

  app.post('/api/inspections/analyze', requireAuth(db), upload.single('photo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请上传隐患照片' });
    const date = String(req.body.date || new Date().toISOString().slice(0, 10));
    const inspector = String(req.body.inspector || '').trim();
    const hazardLabels = parseHazardLabels(req.body.hazardLabels);
    const imageUrl = `/uploads/${req.file.filename}`;
    let ai = {
      hazardDescription: '',
      rectificationSuggestion: '',
      rawModelOutput: '',
      modelName: '',
      aiError: ''
    };

    try {
      ai = await config.aiProvider.analyzeImage({
        imagePath: req.file.path,
        imageUrl,
        date,
        inspector,
        hazardLabels
      });
      writeAudit(db, { actorUserId: req.user.id, action: 'AI_ANALYZED', detail: req.file.filename, ip: req.ip });
    } catch (error) {
      ai.aiError = error.message;
      writeAudit(db, { actorUserId: req.user.id, action: 'AI_ANALYZE_FAILED', detail: error.message, ip: req.ip });
    }

    const draftId = randomUUID();
    db.run(
      `INSERT INTO inspection_drafts
       (id, owner_user_id, date, inspector, image_path, image_url, hazard_description, rectification_suggestion,
        hazard_labels, raw_model_output, model_name, ai_error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        draftId,
        req.user.id,
        date,
        inspector,
        req.file.path,
        imageUrl,
        ai.hazardDescription || '',
        ai.rectificationSuggestion || '',
        stringifyHazardLabels(hazardLabels),
        ai.rawModelOutput || '',
        ai.modelName || '',
        ai.aiError || '',
        new Date().toISOString()
      ]
    );
    res.json({
      draft: {
        draftId,
        date,
        inspector,
        imageUrl,
        hazardLabels,
        hazardDescription: ai.hazardDescription || '',
        rectificationSuggestion: ai.rectificationSuggestion || '',
        aiError: ai.aiError || '',
        modelName: ai.modelName || ''
      }
    });
  });

  app.post('/api/inspections', requireAuth(db), (req, res) => {
      const draft = db.one('SELECT * FROM inspection_drafts WHERE id = ? AND owner_user_id = ?', [req.body.draftId, req.user.id]);
      if (!draft) return res.status(404).json({ error: '草稿不存在或无权保存' });
      const hazardDescription = String(req.body.hazardDescription || '').trim();
      const rectificationSuggestion = String(req.body.rectificationSuggestion || '').trim();
      if (!hazardDescription || !rectificationSuggestion) {
        return res.status(400).json({ error: '请填写隐患描述和整改建议' });
      }
      const hazardLabels = Object.prototype.hasOwnProperty.call(req.body, 'hazardLabels')
        ? parseHazardLabels(req.body.hazardLabels)
        : parseHazardLabels(draft.hazard_labels);
      const id = randomUUID();
      const now = new Date().toISOString();
      const orgId = req.user.orgId || null;
      db.run(
        `INSERT INTO inspections
         (id, owner_user_id, org_id, source_org_id, assigned_to_org_id, date, inspector, image_path, image_url, hazard_description, rectification_suggestion,
          hazard_labels, status, model_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '待整改', ?, ?, ?)`,
        [
          id,
          req.user.id,
          orgId,
          orgId,
          orgId,
          req.body.date || draft.date,
          req.body.inspector || draft.inspector || '',
          draft.image_path,
          draft.image_url,
          hazardDescription,
          rectificationSuggestion,
          stringifyHazardLabels(hazardLabels),
          draft.model_name || '',
          now,
          now
        ]
      );
      db.run('DELETE FROM inspection_drafts WHERE id = ?', [draft.id]);
      writeAudit(db, { actorUserId: req.user.id, action: 'INSPECTION_SAVED', detail: id, ip: req.ip });
      const row = db.one(`
        SELECT i.*, o1.name as org_name, o2.name as source_org_name, o3.name as assigned_to_org_name
        FROM inspections i
        LEFT JOIN organizations o1 ON i.org_id = o1.id
        LEFT JOIN organizations o2 ON i.source_org_id = o2.id
        LEFT JOIN organizations o3 ON i.assigned_to_org_id = o3.id
        WHERE i.id = ?
      `, [id]);
      res.status(201).json({ record: mapInspection(row) });
    });

  // 隐患治理阶段 - 更新
  app.put('/api/inspections/:id/rectify', requireAuth(db), upload.single('rectificationPhoto'), (req, res) => {
    const row = db.one('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    if (req.user.role !== 'admin' && row.owner_user_id !== req.user.id) {
      return res.status(403).json({ error: '无权操作' });
    }
    const rectificationDate = String(req.body.rectificationDate || '').trim();
    const rectificationMeasure = String(req.body.rectificationMeasure || '').trim();
    const rectificationResponsiblePerson = String(req.body.rectificationResponsiblePerson || '').trim();
    if (!rectificationMeasure) {
      return res.status(400).json({ error: '请填写整改措施' });
    }
    const rectificationImagePath = req.file ? req.file.path : (row.rectification_image_path || '');
    const rectificationImageUrl = req.file ? `/uploads/${req.file.filename}` : (row.rectification_image_url || '');
    const now = new Date().toISOString();
    db.run(
      `UPDATE inspections SET
        rectification_date = ?, rectification_measure = ?,
        rectification_responsible_person = ?,
        rectification_image_path = ?, rectification_image_url = ?,
        status = '待验收', updated_at = ?
      WHERE id = ?`,
      [rectificationDate, rectificationMeasure, rectificationResponsiblePerson,
       rectificationImagePath, rectificationImageUrl, now, row.id]
    );
    writeAudit(db, { actorUserId: req.user.id, action: 'RECTIFICATION_UPDATED', detail: row.id, ip: req.ip });
    const updated = db.one('SELECT * FROM inspections WHERE id = ?', [row.id]);
    res.json({ record: mapInspection(updated) });
  });

    // 验收阶段 - 更新
  app.put('/api/inspections/:id/accept', requireAuth(db), (req, res) => {
    const row = db.one('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    
    // 权限检查：创建者本人、被分配的组织成员、或上级组织可以操作
    let canOperate = false;
    if (req.user.role === 'admin') {
      canOperate = true;
    } else if (row.owner_user_id === req.user.id) {
      canOperate = true;
    } else if (row.assigned_to_org_id && req.user.orgId) {
      // 检查当前用户组织是否是被分配的组织或其上级
      const ancestorOrgIds = db.getAncestorOrgIds(req.user.orgId);
      if (ancestorOrgIds.includes(row.assigned_to_org_id) || req.user.orgId === row.assigned_to_org_id) {
        canOperate = true;
      }
    }
    
    if (!canOperate) {
      return res.status(403).json({ error: '无权操作' });
    }
    
    const acceptanceDate = String(req.body.acceptanceDate || '').trim();
    const acceptanceResult = String(req.body.acceptanceResult || '').trim();
    if (!acceptanceResult) {
      return res.status(400).json({ error: '请填写完成情况' });
    }
    const now = new Date().toISOString();
    db.run(
      `UPDATE inspections SET
        acceptance_date = ?, acceptance_result = ?,
        status = '已验收', updated_at = ?
      WHERE id = ?`,
      [acceptanceDate, acceptanceResult, now, row.id]
    );
    writeAudit(db, { actorUserId: req.user.id, action: 'ACCEPTANCE_UPDATED', detail: row.id, ip: req.ip });
    const updated = db.one(`
      SELECT i.*, o1.name as org_name, o2.name as source_org_name, o3.name as assigned_to_org_name
      FROM inspections i
      LEFT JOIN organizations o1 ON i.org_id = o1.id
      LEFT JOIN organizations o2 ON i.source_org_id = o2.id
      LEFT JOIN organizations o3 ON i.assigned_to_org_id = o3.id
      WHERE i.id = ?
    `, [row.id]);
    res.json({ record: mapInspection(updated) });
  });

  // 查询隐患列表 - 支持组织架构权限（上级看下级）
  app.get('/api/inspections', requireAuth(db), (req, res) => {
    const clauses = [];
    const params = [];
    
    if (req.user.role !== 'admin') {
      // 上级可以看下级：查询当前用户所属组织及其所有下级组织的记录
      const orgIds = req.user.orgId ? db.getDescendantOrgIds(req.user.orgId) : [];
      if (orgIds.length > 0) {
        const placeholders = orgIds.map(() => '?').join(',');
        clauses.push(`(i.org_id IN (${placeholders}) OR i.assigned_to_org_id IN (${placeholders}) OR i.owner_user_id = ?)`);
        params.push(...orgIds, ...orgIds, req.user.id);
      } else {
        clauses.push('i.owner_user_id = ?');
        params.push(req.user.id);
      }
    }
    
    if (req.query.date) {
      clauses.push('i.date = ?');
      params.push(String(req.query.date));
    }
    if (req.query.inspector) {
      clauses.push('i.inspector LIKE ?');
      params.push(`%${req.query.inspector}%`);
    }
    
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.all(`
      SELECT i.*, o1.name as org_name, o2.name as source_org_name, o3.name as assigned_to_org_name
      FROM inspections i
      LEFT JOIN organizations o1 ON i.org_id = o1.id
      LEFT JOIN organizations o2 ON i.source_org_id = o2.id
      LEFT JOIN organizations o3 ON i.assigned_to_org_id = o3.id
      ${where}
      ORDER BY i.created_at DESC
    `, params);
    
    res.json({ records: rows.map(mapInspection) });
  });

  // 组织架构 API
  app.get('/api/organizations', requireAuth(db), (req, res) => {
    const orgs = db.all('SELECT * FROM organizations ORDER BY level, name');
    res.json({ organizations: orgs });
  });

  app.get('/api/organizations/tree', requireAuth(db), (req, res) => {
    const orgs = db.all('SELECT * FROM organizations ORDER BY level, name');
    
    function buildTree(parentId) {
      return orgs
        .filter(org => org.parent_id === parentId)
        .map(org => ({
          ...org,
          children: buildTree(org.id)
        }));
    }
    
    const tree = buildTree(null);
    res.json({ tree });
  });

  // 推送隐患给下级组织
  app.post('/api/inspections/:id/push', requireAuth(db), (req, res) => {
    const row = db.one(`
      SELECT i.*, o1.name as org_name, o2.name as source_org_name, o3.name as assigned_to_org_name
      FROM inspections i
      LEFT JOIN organizations o1 ON i.org_id = o1.id
      LEFT JOIN organizations o2 ON i.source_org_id = o2.id
      LEFT JOIN organizations o3 ON i.assigned_to_org_id = o3.id
      WHERE i.id = ?
    `, [req.params.id]);
    
    if (!row) return res.status(404).json({ error: '记录不存在' });
    
    // 检查权限：只有当前组织或上级组织可以推送
    if (req.user.role !== 'admin') {
      const userOrgIds = req.user.orgId ? db.getAncestorOrgIds(req.user.orgId) : [];
      userOrgIds.push(req.user.orgId);
      if (!userOrgIds.includes(row.org_id)) {
        return res.status(403).json({ error: '无权推送此记录' });
      }
    }
    
    const targetOrgId = req.body.targetOrgId;
    if (!targetOrgId) {
      return res.status(400).json({ error: '请选择推送目标组织' });
    }
    
    // 检查目标组织是否是当前组织的下级
    if (req.user.role !== 'admin' && req.user.orgId) {
      const descendantOrgIds = db.getDescendantOrgIds(req.user.orgId);
      if (!descendantOrgIds.includes(targetOrgId)) {
        return res.status(400).json({ error: '只能推送给下级组织' });
      }
    }
    
    const now = new Date().toISOString();
    
    // 更新记录的 assigned_to_org_id
    db.run('UPDATE inspections SET assigned_to_org_id = ?, updated_at = ? WHERE id = ?', [
      targetOrgId,
      now,
      row.id
    ]);
    
    // 记录流转日志
    const flowId = randomUUID();
    const targetOrg = db.one('SELECT name FROM organizations WHERE id = ?', [targetOrgId]);
    db.run(
      `INSERT INTO inspection_flows
       (id, inspection_id, from_org_id, from_org_name, to_org_id, to_org_name, action, remark, operator_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'push', ?, ?, ?)`,
      [
        flowId,
        row.id,
        req.user.orgId,
        req.user.orgName,
        targetOrgId,
        targetOrg ? targetOrg.name : '',
        req.body.remark || '',
        req.user.id,
        now
      ]
    );
    
    writeAudit(db, { actorUserId: req.user.id, action: 'INSPECTION_PUSHED', detail: `${row.id} -> ${targetOrgId}`, ip: req.ip });
    
    const updated = db.one(`
      SELECT i.*, o1.name as org_name, o2.name as source_org_name, o3.name as assigned_to_org_name
      FROM inspections i
      LEFT JOIN organizations o1 ON i.org_id = o1.id
      LEFT JOIN organizations o2 ON i.source_org_id = o2.id
      LEFT JOIN organizations o3 ON i.assigned_to_org_id = o3.id
      WHERE i.id = ?
    `, [row.id]);
    
    res.json({ record: mapInspection(updated) });
  });

  // 获取隐患的流转记录
  app.get('/api/inspections/:id/flows', requireAuth(db), (req, res) => {
    const flows = db.all(
      'SELECT * FROM inspection_flows WHERE inspection_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json({ flows });
  });

  app.post('/api/inspections/export', requireAuth(db), async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: '请选择要导出的记录' });
    
    const placeholders = ids.map(() => '?').join(',');
    const params = [...ids];
    
    let sql = `
      SELECT i.*, o1.name as org_name, o2.name as source_org_name, o3.name as assigned_to_org_name
      FROM inspections i
      LEFT JOIN organizations o1 ON i.org_id = o1.id
      LEFT JOIN organizations o2 ON i.source_org_id = o2.id
      LEFT JOIN organizations o3 ON i.assigned_to_org_id = o3.id
      WHERE i.id IN (${placeholders})
    `;
    
    if (req.user.role !== 'admin') {
      const orgIds = req.user.orgId ? db.getDescendantOrgIds(req.user.orgId) : [];
      if (orgIds.length > 0) {
        const orgPlaceholders = orgIds.map(() => '?').join(',');
        sql += ` AND (i.org_id IN (${orgPlaceholders}) OR i.assigned_to_org_id IN (${orgPlaceholders}) OR i.owner_user_id = ?)`;
        params.push(...orgIds, ...orgIds, req.user.id);
      } else {
        sql += ' AND i.owner_user_id = ?';
        params.push(req.user.id);
      }
    }
    
    const rows = db.all(sql, params);, requireAuth(db), (req, res) => {\n    const clauses = [];\n    const params = [];\n    if (req.user.role !== 'admin') {\n      // 上级可以看下级：查询当前用户所属组织及其所有下级组织的记录
        const orgIds = req.user.orgId ? db.getDescendantOrgIds(req.user.orgId) : [];\n      if (orgIds.length > 0) {\n        const placeholders = orgIds.map(() => '?').join(',');\n        clauses.push(`(i.org_id IN (${placeholders}) OR i.assigned_to_org_id IN (${placeholders}) OR i.owner_user_id = ?)`);\n        params.push(...orgIds, ...orgIds, req.user.id);\n      } else {\n        clauses.push('i.owner_user_id = ?');\n        params.push(req.user.id);\n      }\n    }\n    if (req.query.date) {\n      clauses.push('i.date = ?');\n      params.push(String(req.query.date));\n    }\n    if (req.query.inspector) {\n      clauses.push('i.inspector LIKE ?');\n      params.push(`%${req.query.inspector}%`);\n    }\n    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';\n    const rows = db.all(`\n      SELECT i.*, o1.name as org_name, o2.name as source_org_name, o3.name as assigned_to_org_name\n      FROM inspections i\n      LEFT JOIN organizations o1 ON i.org_id = o1.id\n      LEFT JOIN organizations o2 ON i.source_org_id = o2.id\n      LEFT JOIN organizations o3 ON i.assigned_to_org_id = o3.id\n      ${where}\n      ORDER BY i.created_at DESC\n    `, params);\n    res.json({ records: rows.map(mapInspection) });\n  });"

  app.post('/api/inspections/export', requireAuth(db), async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: '请选择要导出的记录' });
  const placeholders = ids.map(() => '?').join(',');
  const params = [...ids];
  let sql = `SELECT * FROM inspections WHERE id IN (${placeholders})`;
  if (req.user.role !== 'admin') {
    sql += ' AND owner_user_id = ?';
    params.push(req.user.id);
  }
  const rows = db.all(sql, params);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('隐患排查台账');

  sheet.columns = [
    { header: '序号', key: 'sequence', width: 8 },
    { header: '日期', key: 'date', width: 14 },
    { header: '排查人', key: 'inspector', width: 18 },
    { header: '隐患类型', key: 'hazardLabels', width: 30 },
    { header: '隐患照片', key: 'image', width: 36 },
    { header: '文本（隐患描述+整改建议）', key: 'text', width: 70 },
    // 隐患治理阶段
    { header: '治理日期', key: 'rectificationDate', width: 14 },
    { header: '治理措施', key: 'rectificationMeasure', width: 40 },
    { header: '治理负责人', key: 'rectificationResponsiblePerson', width: 18 },
    { header: '治理照片', key: 'rectificationImage', width: 36 },
    // 验收阶段
    { header: '验收日期', key: 'acceptanceDate', width: 14 },
    { header: '验收结果', key: 'acceptanceResult', width: 18 }
  ];

  sheet.getRow(1).font = { bold: true, size: 12 };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

  let rowIndex = 2;
  for (const row of rows) {
    const mapped = mapInspection(row, rowIndex - 2);
    const excelRow = sheet.addRow({
      sequence: mapped.sequence,
      date: mapped.date,
      inspector: mapped.inspector,
      hazardLabels: mapped.hazardLabels.length ? mapped.hazardLabels.join('、') : '-',
      image: '',
      text: mapped.recordText,
      rectificationDate: mapped.rectificationDate,
      rectificationMeasure: mapped.rectificationMeasure,
      rectificationResponsiblePerson: mapped.rectificationResponsiblePerson,
      rectificationImage: '',
      acceptanceDate: mapped.acceptanceDate,
      acceptanceResult: mapped.acceptanceResult
    });

    excelRow.height = 120;
    excelRow.getCell('text').alignment = { wrapText: true, vertical: 'top' };
    excelRow.getCell('rectificationMeasure').alignment = { wrapText: true, vertical: 'top' };

    // 隐患照片
    if (mapped.imageUrl) {
      try {
        const imageFilename = path.basename(mapped.imageUrl);
        const imagePath = path.join(config.uploadDir, imageFilename);

        if (fs.existsSync(imagePath)) {
          const ext = path.extname(imageFilename).slice(1).toLowerCase();
          const imageId = workbook.addImage({
            filename: imagePath,
            extension: ext
          });

          sheet.addImage(imageId, {
            tl: { col: 4, row: rowIndex - 1 },
            ext: { width: 120, height: 100 },
            editAs: 'oneCell'
          });
        } else {
          excelRow.getCell('image').value = '图片文件不存在';
        }
      } catch (imgErr) {
        console.error(`图片插入失败: ${mapped.imageUrl}`, imgErr);
        excelRow.getCell('image').value = '图片加载失败';
      }
    } else {
      excelRow.getCell('image').value = '无图片';
    }

    // 治理照片
    if (mapped.rectificationImageUrl) {
      try {
        const imageFilename = path.basename(mapped.rectificationImageUrl);
        const imagePath = path.join(config.uploadDir, imageFilename);

        if (fs.existsSync(imagePath)) {
          const ext = path.extname(imageFilename).slice(1).toLowerCase();
          const imageId = workbook.addImage({
            filename: imagePath,
            extension: ext
          });

          sheet.addImage(imageId, {
            tl: { col: 9, row: rowIndex - 1 },
            ext: { width: 120, height: 100 },
            editAs: 'oneCell'
          });
        } else {
          excelRow.getCell('rectificationImage').value = '图片文件不存在';
        }
      } catch (imgErr) {
        console.error(`治理图片插入失败: ${mapped.rectificationImageUrl}`, imgErr);
        excelRow.getCell('rectificationImage').value = '图片加载失败';
      }
    } else {
      excelRow.getCell('rectificationImage').value = '无图片';
    }

    rowIndex++;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  writeAudit(db, { actorUserId: req.user.id, action: 'INSPECTIONS_EXPORTED', detail: `${rows.length} records`, ip: req.ip });
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="safety-inspections.xlsx"');
  res.send(Buffer.from(buffer));
});

  app.use((error, _req, res, _next) => {
    if (error?.message?.includes('仅支持')) return res.status(400).json({ error: error.message });
    if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '图片过大' });
    res.status(500).json({ error: error.message || '服务器错误' });
  });

  return app;
}
