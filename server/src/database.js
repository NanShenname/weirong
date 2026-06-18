import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';

function nowIso() {
  return new Date().toISOString();
}

export async function createDatabase(databasePath) {
  const SQL = await initSqlJs();
  let db;
  const isMemory = databasePath === ':memory:';

  if (!isMemory && fs.existsSync(databasePath)) {
    db = new SQL.Database(fs.readFileSync(databasePath));
  } else {
    db = new SQL.Database();
  }

  function persist() {
    if (isMemory) return;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.writeFileSync(databasePath, Buffer.from(db.export()));
  }

    db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('client', 'director', 'resident', 'contractor')),
      parent_id TEXT,
      level INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(parent_id) REFERENCES organizations(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      org_id TEXT,
      phone TEXT,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(org_id) REFERENCES organizations(id)
    );

    CREATE TABLE IF NOT EXISTS sms_codes (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ('login', 'bind')),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      request_ip TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inspection_drafts (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      inspector TEXT,
      image_path TEXT NOT NULL,
      image_url TEXT NOT NULL,
      hazard_labels TEXT NOT NULL DEFAULT '[]',
      hazard_description TEXT NOT NULL,
      rectification_suggestion TEXT NOT NULL,
      raw_model_output TEXT,
      model_name TEXT,
      ai_error TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(owner_user_id) REFERENCES users(id)
    );

        CREATE TABLE IF NOT EXISTS inspections (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      org_id TEXT,
      source_org_id TEXT,
      assigned_to_org_id TEXT,
      date TEXT NOT NULL,
      inspector TEXT,
      image_path TEXT NOT NULL,
      image_url TEXT NOT NULL,
      hazard_labels TEXT NOT NULL DEFAULT '[]',
      hazard_description TEXT NOT NULL,
      rectification_suggestion TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '待整改',
      model_name TEXT,
      -- 隐患治理阶段
      rectification_date TEXT,
      rectification_measure TEXT,
      rectification_responsible_person TEXT,
      rectification_image_path TEXT,
      rectification_image_url TEXT,
      -- 验收阶段
      acceptance_date TEXT,
      acceptance_result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(owner_user_id) REFERENCES users(id),
      FOREIGN KEY(org_id) REFERENCES organizations(id),
      FOREIGN KEY(source_org_id) REFERENCES organizations(id),
      FOREIGN KEY(assigned_to_org_id) REFERENCES organizations(id)
    );

    CREATE TABLE IF NOT EXISTS inspection_flows (
      id TEXT PRIMARY KEY,
      inspection_id TEXT NOT NULL,
      from_org_id TEXT,
      from_org_name TEXT,
      to_org_id TEXT,
      to_org_name TEXT,
      action TEXT NOT NULL,
      remark TEXT,
      operator_user_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(inspection_id) REFERENCES inspections(id),
      FOREIGN KEY(from_org_id) REFERENCES organizations(id),
      FOREIGN KEY(to_org_id) REFERENCES organizations(id),
      FOREIGN KEY(operator_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      ip TEXT,
      created_at TEXT NOT NULL
    );
  `);
  // 数据库迁移：为已有表添加新字段
  try {
    const userCols = db.exec("PRAGMA table_info(users)");
    if (userCols.length > 0) {
      const userColNames = userCols[0].rows ? userCols[0].rows.map(r => r[1]) : userCols[0].values.map(r => r[1]);
      const userMigrations = [
              ['phone', 'TEXT'],
              ['phone_verified', 'INTEGER NOT NULL DEFAULT 0'],
              ['org_id', 'TEXT']
            ];
      for (const [col, type] of userMigrations) {
        if (!userColNames.includes(col)) {
          db.run(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
        }
      }
      db.run("CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users(phone) WHERE phone IS NOT NULL AND phone != ''");
    }

    const draftCols = db.exec("PRAGMA table_info(inspection_drafts)");
    if (draftCols.length > 0) {
      const draftColNames = draftCols[0].rows ? draftCols[0].rows.map(r => r[1]) : draftCols[0].values.map(r => r[1]);
      if (!draftColNames.includes('hazard_labels')) {
        db.run("ALTER TABLE inspection_drafts ADD COLUMN hazard_labels TEXT NOT NULL DEFAULT '[]'");
      }
    }

    const cols = db.exec("PRAGMA table_info(inspections)");
    if (cols.length > 0) {
      const colNames = cols[0].rows ? cols[0].rows.map(r => r[1]) : cols[0].values.map(r => r[1]);
      const migrations = [
              ['hazard_labels', "TEXT NOT NULL DEFAULT '[]'"],
              ['rectification_date', 'TEXT'],
              ['rectification_measure', 'TEXT'],
              ['rectification_responsible_person', 'TEXT'],
              ['rectification_image_path', 'TEXT'],
              ['rectification_image_url', 'TEXT'],
              ['acceptance_date', 'TEXT'],
              ['acceptance_result', 'TEXT'],
              ['org_id', 'TEXT'],
              ['source_org_id', 'TEXT'],
              ['assigned_to_org_id', 'TEXT']
            ];
      for (const [col, type] of migrations) {
        if (!colNames.includes(col)) {
          db.run(`ALTER TABLE inspections ADD COLUMN ${col} ${type}`);
        }
      }
    }
  } catch (e) {
    // 忽略迁移错误
  }

  persist();

  function run(sql, params = []) {
    db.run(sql, params);
    persist();
  }

  function one(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      return stmt.step() ? stmt.getAsObject() : null;
    } finally {
      stmt.free();
    }
  }

  function all(sql, params = []) {
    const stmt = db.prepare(sql);
    const rows = [];
    try {
      stmt.bind(params);
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  // 获取组织及其所有下级组织的ID列表
    function getDescendantOrgIds(orgId) {
      const result = new Set();
      const queue = [orgId];
      while (queue.length) {
        const current = queue.shift();
        result.add(current);
        const children = all('SELECT id FROM organizations WHERE parent_id = ?', [current]);
        for (const child of children) {
          if (!result.has(child.id)) {
            queue.push(child.id);
          }
        }
      }
      return [...result];
    }

    // 获取组织的所有上级组织ID列表
    function getAncestorOrgIds(orgId) {
      const result = [];
      let current = orgId;
      while (current) {
        const row = one('SELECT parent_id FROM organizations WHERE id = ?', [current]);
        if (!row || !row.parent_id) break;
        result.push(row.parent_id);
        current = row.parent_id;
      }
      return result;
    }

    return {
      run,
      one,
      all,
      persist,
      close: () => db.close(),
      nowIso,
      getDescendantOrgIds,
      getAncestorOrgIds
    };
}
