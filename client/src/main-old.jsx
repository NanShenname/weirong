import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  FileSpreadsheet,
  History,
  Lock,
  LogOut,
  Phone,
  ShieldCheck,
  Upload,
  UserCog,
  Users,
  Wrench,
  X
} from 'lucide-react';
import './styles.css';

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || '请求失败');
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return response;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const HAZARD_LABELS = ['反光衣穿戴','安全绳穿戴','人员异常行为监测与预警','大型机械作业范围非法闯入',
'吊装作业','施工现场材料堆放','消防设施','临时用电','脚手架与支架施工','边坡基坑坍','临边防护情况','火情隐患','涉水涉路','极端天气'
];

function HazardChips({ labels = [] }) {
  if (!labels.length) return <span className="no-tags">未选择</span>;
  return (
    <div className="hazard-chips compact">
      {labels.map((label) => <span className="hazard-chip selected" key={label}>{label}</span>)}
    </div>
  );
}

/* ─── 登录 ─── */
function Login({ onLogin }) {
  const [mode, setMode] = useState('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!countdown) return undefined;
    const timer = setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      onLogin(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function requestSmsCode() {
    setError('');
    try {
      const result = await api('/api/auth/sms/request', {
        method: 'POST',
        body: JSON.stringify({ phone })
      });
      setCountdown(60);
      setError(result.message || '验证码已发送');
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitSms(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api('/api/auth/sms/login', {
        method: 'POST',
        body: JSON.stringify({ phone, code })
      });
      onLogin(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }



  return (
    <main className="login-shell">
      <section className="login-brand">
        <div className="brand-mark"><ShieldCheck size={28} /></div>
        <h1>安全隐患排查治理助手</h1>
        <p>施工现场隐患排查、AI 识别、人工复核、台账导出一体化。</p>
        <div className="security-strip" />
      </section>
      <form className="login-panel" onSubmit={mode === 'password' ? submit : submitSms}>
        <h2>安全登录</h2>
        <div className="login-tabs">
          <button type="button" className={mode === 'password' ? 'active' : ''} onClick={() => setMode('password')}>账号密码</button>
          <button type="button" className={mode === 'sms' ? 'active' : ''} onClick={() => setMode('sms')}>手机验证码</button>
        </div>
        {mode === 'password' ? (
          <>
            <label>账号<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
            <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
            <p className="hint">密码需 12 位以上，包含大小写、数字和特殊字符。连续 5 次失败将锁定 15 分钟。</p>
          </>
        ) : (
          <>
            <label>手机号<input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="请输入已绑定手机号" /></label>
            <label>验证码
              <div className="code-row">
                <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength="6" placeholder="6 位验证码" />
                <button type="button" className="ghost" disabled={countdown > 0} onClick={requestSmsCode}>
                  {countdown > 0 ? `${countdown}s` : '获取验证码'}
                </button>
              </div>
            </label>
            <p className="hint">本地测试模式会把验证码打印到服务端终端日志。</p>
          </>
        )}
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={loading}>{loading ? '登录中...' : '安全登录'}</button>
      </form>
    </main>
  );
}

/* ─── 修改密码 ─── */
function ChangePassword({ onChanged }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const result = await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      onChanged(result.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <Lock />
        <h2>首次登录需要修改密码</h2>
        <p>新密码至少 12 位，包含大小写字母、数字、特殊字符，且不能包含用户名。</p>
        <input type="password" placeholder="当前临时密码" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        <input type="password" placeholder="新复杂密码" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <button className="primary">保存新密码</button>
      </form>
    </div>
  );
}

/* ─── 状态标签 ─── */
function StatusBadge({ status }) {
  const map = {
    '待整改': { icon: AlertTriangle, cls: 'status-pending', label: '待整改' },
    '待验收': { icon: Clock, cls: 'status-rectifying', label: '待验收' },
    '已验收': { icon: CheckCircle2, cls: 'status-accepted', label: '已验收' }
  };
  const info = map[status] || map['待整改'];
  const Icon = info.icon;
  return <span className={`status-badge ${info.cls}`}><Icon size={14} /> {info.label}</span>;
}

/* ─── 图片查看器 ─── */
function ImageViewer({ src, alt }) {
  const [open, setOpen] = useState(false);
  if (!src) return <span className="no-image">暂无照片</span>;
  return (
    <>
      <img className="thumb clickable" src={src} alt={alt || ''} onClick={() => setOpen(true)} />
      {open && (
        <div className="image-overlay" onClick={() => setOpen(false)}>
          <img className="image-full" src={src} alt={alt || ''} />
          <button className="image-close"><X size={24} /></button>
        </div>
      )}
    </>
  );
}

/* ─── 抽屉组件 ─── */
function Drawer({ title, icon: Icon, statusLabel, children, defaultOpen = false, color = '#f07f24' }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="drawer" style={{ '--drawer-color': color }}>
      <div className="drawer-header" onClick={() => setOpen(!open)}>
        <div className="drawer-title">
          <Icon size={20} />
          <h3>{title}</h3>
          {statusLabel && <span className="drawer-status" style={{ background: color + '18', color }}>{statusLabel}</span>}
        </div>
        <button className="drawer-toggle">
          {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
      </div>
      {open && <div className="drawer-body">{children}</div>}
    </div>
  );
}

/* ─── 拍照排查 ─── */
function Inspection() {
  const [date, setDate] = useState(today());
  const [inspector, setInspector] = useState('');
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [draft, setDraft] = useState(null);
  const [hazardDescription, setHazardDescription] = useState('');
  const [rectificationSuggestion, setRectificationSuggestion] = useState('');
  const [hazardLabels, setHazardLabels] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  function choosePhoto(file) {
    setPhoto(file);
    setPreview(file ? URL.createObjectURL(file) : '');
    setDraft(null);
    setHazardDescription('');
    setRectificationSuggestion('');
    setHazardLabels([]);
    setMessage('');
  }

  function toggleHazardLabel(label) {
    setHazardLabels((current) => (
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label]
    ));
  }

  async function analyze() {
    if (!photo) return setMessage('请先拍照或上传图片');
    const data = new FormData();
    data.append('photo', photo);
    data.append('date', date);
    data.append('inspector', inspector);
    data.append('hazardLabels', JSON.stringify(hazardLabels));
    setLoading(true);
    setMessage('');
    try {
      const result = await api('/api/inspections/analyze', { method: 'POST', body: data });
      setDraft(result.draft);
      setHazardLabels(result.draft.hazardLabels || hazardLabels);
      setHazardDescription(result.draft.hazardDescription || '');
      setRectificationSuggestion(result.draft.rectificationSuggestion || '');
      setMessage(result.draft.aiError || 'AI 已生成草稿，可编辑后保存');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!draft) return setMessage('请先生成草稿');
    try {
      await api('/api/inspections', {
        method: 'POST',
        body: JSON.stringify({ draftId: draft.draftId, date, inspector, hazardDescription, rectificationSuggestion, hazardLabels })
      });
      setMessage('已保存到历史台账');
      setDraft(null);
      setPhoto(null);
      setPreview('');
      setHazardLabels([]);
      setHazardDescription('');
      setRectificationSuggestion('');
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <section className="inspect-grid">
      <div className="panel upload-panel">
        <div className="section-title"><Camera /><h2>现场拍照 / 上传</h2></div>
        <label className="photo-drop">
          {preview ? <img src={preview} alt="隐患照片预览" /> : <span><Upload /> 点击上传或手机拍照</span>}
          <input type="file" accept="image/*" capture="environment" onChange={(e) => choosePhoto(e.target.files?.[0])} />
        </label>
        <div className="hazard-label-picker">
          <span className="field-label">常见隐患</span>
          <div className="hazard-chips">
            {HAZARD_LABELS.map((label) => (
              <button
                type="button"
                key={label}
                className={`hazard-chip ${hazardLabels.includes(label) ? 'selected' : ''}`}
                onClick={() => toggleHazardLabel(label)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="form-row">
          <label>日期<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>排查人（可为空）<input value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="例如：张三" /></label>
        </div>
        <button className="primary" onClick={analyze} disabled={loading}>{loading ? '识别中...' : '开始识别'}</button>
        {message && <div className={message.includes('已保存') ? 'success' : 'notice'}>{message}</div>}
      </div>
      <div className="panel result-panel">
        <div className="section-title"><AlertTriangle /><h2>AI 结果编辑</h2></div>
        <div className="field"><span className="field-label">已选隐患类型</span><HazardChips labels={hazardLabels} /></div>
        <label>隐患描述<textarea value={hazardDescription} onChange={(e) => setHazardDescription(e.target.value)} placeholder="AI 生成后可在这里修改，也可手动填写" /></label>
        <label>整改建议<textarea value={rectificationSuggestion} onChange={(e) => setRectificationSuggestion(e.target.value)} placeholder="请填写整改措施、责任要求或复查建议" /></label>
        <button className="primary sticky-save" disabled={!draft} onClick={save}>保存记录</button>
      </div>
    </section>
  );
}

/* ─── 历史台账 - 抽屉式详情 ─── */
function RecordDetail({ record, onUpdate }) {
  const [rectDate, setRectDate] = useState(record.rectificationDate || today());
  const [rectMeasure, setRectMeasure] = useState(record.rectificationMeasure || '');
  const [rectPerson, setRectPerson] = useState(record.rectificationResponsiblePerson || '');
  const [rectPhoto, setRectPhoto] = useState(null);
  const [rectPreview, setRectPreview] = useState(record.rectificationImageUrl || '');
  const [rectSaving, setRectSaving] = useState(false);

  const [accDate, setAccDate] = useState(record.acceptanceDate || today());
  const [accResult, setAccResult] = useState(record.acceptanceResult || '');
  const [accSaving, setAccSaving] = useState(false);

  async function submitRectify() {
    setRectSaving(true);
    try {
      const data = new FormData();
      data.append('rectificationDate', rectDate);
      data.append('rectificationMeasure', rectMeasure);
      data.append('rectificationResponsiblePerson', rectPerson);
      if (rectPhoto) data.append('rectificationPhoto', rectPhoto);
      const result = await api(`/api/inspections/${record.id}/rectify`, { method: 'PUT', body: data });
      onUpdate(result.record);
    } catch (err) {
      alert(err.message);
    } finally {
      setRectSaving(false);
    }
  }

  async function submitAccept() {
    setAccSaving(true);
    try {
      const result = await api(`/api/inspections/${record.id}/accept`, {
        method: 'PUT',
        body: JSON.stringify({ acceptanceDate: accDate, acceptanceResult: accResult })
      });
      onUpdate(result.record);
    } catch (err) {
      alert(err.message);
    } finally {
      setAccSaving(false);
    }
  }

  const canRectify = record.status === '待整改';
  const canAccept = record.status === '待验收';
  const isAccepted = record.status === '已验收';

  return (
    <div className="record-detail">
      {/* 阶段一：隐患排查 */}
      <Drawer title="隐患排查情况" icon={AlertTriangle} color="#e8590c"
        statusLabel="已完成" defaultOpen={false}>
        <div className="drawer-fields">
          <div className="field-group">
            <div className="field"><span className="field-label">排查日期</span><span className="field-value">{record.date}</span></div>
            <div className="field"><span className="field-label">排查人</span><span className="field-value">{record.inspector || '-'}</span></div>
          </div>
          <div className="field">
            <span className="field-label">隐患照片</span>
            <div className="field-value"><ImageViewer src={record.imageUrl} alt="隐患照片" /></div>
          </div>
          <div className="field">
            <span className="field-label">隐患类型</span>
            <HazardChips labels={record.hazardLabels || []} />
          </div>
          <div className="field">
            <span className="field-label">隐患简述</span>
            <span className="field-value text-block">{record.hazardDescription}</span>
          </div>
          <div className="field">
            <span className="field-label">整改建议</span>
            <span className="field-value text-block">{record.rectificationSuggestion}</span>
          </div>
        </div>
      </Drawer>

      {/* 阶段二：隐患治理 */}
      <Drawer title="隐患治理" icon={Wrench} color="#0d9488"
        statusLabel={canRectify ? '待处理' : (canAccept || isAccepted) ? '已完成' : '待处理'}
        defaultOpen={canRectify}>
        <div className="drawer-fields">
          {canRectify ? (
            <div className="drawer-form">
              <div className="field-group">
                <label>治理日期<input type="date" value={rectDate} onChange={(e) => setRectDate(e.target.value)} /></label>
                <label>整改责任人<input value={rectPerson} onChange={(e) => setRectPerson(e.target.value)} placeholder="例如：李四" /></label>
              </div>
              <label>整改措施<textarea value={rectMeasure} onChange={(e) => setRectMeasure(e.target.value)} placeholder="请填写具体整改措施" /></label>
              <div className="field">
                <span className="field-label">整改照片</span>
                <div className="field-value">
                  <label className="photo-upload-small">
                    {rectPreview ? <img src={rectPreview} alt="整改照片" /> : <span><Upload size={16} />上传照片</span>}
                    <input type="file" accept="image/*" capture="environment" onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) { setRectPhoto(f); setRectPreview(URL.createObjectURL(f)); }
                    }} />
                  </label>
                </div>
              </div>
              <button className="btn-secondary" onClick={submitRectify} disabled={rectSaving}>
                {rectSaving ? '保存中...' : '提交治理结果'}
              </button>
            </div>
          ) : (
            <>
              <div className="field-group">
                <div className="field"><span className="field-label">治理日期</span><span className="field-value">{record.rectificationDate || '-'}</span></div>
                <div className="field"><span className="field-label">整改责任人</span><span className="field-value">{record.rectificationResponsiblePerson || '-'}</span></div>
              </div>
              <div className="field">
                <span className="field-label">整改措施</span>
                <span className="field-value text-block">{record.rectificationMeasure || '-'}</span>
              </div>
              <div className="field">
                <span className="field-label">整改照片</span>
                <div className="field-value"><ImageViewer src={record.rectificationImageUrl} alt="整改照片" /></div>
              </div>
            </>
          )}
        </div>
      </Drawer>

      {/* 阶段三：验收 */}
      <Drawer title="验收" icon={CheckCircle2} color="#16a34a"
        statusLabel={isAccepted ? '已完成' : canAccept ? '待处理' : '未开始'}
        defaultOpen={canAccept}>
        <div className="drawer-fields">
          {canAccept ? (
            <div className="drawer-form">
              <label>验收日期<input type="date" value={accDate} onChange={(e) => setAccDate(e.target.value)} /></label>
              <label>完成情况<textarea value={accResult} onChange={(e) => setAccResult(e.target.value)} placeholder="请填写验收完成情况，如：已整改完成、需继续整改等" /></label>
              <button className="btn-success" onClick={submitAccept} disabled={accSaving}>
                {accSaving ? '保存中...' : '提交验收结果'}
              </button>
            </div>
          ) : isAccepted ? (
            <>
              <div className="field-group">
                <div className="field"><span className="field-label">验收日期</span><span className="field-value">{record.acceptanceDate || '-'}</span></div>
              </div>
              <div className="field">
                <span className="field-label">完成情况</span>
                <span className="field-value text-block">{record.acceptanceResult || '-'}</span>
              </div>
            </>
          ) : (
            <div className="drawer-locked">需先完成隐患治理阶段</div>
          )}
        </div>
      </Drawer>
    </div>
  );
}

/* ─── 历史台账页面 ─── */
function HistoryPage({ user }) {
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);
  const [filters, setFilters] = useState({ date: '', inspector: '' });
  const [error, setError] = useState('');

  async function load() {
    const params = new URLSearchParams();
    if (filters.date) params.set('date', filters.date);
    if (filters.inspector) params.set('inspector', filters.inspector);
    const result = await api(`/api/inspections?${params}`);
    setRecords(result.records);
  }

  useEffect(() => { load().catch((err) => setError(err.message)); }, []);

  async function exportExcel() {
    const response = await api('/api/inspections/export', {
      method: 'POST',
      body: JSON.stringify({ ids: [...selected] })
    });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '安全隐患排查台账.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggle(id) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  function updateRecord(updated) {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  return (
    <section className="panel">
      <div className="table-head">
        <div className="section-title"><FileSpreadsheet /><h2>隐患排查台账</h2></div>
        <button className="primary" disabled={!selected.size} onClick={exportExcel}>导出 Excel</button>
      </div>
      <div className="filters">
        <input type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} />
        <input placeholder="排查人筛选" value={filters.inspector} onChange={(e) => setFilters({ ...filters, inspector: e.target.value })} />
        <button className="ghost" onClick={() => load().catch((err) => setError(err.message))}>查询</button>
        <span>{user.role === 'admin' ? '管理员可查看全部记录' : '普通用户仅查看本人记录'}</span>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="history-list">
        {records.map((record, index) => (
          <div className="history-card" key={record.id}>
            <div className="history-card-header">
              <div className="history-card-info">
                <label className="check-line">
                  <input type="checkbox" checked={selected.has(record.id)} onChange={() => toggle(record.id)} />
                  <span className="history-card-seq">{index + 1}</span>
                </label>
                <div className="history-card-meta">
                  <strong>{record.date} | {record.inspector || '未填写'}</strong>
                  <span>{record.hazardDescription?.slice(0, 40)}...</span>
                  {!!record.hazardLabels?.length && <HazardChips labels={record.hazardLabels} />}
                </div>
              </div>
              <StatusBadge status={record.status} />
            </div>
            <div className="history-card-body">
              <div className="history-card-summary">
                {record.imageUrl && <img className="history-card-img" src={record.imageUrl} alt="隐患照片" onClick={() => setExpandedId(expandedId === record.id ? null : record.id)} />}
                <div className="history-card-text">
                  <strong>隐患描述</strong>
                  <HazardChips labels={record.hazardLabels || []} />
                  <p>{record.hazardDescription}</p>
                </div>
              </div>
            </div>
            <div className="history-card-detail">
              <RecordDetail record={record} onUpdate={updateRecord} />
            </div>
          </div>
        ))}
        {records.length === 0 && <div className="notice">暂无记录</div>}
      </div>
    </section>
  );
}

/* ─── 用户管理 ─── */
function UsersPage() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: '', displayName: '', role: 'user', password: '', phone: '' });
  const [message, setMessage] = useState('');

  async function load() {
    const result = await api('/api/users');
    setUsers(result.users);
  }

  useEffect(() => { load(); }, []);

  async function createUser(event) {
    event.preventDefault();
    try {
      const result = await api('/api/users', { method: 'POST', body: JSON.stringify(form) });
      setMessage(result.temporaryPassword ? `已创建，临时密码：${result.temporaryPassword}` : '已创建用户');
      setForm({ username: '', displayName: '', role: 'user', password: '', phone: '' });
      load();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function patchUser(id, fields) {
    await api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
    load();
  }

  async function editPhone(user) {
    const phone = window.prompt('请输入中国大陆手机号，留空可清除绑定', user.phone || '');
    if (phone === null) return;
    try {
      await patchUser(user.id, { phone });
      setMessage(phone.trim() ? '手机号已更新' : '手机号已清除');
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function resetPassword(id) {
    const result = await api(`/api/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({}) });
    setMessage(`新临时密码：${result.temporaryPassword}`);
  }

  return (
    <section className="management-grid">
      <div className="panel">
        <div className="section-title"><UserCog /><h2>用户管理</h2></div>
        {message && <div className="notice">{message}</div>}
        <div className="responsive-table">
          <table>
            <thead><tr><th>用户名</th><th>角色</th><th>手机号</th><th>状态</th><th>上次登录</th><th>操作</th></tr></thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td>{item.username}<br /><span>{item.displayName}</span></td>
                  <td>{item.role === 'admin' ? '管理员' : '普通用户'}</td>
                  <td>{item.phone || '-'}{item.phone && <br />}<span>{item.phoneVerified ? '已验证' : '未验证'}</span></td>
                  <td>{item.enabled ? '启用' : '停用'}</td>
                  <td>{item.lastLoginAt || '-'}</td>
                  <td>
                    <button className="small" onClick={() => resetPassword(item.id)}>重置密码</button>
                    <button className="small" onClick={() => editPhone(item)}>编辑手机号</button>
                    <button className="small" onClick={() => patchUser(item.id, { enabled: !item.enabled })}>{item.enabled ? '停用' : '启用'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <form className="panel" onSubmit={createUser}>
        <h2>新增用户</h2>
        <input placeholder="用户名" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <input placeholder="姓名/工号" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        <input placeholder="手机号（可选）" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
        <input placeholder="初始复杂密码（留空由系统生成）" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <p className="hint">12 位以上，含大小写/数字/符号，不含用户名。</p>
        <button className="primary">新增用户</button>
      </form>
    </section>
  );
}



/* ─── 安全审计 ─── */
function AuditPage() {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    api('/api/audit-logs').then((result) => setLogs(result.logs));
  }, []);
  return (
    <section className="panel">
      <div className="section-title"><ClipboardList /><h2></h2></div>
      <div className="responsive-table">
        <table>
          <thead><tr><th>时间</th><th>动作</th><th>详情</th><th>IP</th></tr></thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{log.created_at}</td>
                <td>{log.action}</td>
                <td>{log.detail}</td>
                <td>{log.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}



/* ─── 我的手机号 ─── */
function ProfilePage({ user, setUser }) {
  const [phone, setPhone] = useState(user.phone || '');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [message, setMessage] = useState('');
  const phoneBound = Boolean(user.phone && user.phoneVerified);

  useEffect(() => {
    if (!countdown) return undefined;
    const timer = setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  async function requestBindCode() {
    setMessage('');
    try {
      const result = await api('/api/auth/phone/request-bind', {
        method: 'POST',
        body: JSON.stringify({ phone })
      });
      setCountdown(60);
      setMessage(result.message || '验证码已发送');
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function confirmBind(event) {
    event.preventDefault();
    setMessage('');
    try {
      const result = await api('/api/auth/phone/confirm-bind', {
        method: 'POST',
        body: JSON.stringify({ phone, code })
      });
      setUser(result.user);
      setCode('');
      setMessage('手机号已绑定');
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <section className="panel profile-panel">
      <div className="section-title"><Phone /><h2>我的手机号</h2></div>
      <div className="profile-summary">
        <span>当前绑定</span>
        <strong>{user.phone || '未绑定'}</strong>
        <em>{user.phoneVerified ? '已验证' : '未验证'}</em>
      </div>
      {phoneBound ? (
        <div className="success">手机号已绑定并验证，无需再次短信验证。</div>
      ) : (
        <form className="drawer-form" onSubmit={confirmBind}>
          <label>手机号<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="请输入中国大陆手机号" autoComplete="tel" /></label>
          <label>验证码
            <div className="code-row">
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength="6" placeholder="6 位验证码" />
              <button type="button" className="ghost" disabled={countdown > 0} onClick={requestBindCode}>
                {countdown > 0 ? `${countdown}s` : '获取验证码'}
              </button>
            </div>
          </label>
          <p className="hint">本地测试模式会把验证码打印到服务端终端日志。</p>
          {message && <div className="notice">{message}</div>}
          <button className="primary">确认绑定</button>
        </form>
      )}
    </section>
  );
}

/* ─── 主框架 ─── */
function Shell({ user, setUser }) {
  const [view, setView] = useState('inspect');

  async function logout() {
    await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    setUser(null);
  }

  const nav = [
    ['inspect', Camera, '拍照排查'],
    ['history', History, '历史台账'],
    ['profile', Phone, '我的手机号'],



    ...(user.role === 'admin'
          ? [['users', Users, '用户管理']]
          : [])
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-title"><ShieldCheck /><span>安全隐患助手</span></div>
        <nav>
          {nav.map(([key, Icon, label]) => (
            <button key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <strong>S16 荣潍高速改扩建</strong>
            <span>{user.role === 'admin' ? '管理员' : '普通用户'} · {user.username}</span>
          </div>
          <button className="ghost" onClick={logout}><LogOut size={16} /> 退出</button>
        </header>
        {view === 'inspect' && <Inspection user={user} />}
        {view === 'history' && <HistoryPage user={user} />}
        {view === 'profile' && <ProfilePage user={user} setUser={setUser} />}
                {view === 'users' && <UsersPage />}
      </main>
    </div>
  );
}

/* ─── App ─── */
function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api('/api/auth/me')
      .then((result) => setUser(result.user))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="loading">加载中...</div>;
  if (!user) return <Login onLogin={setUser} />;
  return (
    <>
      <Shell user={user} setUser={setUser} />
      {user.mustChangePassword && <ChangePassword onChanged={setUser} />}
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
