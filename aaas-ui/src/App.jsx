import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = "";
const TOKEN_BY_USER = {
  userA: "aaas_demo_token_userA_change_me",
  userB: "aaas_demo_token_userB_change_me",
};

const OPENCLAW_AGENT_ID = "openclaw";

function getRuntimeBadgeStyle(status = "openclaw") {
  const isError = status === "error";
  return {
    background: isError ? "#2d0a0a" : "#052e16",
    color: isError ? "#f87171" : "#4ade80",
    border: `1px solid ${isError ? "#7f1d1d" : "#166534"}`,
    padding: "2px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "0.03em",
  };
}

function WorkspaceTree({ nodes, depth = 0 }) {
  if (!nodes || nodes.length === 0) return null;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, paddingLeft: depth > 0 ? 16 : 0 }}>
      {nodes.map((node) => (
        <li key={node.path || node.name} style={{ margin: "3px 0" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 8px", borderRadius: 6,
            background: node.type === "directory" ? "rgba(96,165,250,0.07)" : "transparent",
            color: node.type === "directory" ? "#93c5fd" : "#94a3b8",
            fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
          }}>
            <span style={{ fontSize: 13 }}>{node.type === "directory" ? "▸" : "·"}</span>
            <span style={{ fontWeight: node.type === "directory" ? 600 : 400 }}>{node.name}</span>
          </div>
          {node.children?.length > 0 && <WorkspaceTree nodes={node.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function ChatBubble({ role, content, ts }) {
  const isUser = role === "user";
  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: "78%",
        background: isUser ? "#2563eb" : "#1e293b",
        color: isUser ? "#fff" : "#cbd5e1",
        padding: "10px 14px",
        borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        fontSize: 13,
        lineHeight: 1.6,
        fontFamily: "'JetBrains Mono', monospace",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        boxShadow: isUser ? "0 2px 8px rgba(37,99,235,0.25)" : "0 2px 8px rgba(0,0,0,0.3)",
      }}>
        {content}
        {ts && (
          <div style={{ fontSize: 10, color: isUser ? "rgba(255,255,255,0.5)" : "#475569", marginTop: 5, textAlign: "right" }}>
            {ts}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [usage, setUsage] = useState([]);
  const [requests, setRequests] = useState([]);
  const [workspace, setWorkspace] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [lastUpdated, setLastUpdated] = useState("");
  const [vmStatus, setVmStatus] = useState(null);

  const [runtimeStatus, setRuntimeStatus] = useState("openclaw");
  const [message, setMessage] = useState("");
  const [chatHistories, setChatHistories] = useState({});
const chatHistory = chatHistories[selectedUser] ?? [];
  const [isRunning, setIsRunning] = useState(false);

  const selectedUserRef = useRef(selectedUser);
  const chatEndRef = useRef(null);

  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatHistory]);

  useEffect(() => {
  loadTenants();
  loadUsage();
  loadVmStatus();

  const timer = setInterval(() => {
    loadUsage();
    loadVmStatus();
      if (selectedUserRef.current) loadUserData(selectedUserRef.current);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (selectedUser) {
      setRuntimeStatus("openclaw");
      loadUserData(selectedUser);
    }
  }, [selectedUser]);

  async function loadTenants() {
    try {
      const res = await fetch(`${API_BASE}/admin/stats`);
      const data = await res.json();
      const loaded = Array.isArray(data.users) ? data.users : [];
      setUsers(loaded);
      if (loaded.length > 0 && !selectedUserRef.current) setSelectedUser(loaded[0]);
    } catch (err) { console.error(err); }
  }

async function loadVmStatus() {
  try {
    const res = await fetch(`${API_BASE}/admin/vm-status`);
    const data = await res.json();
    setVmStatus(data);
  } catch (err) {
    console.error(err);
  }
}

  async function loadUsage() {
    try {
      const res = await fetch(`${API_BASE}/admin/usage`);
      const data = await res.json();
      setUsage(Array.isArray(data.usage) ? data.usage : []);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) { console.error(err); }
  }

  async function loadUserData(userId) {
    await Promise.all([loadRequests(userId), loadWorkspace(userId)]);
  }

  async function loadRequests(userId) {
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/requests?limit=20`);
      const data = await res.json();
      const loaded = Array.isArray(data.requests) ? data.requests : [];
      setRequests(loaded);
      setSelectedRequest((prev) => prev ?? loaded[0] ?? null);
    } catch { setRequests([]); }
  }

  async function loadWorkspace(userId) {
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/workspace`);
      const data = await res.json();
      setWorkspace(Array.isArray(data.tree) ? data.tree : []);
    } catch { setWorkspace([]); }
  }

  async function runAgent() {
  if (!selectedUser || !message.trim()) return;

  const userMsg = message.trim();
  setMessage("");
  const ts = new Date().toLocaleTimeString();

  setChatHistories((prev) => ({
    ...prev,
    [selectedUser]: [...(prev[selectedUser] ?? []), { role: "user", content: userMsg, ts }]
  }));
  setIsRunning(true);
  setRuntimeStatus("openclaw");

  try {
    const res = await fetch(`${API_BASE}/v1/agents/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN_BY_USER[selectedUser] ?? ""}`,
      },
      body: JSON.stringify({
        agent_id: OPENCLAW_AGENT_ID,
        input: userMsg,
        metadata: {
          dashboard_user: selectedUser,
          runtime: "openclaw",
        },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || data.detail || JSON.stringify(data));
    }

    const reply =
      data?.choices?.[0]?.message?.content ??
      data.output ??
      data.response ??
      data.message ??
      JSON.stringify(data, null, 2);

    setChatHistories((prev) => ({
      ...prev,
      [selectedUser]: [...(prev[selectedUser] ?? []), { role: "assistant", content: reply, ts: new Date().toLocaleTimeString() }]
    }));

    await loadUsage();
    await loadUserData(selectedUser);
  } catch (err) {
    setRuntimeStatus("error");
    setChatHistories((prev) => ({
      ...prev,
      [selectedUser]: [...(prev[selectedUser] ?? []), { role: "assistant", content: String(err), ts: new Date().toLocaleTimeString() }]
    }));
  } finally {
    setIsRunning(false);
  }
}

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runAgent(); }
  }

  function changeUser(user) {
    setSelectedUser(user);
    setSelectedRequest(null);
  }

  const selectedUsage = useMemo(() => usage.find((r) => r.tenant === selectedUser), [usage, selectedUser]);
  const totalReq = useMemo(() => usage.reduce((s, r) => s + Number(r.requests || 0), 0), [usage]);
  const totalOk  = useMemo(() => usage.reduce((s, r) => s + Number(r.success  || 0), 0), [usage]);
  const totalErr = useMemo(() => usage.reduce((s, r) => s + Number(r.failed   || 0), 0), [usage]);
const totalTokens = useMemo(() => usage.reduce((s, r) => s + Number(r.total_tokens || 0), 0), [usage]);

  const USER_COLORS = ["#3b82f6","#8b5cf6","#ec4899","#f59e0b","#10b981"];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: Arial, sans-serif;
          background: #020617;
          color: #f1f5f9;
          font-size: 14px;
          line-height: 1.65;
        }

        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }

        .root {
          display: grid;
          grid-template-columns: 200px 1fr;
          grid-template-rows: 48px 1fr;
          height: 100vh;
          overflow: hidden;
        }

        /* ── TOP BAR ── */
        .topbar {
          grid-column: 1 / -1;
          background: #0f172a;
          border-bottom: 1px solid #1e293b;
          display: flex;
          align-items: center;
          padding: 0 20px;
          gap: 14px;
        }
        .logo {
          font-family: 'Syne', sans-serif;
          font-weight: 800;
          font-size: 15px;
          letter-spacing: -0.02em;
          color: #f1f5f9;
        }
        .logo span { color: #3b82f6; }
        .topbar-sep { width: 1px; height: 16px; background: #1e293b; }
        .topbar-sub { font-size: 11px; color: #475569; }
        .topbar-gap { flex: 1; }
        .live-pill {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 10px; border-radius: 999px;
          background: #0f2a1a; border: 1px solid #166534;
          font-size: 11px; color: #4ade80;
        }
        .live-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #22c55e;
          box-shadow: 0 0 6px #22c55e;
          animation: pulse 2s infinite;
        }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

        /* ── SIDEBAR ── */
        .sidebar {
          background: #0f172a;
          border-right: 1px solid #1e293b;
          padding: 16px 10px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          overflow-y: auto;
        }
        .sidebar-section {
          font-size: 9px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.1em; color: #334155;
          padding: 10px 8px 6px;
        }
        .tenant-btn {
          display: flex; align-items: center; gap: 9px;
          padding: 9px 10px;
          border-radius: 8px;
          cursor: pointer;
          color: #64748b;
          transition: all 0.15s;
          border: 1px solid transparent;
        }
        .tenant-btn:hover { background: #1e293b; color: #94a3b8; }
        .tenant-btn.active {
          background: #0f2550;
          color: #93c5fd;
          border-color: #1e40af;
        }
        .tenant-avatar {
          width: 26px; height: 26px; border-radius: 7px;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 700; flex-shrink: 0;
        }
        .tenant-name { font-size: 12px; font-weight: 600; flex: 1; }
        .tenant-count {
          font-size: 10px; padding: 1px 6px;
          border-radius: 999px; background: #1e293b; color: #475569;
        }
        .tenant-count.active { background: #1e3a8a; color: #60a5fa; }

        .sidebar-divider { height: 1px; background: #1e293b; margin: 10px 4px; }

        .stat-mini {
          padding: 8px 10px;
          border-radius: 8px;
          background: #0a0f1e;
          border: 1px solid #1e293b;
          margin-bottom: 4px;
        }
        .stat-mini-label { font-size: 9px; color: #475569; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px; }
        .stat-mini-val { font-size: 18px; font-weight: 700; }

        /* ── MAIN ── */
        .main {
          display: grid;
          grid-template-columns: 1fr 280px;
          grid-template-rows: 1fr auto auto;
          overflow: hidden;
          gap: 0;
        }

        /* ── CHAT COLUMN ── */
        .chat-col {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border-right: 1px solid #1e293b;
        }

        .chat-header {
          padding: 12px 18px;
          border-bottom: 1px solid #1e293b;
          background: #0a0f1e;
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }
        .chat-header-title { font-size: 12px; font-weight: 700; color: #e2e8f0; }
        .chat-header-gap { flex: 1; }

        .agent-input {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 6px;
          padding: 5px 9px;
          color: #93c5fd;
          font: inherit;
          font-size: 11px;
          width: 140px;
        }
        .agent-input:focus { outline: none; border-color: #3b82f6; }

        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 18px;
          background: #020617;
        }
        .chat-empty {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: #1e293b;
        }
        .chat-empty-icon { font-size: 36px; }
        .chat-empty-text { font-size: 12px; color: #334155; }

        .chat-input-row {
          padding: 14px 18px;
          border-top: 1px solid #1e293b;
          background: #0a0f1e;
          display: flex;
          gap: 10px;
          align-items: flex-end;
          flex-shrink: 0;
        }
        .chat-textarea {
          flex: 1;
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 10px;
          padding: 10px 14px;
          color: #e2e8f0;
          font: inherit;
          font-size: 13px;
          resize: none;
          min-height: 44px;
          max-height: 120px;
          line-height: 1.5;
          transition: border-color 0.15s;
        }
        .chat-textarea:focus { outline: none; border-color: #3b82f6; }
        .chat-textarea::placeholder { color: #334155; }
        .send-btn {
          width: 44px; height: 44px;
          background: #2563eb;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 16px;
          transition: background 0.15s, transform 0.1s;
          flex-shrink: 0;
        }
        .send-btn:hover:not(:disabled) { background: #1d4ed8; transform: scale(1.04); }
        .send-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

        /* typing indicator */
        .typing { display: flex; gap: 4px; align-items: center; padding: 10px 14px; }
        .typing span {
          width: 6px; height: 6px; border-radius: 50%; background: #475569;
          animation: bounce 1.2s infinite;
        }
        .typing span:nth-child(2) { animation-delay: 0.15s; }
        .typing span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }

        /* ── RIGHT COLUMN ── */
        .right-col {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: #020617;
        }

        .panel {
          display: flex;
          flex-direction: column;
          border-bottom: 1px solid #1e293b;
          overflow: hidden;
        }
        .panel:last-child { border-bottom: none; flex: 1; }

        .panel-head {
          padding: 10px 14px;
          display: flex;
          align-items: center;
          gap: 8px;
          background: #0a0f1e;
          border-bottom: 1px solid #1e293b;
          flex-shrink: 0;
        }
        .panel-title { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.07em; }
        .panel-gap { flex: 1; }
        .panel-meta { font-size: 10px; color:color: #94a3b8;; }

        .panel-body {
          padding: 12px 14px;
          overflow-y: auto;
          flex: 1;
        }

        /* ── BOTTOM STRIP ── */
        .bottom-strip {
          grid-column: 1 / -1;
          border-top: 1px solid #1e293b;
          background: #0a0f1e;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          max-height: 220px;
        }

        .bottom-head {
          padding: 10px 18px;
          display: flex;
          align-items: center;
          gap: 10px;
          border-bottom: 1px solid #1e293b;
          flex-shrink: 0;
        }
        .bottom-title { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.07em; }
        .bottom-gap { flex: 1; }
        .bottom-meta { font-size: 10px; color: #334155; }

        .log-table { width: 100%; border-collapse: collapse; }
        .log-table th {
          padding: 6px 10px;
          text-align: left;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: #334155;
          background: #0a0f1e;
          position: sticky; top: 0;
        }
        .log-table td {
          padding: 7px 10px;
          font-size: 11px;
          color: #64748b;
          border-bottom: 1px solid #0f172a;
          font-family: 'JetBrains Mono', monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 180px;
        }
        .log-table tr:hover td { background: #0f172a; color: #94a3b8; }
        .log-table tr.row-active td { background: #0c1a3a; color: #93c5fd; }

        .empty-msg { color: #1e293b; text-align: center; padding: 20px; font-size: 12px; }

        /* container info */
        .json-pre {
          background: #0a0f1e;
          border: 1px solid #1e293b;
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 11px;
          color: #475569;
          white-space: pre-wrap;
          word-break: break-all;
          overflow: auto;
          line-height: 1.6;
        }
        .json-pre .k { color: #60a5fa; }
        .json-pre .v { color: #a5b4fc; }


      
      `}</style>

      <div className="root">

        {/* TOP BAR */}
        <header className="topbar">
          <span className="logo">AaaS<span>.</span></span>
          <div className="topbar-sep" />
          <span className="topbar-sub">Multi-tenant Runtime</span>
          <div className="topbar-gap" />
          {lastUpdated && (
            <div className="live-pill">
              <div className="live-dot" />
              {lastUpdated}
            </div>
          )}
        </header>

        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="sidebar-section">Tenants</div>
          {users.map((user, i) => {
            const usg = usage.find((r) => r.tenant === user);
            const color = USER_COLORS[i % USER_COLORS.length];
            const isActive = selectedUser === user;
            return (
              <div
                key={user}
                className={`tenant-btn ${isActive ? "active" : ""}`}
                onClick={() => changeUser(user)}
              >
                <div
                  className="tenant-avatar"
                  style={{ background: isActive ? color + "33" : "#1e293b", color: isActive ? color : "#475569" }}
                >
                  {user.slice(0, 2).toUpperCase()}
                </div>
                <span className="tenant-name">{user}</span>
                <span className={`tenant-count ${isActive ? "active" : ""}`}>
                  {usg?.requests ?? 0}
                </span>
<span style={{ fontSize: 10, color: isActive ? "#a78bfa" : "#334155" }}>
  {usg?.total_tokens ?? 0}t
</span>
              </div>
            );
          })}

          <div className="sidebar-divider" />
          <div className="sidebar-section">Global</div>

          <div className="stat-mini">
            <div className="stat-mini-label">Total Req</div>
            <div className="stat-mini-val" style={{ color: "#60a5fa" }}>{totalReq}</div>
          </div>
          <div className="stat-mini">
            <div className="stat-mini-label">Success</div>
            <div className="stat-mini-val" style={{ color: "#4ade80" }}>{totalOk}</div>
          </div>
          <div className="stat-mini">
            <div className="stat-mini-label">Failed</div>
            <div className="stat-mini-val" style={{ color: "#f87171" }}>{totalErr}</div>
          </div>
<div className="stat-mini">
  <div className="stat-mini-label">Tokens</div>
  <div className="stat-mini-val" style={{ color: "#a78bfa" }}>{totalTokens}</div>
</div>
        </aside>

        {/* MAIN 2-COLUMN AREA */}
        <div className="main">

          {/* CHAT COLUMN */}
          <div className="chat-col">
            <div className="chat-header">
              <span className="chat-header-title">OpenClaw Runtime</span>
                <span style={getRuntimeBadgeStyle(runtimeStatus)}>
                  {runtimeStatus === "error" ? "ERROR" : "OPENCLAW"}
                </span>
                <div className="chat-header-gap" />
                <span style={{ fontSize: 10, color: "#64748b" }}>
                  OpenClaw 
                </span>
            </div>

            <div className="chat-messages">
              {chatHistory.length === 0 ? (
                <div className="chat-empty">
                  <div className="chat-empty-icon">⬡</div>
                  <div className="chat-empty-text">
                    {selectedUser ? `${selectedUser} — 메시지를 입력하세요` : "좌측에서 테넌트를 선택하세요"}
                  </div>
                </div>
              ) : (
                chatHistory.map((msg, i) => (
                  <ChatBubble key={i} role={msg.role} content={msg.content} ts={msg.ts} />
                ))
              )}
              {isRunning && (
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={{
                    background: "#1e293b", borderRadius: "16px 16px 16px 4px",
                    padding: "4px 8px",
                  }}>
                    <div className="typing">
                      <span /><span /><span />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="chat-input-row">
              <textarea
                className="chat-textarea"
                rows={1}
                placeholder="메시지 입력… (Enter 전송, Shift+Enter 줄바꿈)"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                className="send-btn"
                onClick={runAgent}
                disabled={isRunning || !selectedUser || !message.trim()}
                title="Send"
              >
                {isRunning ? "⋯" : "↑"}
              </button>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="right-col">
<div className="panel" style={{ flex: "0 0 auto", maxHeight: "30%" }}>
  <div className="panel-head">
    <span className="panel-title">Azure VM</span>
    <div className="panel-gap" />
    <span className="panel-meta">
      {vmStatus?.connected ? "CONNECTED" : "OFFLINE"}
    </span>
  </div>

  <div className="panel-body">
    {vmStatus ? (
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontSize: 12,
        color: "#cbd5e1",
      }}>
        <div>Host: {vmStatus.host}</div>
        <div>Hostname: {vmStatus.hostname}</div>
        <div>Uptime: {vmStatus.uptime}</div>
        <div>Memory: {vmStatus.memory}</div>
        <div>Root Disk: {vmStatus.root_disk}</div>
        <div>Tenant Disk: {vmStatus.tenant_disk}</div>
        <div>Tenant Files: {vmStatus.tenant_files}</div>
      </div>
    ) : (
      <div className="empty-msg">VM 상태 조회 중...</div>
    )}
  </div>
</div>
            {/* Workspace */}
            <div className="panel" style={{ flex: "0 0 auto", maxHeight: "45%" }}>
              <div className="panel-head">
                <span className="panel-title">Workspace</span>
                <div className="panel-gap" />
                <span className="panel-meta">{selectedUser || "—"}</span>
              </div>
              <div className="panel-body">
                {workspace.length === 0
                  ? <div className="empty-msg">워크스페이스 파일 없음</div>
                  : <WorkspaceTree nodes={workspace} />
                }
              </div>
            </div>

            {/* Container Info */}
            <div className="panel" style={{ flex: 1 }}>
              <div className="panel-head">
                <span className="panel-title">Container</span>
                <div className="panel-gap" />
                <span className="panel-meta">
                  {selectedRequest ? selectedRequest.request_id.slice(0, 8) + "…" : "—"}
                </span>
              </div>
              <div className="panel-body">
                {selectedRequest ? (
                  <pre className="json-pre">
                    {JSON.stringify({
                      container_id: selectedRequest.container_id,
                      tool_calls: selectedRequest.tool_calls,
                      tool_calls_detail: selectedRequest.tool_calls_detail,
                    }, null, 2)}
                  </pre>
                ) : (
                  <div className="empty-msg">요청을 선택하세요</div>
                )}
              </div>
            </div>
          </div>

          {/* BOTTOM LOG STRIP */}
          <div className="bottom-strip">
            <div className="bottom-head">
              <span className="bottom-title">Recent Requests</span>
              <div className="bottom-gap" />
              <span className="bottom-meta">{selectedUser} — limit 20</span>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              <table className="log-table">
                <thead>
                  <tr>
                    <th>request_id</th>
                    <th>agent_id</th>
                    <th>duration</th>
                    <th>tokens</th>
                    <th>status</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.length === 0 ? (
                    <tr><td colSpan={6} className="empty-msg">요청 로그 없음</td></tr>
                  ) : (
                    requests.map((req) => (
                      <tr
                        key={req.request_id}
                        className={selectedRequest?.request_id === req.request_id ? "row-active" : ""}
                        onClick={() => setSelectedRequest(req)}
                        style={{ cursor: "pointer" }}
                      >
                        <td title={req.request_id}>{req.request_id}</td>
                        <td>{req.agent_id}</td>
                        <td>{req.duration_ms}ms</td>
                        <td>{req.token_count}</td>
                        <td style={{ color: req.success ? "#4ade80" : "#f87171" }}>
                          {req.success ? "success" : "failed"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}