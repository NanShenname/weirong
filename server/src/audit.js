import { randomUUID } from 'node:crypto';

export function writeAudit(db, { actorUserId = null, action, detail = '', ip = '' }) {
  db.run(
    `INSERT INTO audit_logs (id, actor_user_id, action, detail, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), actorUserId, action, detail, ip, new Date().toISOString()]
  );
}
