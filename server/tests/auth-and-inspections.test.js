import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import ExcelJS from 'exceljs';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/passwords.js';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

function parseBinary(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('auth and editable inspection flow', () => {
  let tempDir;
  let app;
  let smsMessages;
  let aiRequests;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safety-hazard-test-'));
    smsMessages = [];
    aiRequests = [];
    app = await createApp({
      databasePath: ':memory:',
      uploadDir: path.join(tempDir, 'uploads'),
      sessionSecret: 'test-session-secret-with-enough-length',
      smsResendSeconds: 60,
      seedUsers: [
        {
          username: 'admin',
          displayName: '系统管理员',
          role: 'admin',
          password: 'AdminTemp#12345',
          mustChangePassword: true
        },
        {
          username: 'inspector01',
          displayName: '一线排查员',
          role: 'user',
          password: 'UserTemp#12345',
          mustChangePassword: true
        }
      ],
      aiProvider: {
        analyzeImage: async (request) => {
          aiRequests.push(request);
          return {
            hazardDescription: '临边防护缺失，作业平台存在坠落风险。',
            rectificationSuggestion: '立即补齐临边防护栏杆，验收合格后再恢复作业。',
            rawModelOutput: '模型原始输出',
            modelName: 'fake-bailian-vision'
          };
        }
      },
      smsProvider: {
        send: async (message) => {
          smsMessages.push(message);
        }
      }
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('requires first-login password change and rejects weak new passwords', async () => {
    const agent = request.agent(app);

    const login = await agent
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'AdminTemp#12345' })
      .expect(200);

    expect(login.body.user.username).toBe('admin');
    expect(login.body.user.mustChangePassword).toBe(true);

    await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'AdminTemp#12345', newPassword: 'weak' })
      .expect(400);

    const changed = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'AdminTemp#12345', newPassword: 'NewStrong#12345' })
      .expect(200);

    expect(changed.body.user.mustChangePassword).toBe(false);
  });

  it('returns an AI draft that can be edited before the final record is saved', async () => {
    const agent = request.agent(app);

    await agent
      .post('/api/auth/login')
      .send({ username: 'inspector01', password: 'UserTemp#12345' })
      .expect(200);

    const analyzed = await agent
      .post('/api/inspections/analyze')
      .field('date', '2026-05-21')
      .field('inspector', '张三')
      .field('hazardLabels', JSON.stringify(['超速行驶', '用电隐患', '无效标签']))
      .attach('photo', tinyPng, { filename: 'hazard.png', contentType: 'image/png' })
      .expect(200);

    expect(analyzed.body.draft.hazardDescription).toContain('临边防护');
    expect(analyzed.body.draft.hazardLabels).toEqual(['超速行驶', '用电隐患']);
    expect(aiRequests[0].hazardLabels).toEqual(['超速行驶', '用电隐患']);

    const saved = await agent
      .post('/api/inspections')
      .send({
        draftId: analyzed.body.draft.draftId,
        date: '2026-05-21',
        inspector: '张三',
        hazardLabels: ['超载运输', '材料堆放'],
        hazardDescription: '人工编辑后的隐患描述',
        rectificationSuggestion: '人工编辑后的整改建议'
      })
      .expect(201);

    expect(saved.body.record.hazardDescription).toBe('人工编辑后的隐患描述');
    expect(saved.body.record.hazardLabels).toEqual(['超载运输', '材料堆放']);

    const history = await agent.get('/api/inspections').expect(200);
    expect(history.body.records).toHaveLength(1);
    expect(history.body.records[0].rectificationSuggestion).toBe('人工编辑后的整改建议');
    expect(history.body.records[0].hazardLabels).toEqual(['超载运输', '材料堆放']);

    const exported = await agent
      .post('/api/inspections/export')
      .send({ ids: [saved.body.record.id] })
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body);
    const sheet = workbook.getWorksheet('隐患排查台账');
    expect(sheet.getRow(1).values).toContain('隐患类型');
    expect(sheet.getRow(2).getCell(4).value).toBe('超载运输、材料堆放');
  });

  it('lets an admin bind a phone number and the user log in with an SMS code', async () => {
    const admin = request.agent(app);

    await admin
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'AdminTemp#12345' })
      .expect(200);

    const users = await admin.get('/api/users').expect(200);
    const inspector = users.body.users.find((user) => user.username === 'inspector01');

    const updated = await admin
      .patch(`/api/users/${inspector.id}`)
      .send({ phone: '13800138000' })
      .expect(200);

    expect(updated.body.user.phone).toBe('13800138000');
    expect(updated.body.user.phoneVerified).toBe(true);

    const smsAgent = request.agent(app);
    const requested = await smsAgent
      .post('/api/auth/sms/request')
      .send({ phone: '13800138000' })
      .expect(200);

    expect(requested.body.message).toContain('如手机号已绑定');
    expect(smsMessages).toHaveLength(1);
    expect(smsMessages[0]).toMatchObject({ phone: '13800138000', purpose: 'login' });

    await smsAgent
      .post('/api/auth/sms/login')
      .send({ phone: '13800138000', code: '000000' })
      .expect(400);

    const loggedIn = await smsAgent
      .post('/api/auth/sms/login')
      .send({ phone: '13800138000', code: smsMessages[0].code })
      .expect(200);

    expect(loggedIn.body.user.username).toBe('inspector01');

    await smsAgent
      .post('/api/auth/sms/login')
      .send({ phone: '13800138000', code: smsMessages[0].code })
      .expect(400);
  });

  it('does not reveal unbound phones and supports self-service phone binding', async () => {
    const anonymous = request.agent(app);
    await anonymous
      .post('/api/auth/sms/request')
      .send({ phone: '13900139000' })
      .expect(200);
    expect(smsMessages).toHaveLength(0);

    const user = request.agent(app);
    await user
      .post('/api/auth/login')
      .send({ username: 'inspector01', password: 'UserTemp#12345' })
      .expect(200);

    await user
      .post('/api/auth/phone/request-bind')
      .send({ phone: '13900139000' })
      .expect(200);
    expect(smsMessages).toHaveLength(1);
    expect(smsMessages[0]).toMatchObject({ phone: '13900139000', purpose: 'bind' });

    const bound = await user
      .post('/api/auth/phone/confirm-bind')
      .send({ phone: '13900139000', code: smsMessages[0].code })
      .expect(200);

    expect(bound.body.user.phone).toBe('13900139000');
    expect(bound.body.user.phoneVerified).toBe(true);

    await user
      .post('/api/auth/phone/request-bind')
      .send({ phone: '13800138000' })
      .expect(400);
    expect(smsMessages).toHaveLength(1);

    const smsAgent = request.agent(app);
    await smsAgent
      .post('/api/auth/sms/request')
      .send({ phone: '13900139000' })
      .expect(200);
    expect(smsMessages).toHaveLength(2);

    const loggedIn = await smsAgent
      .post('/api/auth/sms/login')
      .send({ phone: '13900139000', code: smsMessages[1].code })
      .expect(200);

    expect(loggedIn.body.user.username).toBe('inspector01');
  });

  it('migrates an existing users table before creating phone indexes', async () => {
    const SQL = await initSqlJs();
    const legacyDbPath = path.join(tempDir, 'legacy.sqlite');
    const legacy = new SQL.Database();
    const now = new Date().toISOString();
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
        password_hash TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        last_login_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacy.run(
      `INSERT INTO users
       (id, username, display_name, role, password_hash, enabled, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      ['legacy-admin', 'legacy', '旧管理员', 'admin', await hashPassword('LegacyTemp#12345'), now, now]
    );
    await fs.writeFile(legacyDbPath, Buffer.from(legacy.export()));
    legacy.close();

    const migrated = await createApp({
      databasePath: legacyDbPath,
      uploadDir: path.join(tempDir, 'legacy-uploads'),
      sessionSecret: 'test-session-secret-with-enough-length',
      seedUsers: [],
      smsProvider: { send: async () => {} }
    });

    const agent = request.agent(migrated);
    const login = await agent
      .post('/api/auth/login')
      .send({ username: 'legacy', password: 'LegacyTemp#12345' })
      .expect(200);

    expect(login.body.user.phone).toBe('');
    expect(login.body.user.phoneVerified).toBe(false);
  });
});
