import { randomUUID } from 'node:crypto';
import { generateTemporaryPassword, hashPassword } from './passwords.js';

const ORG_TYPE_LABELS = {
  client: '建设单位',
  director: '总监办',
  resident: '驻地办',
  contractor: '施工单位'
};

export function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    orgId: row.org_id || '',
    orgName: row.org_name || '',
    orgType: row.org_type || '',
    orgTypeLabel: ORG_TYPE_LABELS[row.org_type] || '',
    phone: row.phone || '',
    phoneVerified: Boolean(row.phone_verified),
    enabled: Boolean(row.enabled),
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at || '',
    createdAt: row.created_at
  };
}

export async function seedDefaultUsers(db, seedUsers) {
  const now = new Date().toISOString();

  // 创建组织架构
  const existingOrgs = db.all('SELECT * FROM organizations ORDER BY level');
  let orgs;
  if (existingOrgs.length >= 5) {
    orgs = existingOrgs;
  } else {
    orgs = [
      { id: randomUUID(), name: 'S16荣潍高速建设单位', type: 'client', parentId: null, level: 1 },
      { id: randomUUID(), name: '总监办', type: 'director', parentId: null, level: 2 },
      { id: randomUUID(), name: '驻地办一', type: 'resident', parentId: null, level: 3 },
      { id: randomUUID(), name: '施工单位A', type: 'contractor', parentId: null, level: 4 },
      { id: randomUUID(), name: '施工单位B', type: 'contractor', parentId: null, level: 4 }
    ];
    orgs[1].parentId = orgs[0].id;
    orgs[2].parentId = orgs[1].id;
    orgs[3].parentId = orgs[2].id;
    orgs[4].parentId = orgs[2].id;

    for (const org of orgs) {
      db.run(
        'INSERT OR IGNORE INTO organizations (id, name, type, parent_id, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [org.id, org.name, org.type, org.parentId, org.level, now, now]
      );
    }
    for (const org of orgs) {
      if (org.parentId) {
        db.run('UPDATE organizations SET parent_id = ?, level = ?, updated_at = ? WHERE id = ?',
          [org.parentId, org.level, now, org.id]);
      }
    }
    orgs = db.all('SELECT * FROM organizations ORDER BY level');
  }

  const orgMap = {};
  for (const org of orgs) {
    orgMap[org.name] = org.id;
  }

  const seeds = seedUsers || [
    { username: 'admin', displayName: '系统管理员', role: 'admin', orgName: 'S16荣潍高速建设单位' },
    { username: 'director01', displayName: '总监办张工', role: 'user', orgName: '总监办' },
    { username: 'resident01', displayName: '驻地办李工', role: 'user', orgName: '驻地办一' },
    { username: 'contractor01', displayName: '施工单位A王工', role: 'user', orgName: '施工单位A' },
    { username: 'contractor02', displayName: '施工单位B赵工', role: 'user', orgName: '施工单位B' }
  ];

  const generated = [];
  for (const seed of seeds) {
    const existing = db.one('SELECT id FROM users WHERE username = ?', [seed.username]);
    if (existing) continue;
    const password = seed.password || generateTemporaryPassword();
    const orgId = orgMap[seed.orgName] || null;
    db.run(
      `INSERT INTO users
       (id, username, display_name, role, org_id, password_hash, enabled, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        randomUUID(),
        seed.username,
        seed.displayName,
        seed.role,
        orgId,
        await hashPassword(password),
        seed.mustChangePassword === false ? 0 : 1,
        now,
        now
      ]
    );
    generated.push({ username: seed.username, role: seed.role, temporaryPassword: password });
  }
  return generated;
}
