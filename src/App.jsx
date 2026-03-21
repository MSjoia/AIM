import { useState, useEffect, useRef, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, Legend
} from "recharts";

/* ─── THEME ───────────────────────────────────────────────── */
const T = {
  bg:       "#0b0f19",
  surface:  "#111827",
  card:     "#1a2235",
  border:   "#243050",
  orange:   "#f97316",
  blue:     "#3b82f6",
  indigo:   "#6366f1",
  green:    "#22c55e",
  red:      "#ef4444",
  yellow:   "#eab308",
  text:     "#e2e8f0",
  muted:    "#64748b",
  dim:      "#334155",
};

const globalStyle = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${T.bg}; color: ${T.text}; font-family: 'Barlow', sans-serif; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: ${T.bg}; }
  ::-webkit-scrollbar-thumb { background: ${T.dim}; border-radius: 3px; }
  .mono { font-family: 'JetBrains Mono', monospace; }
  .condensed { font-family: 'Barlow Condensed', sans-serif; }
  @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
  @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .fade-in { animation: fadeIn 0.35s ease forwards; }
  .blink { animation: pulse-dot 1.2s infinite; }
`;

/* ─── P6 CSV PARSER ───────────────────────────────────────── */
function parseP6CSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const raw = lines[0].replace(/^\uFEFF/, "");
  const headers = raw.split(";").map(h => h.trim());

  const activities = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(";");
    const r = {};
    headers.forEach((h, idx) => { r[h] = (vals[idx] || "").trim(); });

    const id = r["Activity ID"]?.trim();
    const status = r["Activity Status"]?.trim();
    if (!id || !status) continue;

    const parseCost = s => parseFloat((s || "").replace(/Rs\.|\s|,/g, "")) || 0;
    const parsePct  = s => parseFloat((s || "").replace("%", "")) || 0;
    const parseNum  = s => parseInt(s) || 0;

    activities.push({
      id,
      name:               r["Activity Name"]?.trim() || "",
      originalDuration:   parseNum(r["Original Duration"]),
      start:              r["Start"] || "",
      finish:             r["Finish"] || "",
      durationPct:        parsePct(r["Duration % Complete"]),
      blStart:            r["BL Project Start"] || "",
      blFinish:           r["BL Project Finish"] || "",
      variance:           parseNum(r["Variance - BL Project Finish Date"]),
      budgetedCost:       parseCost(r["Budgeted Total Cost"]),
      actualCost:         parseCost(r["Actual Total Cost"]),
      atCompletionDur:    parseNum(r["At Completion Duration"]),
      totalFloat:         parseNum(r["Total Float"]),
      cpi:                parseFloat(r["Cost Performance Index"]) || 0,
      spi:                parseFloat(r["Schedule Performance Index"]) || 0,
      status,
      critical:           r["Critical"] === "Yes",
      wbsPath:            r["WBS Path"] || "",
      predecessors:       r["Predecessors"] || "",
      successors:         r["Successors"] || "",
    });
  }
  return activities;
}

/* ─── METRICS ENGINE ──────────────────────────────────────── */
function computeMetrics(acts) {
  if (!acts.length) return null;

  const total      = acts.length;
  const notStarted = acts.filter(a => a.status === "Not Started").length;
  const inProgress = acts.filter(a => a.status === "In Progress").length;
  const completed  = acts.filter(a => a.status === "Completed").length;

  const criticalAll = acts.filter(a => a.critical);
  const criticalCount = criticalAll.length;

  const f0   = acts.filter(a => a.totalFloat === 0);
  const f1_5 = acts.filter(a => a.totalFloat > 0  && a.totalFloat <= 5);
  const f6_14= acts.filter(a => a.totalFloat > 5  && a.totalFloat <= 14);
  const f15p = acts.filter(a => a.totalFloat > 14);

  const floatDist = [
    { range: "0 (Critical)", count: f0.length,    fill: T.red },
    { range: "1–5 days",     count: f1_5.length,  fill: T.orange },
    { range: "6–14 days",    count: f6_14.length, fill: T.yellow },
    { range: "15+ days",     count: f15p.length,  fill: T.green },
  ];

  const statusDist = [
    { name: "Not Started", value: notStarted, fill: T.muted },
    { name: "In Progress",  value: inProgress, fill: T.blue },
    { name: "Completed",    value: completed,  fill: T.green },
  ].filter(d => d.value > 0);

  // Top at-risk: critical + 0 float + not completed
  const atRisk = acts
    .filter(a => a.totalFloat === 0 && a.critical && a.status !== "Completed")
    .slice(0, 12);

  // Longest activities on critical path
  const longestCritical = [...criticalAll]
    .filter(a => a.originalDuration > 0)
    .sort((a, b) => b.originalDuration - a.originalDuration)
    .slice(0, 8);

  // WBS top-level breakdown
  const wbsMap = {};
  acts.forEach(a => {
    const key = a.wbsPath ? a.wbsPath.split(".")[0] : "Other";
    if (!wbsMap[key]) wbsMap[key] = { name: key, total: 0, critical: 0, completed: 0 };
    wbsMap[key].total++;
    if (a.critical) wbsMap[key].critical++;
    if (a.status === "Completed") wbsMap[key].completed++;
  });
  const wbsData = Object.values(wbsMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const totalBudget = acts.reduce((s, a) => s + a.budgetedCost, 0);
  const totalActual = acts.reduce((s, a) => s + a.actualCost, 0);
  const hasCost = totalBudget > 0;

  // Duration distribution for histogram
  const durBuckets = { "0": 0, "1–5": 0, "6–14": 0, "15–30": 0, "31–60": 0, "60+": 0 };
  acts.forEach(a => {
    const d = a.originalDuration;
    if (d === 0) durBuckets["0"]++;
    else if (d <= 5) durBuckets["1–5"]++;
    else if (d <= 14) durBuckets["6–14"]++;
    else if (d <= 30) durBuckets["15–30"]++;
    else if (d <= 60) durBuckets["31–60"]++;
    else durBuckets["60+"]++;
  });
  const durDist = Object.entries(durBuckets).map(([range, count]) => ({ range, count }));

  const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const criticalPct   = total > 0 ? Math.round((criticalCount / total) * 100) : 0;
  const avgFloat      = acts.length > 0 ? Math.round(acts.reduce((s,a)=>s+a.totalFloat,0)/acts.length) : 0;

  return {
    total, notStarted, inProgress, completed,
    criticalCount, criticalPct, completionPct, avgFloat,
    f0, f1_5, f6_14, f15p,
    floatDist, statusDist, atRisk, longestCritical,
    wbsData, durDist,
    totalBudget, totalActual, hasCost,
  };
}

/* ─── REPORT GENERATOR ────────────────────────────────────── */
function generateReport(projectName, metrics) {
  const today = new Date().toLocaleDateString("en-GB", { day:"numeric",month:"long",year:"numeric" });
  return `WEEKLY PROJECT STATUS REPORT
Project: ${projectName}
Date: ${today}
Generated by: AI Project Manager

═══════════════════════════════════════════
1. EXECUTIVE SUMMARY
═══════════════════════════════════════════
Overall Completion : ${metrics.completionPct}%
Total Activities   : ${metrics.total}
Critical Activities: ${metrics.criticalCount} (${metrics.criticalPct}% of total)
Average Float      : ${metrics.avgFloat} days

─────────────────────────────────────────
2. SCHEDULE STATUS
─────────────────────────────────────────
✅ Completed  : ${metrics.completed} activities
🔄 In Progress: ${metrics.inProgress} activities
⬜ Not Started : ${metrics.notStarted} activities

Float Distribution:
  🔴 0 days (Critical Path) : ${metrics.f0.length} activities
  🟠 1–5 days (High Risk)   : ${metrics.f1_5.length} activities
  🟡 6–14 days (Medium Risk): ${metrics.f6_14.length} activities
  🟢 15+ days (On Track)    : ${metrics.f15p.length} activities

─────────────────────────────────────────
3. TOP AT-RISK ACTIVITIES
─────────────────────────────────────────
${metrics.atRisk.slice(0,5).map((a,i) =>
  `${i+1}. [${a.id}] ${a.name.substring(0,60)}
     Float: ${a.totalFloat}d | Status: ${a.status} | Duration: ${a.originalDuration}d`
).join("\n")}

─────────────────────────────────────────
4. RECOMMENDATIONS
─────────────────────────────────────────
• Prioritize the ${metrics.f0.length} activities with zero float — any delay will impact project completion
• Review and resource-load the ${metrics.inProgress} in-progress activities for potential acceleration
• Schedule weekly look-ahead meetings focused on activities in the 1–14 day float window (${metrics.f1_5.length + metrics.f6_14.length} activities)
${!metrics.hasCost ? "• Cost data not present in this export — re-export from P6 with cost fields to enable EVM analysis (SPI, CPI, EAC, VAC)" : ""}

═══════════════════════════════════════════
END OF REPORT
═══════════════════════════════════════════`;
}

/* ─── HELPER COMPONENTS ───────────────────────────────────── */
const Pill = ({ color, children }) => (
  <span style={{
    background: color + "22", color, border: `1px solid ${color}55`,
    padding: "2px 8px", borderRadius: 4, fontSize: 11,
    fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, letterSpacing: "0.04em",
    whiteSpace: "nowrap"
  }}>{children}</span>
);

const KpiCard = ({ label, value, sub, color, icon }) => (
  <div className="fade-in" style={{
    background: T.card, border: `1px solid ${T.border}`,
    borderLeft: `3px solid ${color}`, borderRadius: 8,
    padding: "14px 18px", display: "flex", flexDirection: "column", gap: 4
  }}>
    <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase",
      letterSpacing: "0.08em", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600 }}>
      {icon} {label}
    </div>
    <div className="mono" style={{ fontSize: 30, fontWeight: 700, color, lineHeight: 1.1 }}>
      {value}
    </div>
    {sub && <div style={{ fontSize: 12, color: T.muted }}>{sub}</div>}
  </div>
);

const Section = ({ title, children }) => (
  <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
    <div style={{
      padding: "10px 16px", borderBottom: `1px solid ${T.border}`,
      fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700,
      fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted
    }}>{title}</div>
    <div style={{ padding: 16 }}>{children}</div>
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 13 }}>
      <div style={{ color: T.muted, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="mono" style={{ color: p.fill || p.color }}>{p.name || p.dataKey}: <strong>{p.value}</strong></div>
      ))}
    </div>
  );
};

/* ─── CHAT BUBBLE ─────────────────────────────────────────── */
function ChatBubble({ msg }) {
  const isUser = msg.role === "user";
  const lines = msg.content.split("\n");
  return (
    <div className="fade-in" style={{
      display: "flex", flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      marginBottom: 14
    }}>
      <div style={{
        maxWidth: "82%",
        background: isUser ? T.indigo + "33" : T.card,
        border: `1px solid ${isUser ? T.indigo + "55" : T.border}`,
        borderRadius: isUser ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
        padding: "10px 14px", fontSize: 14, lineHeight: 1.6,
        color: T.text,
      }}>
        {lines.map((line, i) => {
          if (line.startsWith("**") && line.endsWith("**"))
            return <div key={i} style={{ fontWeight: 700, color: T.orange, marginBottom: 2 }}>{line.replace(/\*\*/g,"")}</div>;
          if (line.startsWith("• ") || line.startsWith("- "))
            return <div key={i} style={{ paddingLeft: 12, color: T.text, marginBottom: 2 }}>· {line.slice(2)}</div>;
          if (line.match(/^\d+\./))
            return <div key={i} style={{ paddingLeft: 12, marginBottom: 2 }}>{line}</div>;
          if (line.trim() === "") return <div key={i} style={{ height: 6 }} />;
          return <div key={i}>{line}</div>;
        })}
      </div>
      <div style={{ fontSize: 10, color: T.muted, marginTop: 3, paddingHorizontal: 4 }}>
        {isUser ? "You" : "🤖 AI Project Manager"}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  MAIN APP                                                    */
/* ═══════════════════════════════════════════════════════════ */
export default function App() {
  const [stage,        setStage]        = useState("upload");
  const [activities,   setActivities]   = useState([]);
  const [metrics,      setMetrics]      = useState(null);
  const [projectName,  setProjectName]  = useState("");
  const [activeTab,    setActiveTab]    = useState("dashboard");
  const [messages,     setMessages]     = useState([]);
  const [chatInput,    setChatInput]    = useState("");
  const [chatLoading,  setChatLoading]  = useState(false);
  const [apiKey,       setApiKey]       = useState("");
  const [apiKeyInput,  setApiKeyInput]  = useState("");
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState("openrouter/free");
  const [filterStatus, setFilterStatus] = useState("all");
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [searchTerm,   setSearchTerm]   = useState("");
  const [reportText,   setReportText]   = useState("");
  const [dragging,     setDragging]     = useState(false);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  /* Load persisted data */
  useEffect(() => {
    (async () => {
      try {
        const k = await window.storage.get("apiKey");
        if (k) setApiKey(k.value);
        const m = await window.storage.get("selectedModel");
        if (m) setSelectedModel(m.value);
        const p = await window.storage.get("projectData");
        if (p) {
          const d = JSON.parse(p.value);
          setActivities(d.activities);
          setMetrics(computeMetrics(d.activities));
          setProjectName(d.projectName);
          setStage("dashboard");
          setMessages([{
            role: "assistant",
            content: `Welcome back! Project **${d.projectName}** is loaded.\n\n📊 ${d.activities.length} activities · 🔴 ${computeMetrics(d.activities)?.criticalCount} critical · ⚠️ ${computeMetrics(d.activities)?.f0.length} zero-float\n\nAsk me anything — delays, float, risks, or say "generate report".`
          }]);
        }
      } catch(e) {}
    })();
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  /* File processing */
  const processFile = useCallback(async (file) => {
    if (!file) return;
    const text = await file.text();
    const parsed = parseP6CSV(text);
    if (parsed.length === 0) { alert("No activities found. Check the file format."); return; }
    const m = computeMetrics(parsed);
    const name = file.name.replace(/\.(csv|xlsx?)$/i, "").replace(/_/g, " ");
    setActivities(parsed);
    setMetrics(m);
    setProjectName(name);
    setStage("dashboard");
    setActiveTab("dashboard");
    setMessages([{
      role: "assistant",
      content: `✅ **${name}** loaded successfully!\n\n📊 ${parsed.length} activities parsed from Primavera P6\n🔴 ${m.criticalCount} critical path activities (${m.criticalPct}%)\n⚠️ ${m.f0.length} activities with zero float\n🟠 ${m.f1_5.length} activities with 1–5 days float\n📅 ${m.notStarted} activities not yet started\n\nI'm your AI Project Manager. Ask me:\n• "Is the project on schedule?"\n• "Which activities are most at risk?"\n• "Generate a weekly status report"\n• "What should the team focus on this week?"`
    }]);
    try {
      await window.storage.set("projectData", JSON.stringify({ activities: parsed, projectName: name }));
    } catch(e) {}
  }, []);

  const handleFileDrop = (e) => {
    e.preventDefault(); setDragging(false);
    processFile(e.dataTransfer.files[0]);
  };

  /* API key */
  const saveApiKey = async () => {
    setApiKey(apiKeyInput);
    try {
      await window.storage.set("apiKey", apiKeyInput);
      await window.storage.set("selectedModel", selectedModel);
    } catch(e) {}
    setShowKeyModal(false);
  };

  /* Build context for AI */
  const buildContext = () => {
    if (!metrics) return "";
    const top = metrics.atRisk.slice(0, 8).map(a =>
      `  [${a.id}] ${a.name.substring(0,55)} | Float:${a.totalFloat} | Status:${a.status} | Dur:${a.originalDuration}d`
    ).join("\n");
    return `
PROJECT: ${projectName}
TOTAL ACTIVITIES: ${metrics.total}
COMPLETION: ${metrics.completionPct}%
Not Started: ${metrics.notStarted} | In Progress: ${metrics.inProgress} | Completed: ${metrics.completed}
CRITICAL COUNT: ${metrics.criticalCount} (${metrics.criticalPct}%)
FLOAT DISTRIBUTION: 0d=${metrics.f0.length} | 1-5d=${metrics.f1_5.length} | 6-14d=${metrics.f6_14.length} | 15+d=${metrics.f15p.length}
AVG FLOAT: ${metrics.avgFloat} days
COST DATA: ${metrics.hasCost ? `Budget Rs.${metrics.totalBudget.toLocaleString()} / Actual Rs.${metrics.totalActual.toLocaleString()}` : "Not available (schedule-only export)"}
AT-RISK ACTIVITIES (critical + 0 float):
${top}
    `.trim();
  };

  /* Send chat */
  const sendMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    if (!apiKey) { setShowKeyModal(true); return; }

    const isReport = chatInput.toLowerCase().includes("report");
    const userMsg = { role: "user", content: chatInput };
    const history = [...messages, userMsg];
    setMessages(history);
    setChatInput("");
    setChatLoading(true);

    if (isReport && metrics) {
      const r = generateReport(projectName, metrics);
      setReportText(r);
      setTimeout(() => {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "✅ **Weekly Status Report generated!**\n\nSwitch to the **Reports** tab to view and copy the full report. Here's the executive summary:\n\n• Completion: " + metrics.completionPct + "%\n• Critical activities: " + metrics.criticalCount + "\n• Zero float: " + metrics.f0.length + " (immediate attention needed)\n• In progress: " + metrics.inProgress + " activities\n\nThe report includes schedule status, at-risk activities, and recommendations."
        }]);
        setActiveTab("reports");
        setChatLoading(false);
      }, 600);
      return;
    }

    try {
      const systemPrompt = `You are an expert AI Construction Project Manager for the Al Rawdah Road Project. You have access to real Primavera P6 schedule data.

COMPUTED PROJECT DATA:
${buildContext()}

YOUR ROLE:
- Answer like a decisive, experienced PM — cite specific numbers from the data above
- For "is project delayed?": assess based on float distribution and critical activity count
- For "what to focus on?": list specific activity IDs with 0 float
- For "SPI/CPI": explain if cost data is unavailable and what data would enable it
- For "optimize": suggest which activities have float that could be redistributed
- Keep responses concise, structured, and actionable
- You are REPLACING a PM — be confident and directive, not vague`;

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": window.location.href,
          "X-Title": "AI Project Manager",
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: 1000,
          messages: [
            { role: "system", content: systemPrompt },
            ...history.map(m => ({ role: m.role, content: m.content })),
          ],
        }),
      });
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content || data.error?.message || "No response received.";
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch(e) {
      setMessages(prev => [...prev, { role: "assistant", content: `⚠️ API Error: ${e.message}\n\nCheck your API key in Settings.` }]);
    }
    setChatLoading(false);
  };

  /* Filtered activities */
  const filteredActs = activities.filter(a => {
    if (filterStatus !== "all" && a.status !== filterStatus) return false;
    if (onlyCritical && !a.critical) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      if (!a.name.toLowerCase().includes(q) && !a.id.toLowerCase().includes(q)) return false;
    }
    return true;
  }).slice(0, 300);

  /* ── RENDER: UPLOAD SCREEN ── */
  if (stage === "upload") return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 32, padding: 24 }}>
      <style>{globalStyle}</style>
      <div style={{ textAlign: "center" }}>
        <div className="condensed" style={{ fontSize: 13, letterSpacing: "0.2em", color: T.orange, textTransform: "uppercase", marginBottom: 12 }}>
          KU Leuven · Technology Valorization
        </div>
        <h1 className="condensed" style={{ fontSize: 52, fontWeight: 800, color: T.text, lineHeight: 1, marginBottom: 8 }}>
          AI PROJECT<br />
          <span style={{ color: T.orange }}>MANAGER</span>
        </h1>
        <p style={{ color: T.muted, fontSize: 15, maxWidth: 460 }}>
          Upload a Primavera P6 export (CSV) and instantly get schedule analytics, critical path analysis, risk alerts, and AI-powered project intelligence.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleFileDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          width: "100%", maxWidth: 480, minHeight: 200,
          border: `2px dashed ${dragging ? T.orange : T.border}`,
          borderRadius: 12, background: dragging ? T.orange + "0a" : T.card,
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", gap: 12, cursor: "pointer",
          transition: "all 0.2s",
        }}>
        <div style={{ fontSize: 40 }}>📂</div>
        <div className="condensed" style={{ fontSize: 18, fontWeight: 700, color: T.text }}>
          Drop your P6 CSV file here
        </div>
        <div style={{ fontSize: 13, color: T.muted }}>or click to browse · supports Primavera P6 exports</div>
        <input ref={fileInputRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={e => processFile(e.target.files[0])} />
      </div>

      {/* Feature pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", maxWidth: 520 }}>
        {["⚡ Instant KPI Dashboard", "🔴 Critical Path Analysis", "⚠️ Proactive Risk Alerts", "🤖 AI Q&A Assistant", "📄 Auto Report Generation", "💾 Persistent Project Memory"].map(f => (
          <div key={f} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 20, padding: "6px 14px", fontSize: 12, color: T.muted }}>{f}</div>
        ))}
      </div>
    </div>
  );

  /* ── RENDER: DASHBOARD ── */
  return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", flexDirection: "column" }}>
      <style>{globalStyle}</style>

      {/* HEADER */}
      <div style={{
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        padding: "0 20px", display: "flex", alignItems: "center", gap: 16, height: 52,
        position: "sticky", top: 0, zIndex: 100
      }}>
        <div className="condensed" style={{ fontSize: 18, fontWeight: 800, color: T.orange, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
          AI PM
        </div>
        <div style={{ width: 1, height: 24, background: T.border }} />
        <div style={{ fontSize: 13, color: T.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {projectName}
        </div>
        {metrics && <Pill color={T.green}>{metrics.total} activities</Pill>}
        {metrics && <Pill color={T.red}>{metrics.criticalCount} critical</Pill>}
        <button onClick={() => { setStage("upload"); setActivities([]); setMetrics(null); }} style={{
          background: "none", border: `1px solid ${T.border}`, color: T.muted,
          padding: "4px 12px", borderRadius: 5, cursor: "pointer", fontSize: 12
        }}>New Project</button>
        <button onClick={() => setShowKeyModal(true)} style={{
          background: T.orange + "22", border: `1px solid ${T.orange}44`, color: T.orange,
          padding: "4px 12px", borderRadius: 5, cursor: "pointer", fontSize: 12
        }}>⚙ API Key</button>
      </div>

      {/* TABS */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "0 20px", display: "flex", gap: 0 }}>
        {[
          { id: "dashboard", label: "📊 Dashboard" },
          { id: "activities", label: "📋 Activities" },
          { id: "chat",       label: "🤖 AI Assistant" },
          { id: "reports",    label: "📄 Reports" },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            background: "none", border: "none",
            borderBottom: activeTab === tab.id ? `2px solid ${T.orange}` : "2px solid transparent",
            color: activeTab === tab.id ? T.orange : T.muted,
            padding: "12px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600,
            transition: "all 0.15s", fontFamily: "'Barlow Condensed',sans-serif",
            letterSpacing: "0.05em", textTransform: "uppercase"
          }}>{tab.label}</button>
        ))}
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, padding: 20, overflow: "auto" }}>

        {/* ─── DASHBOARD TAB ─── */}
        {activeTab === "dashboard" && metrics && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Alert banner */}
            {metrics.f0.length > 0 && (
              <div className="fade-in" style={{
                background: T.red + "15", border: `1px solid ${T.red}44`,
                borderRadius: 8, padding: "10px 16px", display: "flex", gap: 12, alignItems: "center"
              }}>
                <span className="blink" style={{ color: T.red, fontSize: 16 }}>⚠</span>
                <span style={{ fontSize: 13, color: T.text }}>
                  <strong style={{ color: T.red }}>{metrics.f0.length} activities</strong> on the critical path with <strong>zero float</strong> — any delay will push the project completion date.
                  {metrics.f1_5.length > 0 && <> Additionally, <strong style={{ color: T.orange }}>{metrics.f1_5.length} activities</strong> have only 1–5 days float.</>}
                </span>
              </div>
            )}

            {/* KPI Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              <KpiCard label="Total Activities" value={metrics.total} color={T.blue} icon="📊" sub="from P6 export" />
              <KpiCard label="Completion" value={`${metrics.completionPct}%`} color={T.green} icon="✅" sub={`${metrics.completed} activities done`} />
              <KpiCard label="Critical Path" value={metrics.criticalCount} color={T.red} icon="🔴" sub={`${metrics.criticalPct}% of project`} />
              <KpiCard label="Zero Float" value={metrics.f0.length} color={T.red} icon="⚠️" sub="highest risk activities" />
              <KpiCard label="High Risk (1-5d)" value={metrics.f1_5.length} color={T.orange} icon="🟠" sub="approaching critical" />
              <KpiCard label="Avg Float" value={`${metrics.avgFloat}d`} color={T.yellow} icon="📅" sub="schedule buffer" />
              <KpiCard label="Not Started" value={metrics.notStarted} color={T.muted} icon="⬜" sub="awaiting start" />
              <KpiCard label="In Progress" value={metrics.inProgress} color={T.indigo} icon="🔄" sub="currently active" />
            </div>

            {/* Charts row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Section title="Float Distribution (Schedule Buffer)">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={metrics.floatDist} barSize={36}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
                    <XAxis dataKey="range" tick={{ fill: T.muted, fontSize: 11, fontFamily: "'Barlow Condensed'" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: T.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" radius={[4,4,0,0]}>
                      {metrics.floatDist.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Section>

              <Section title="Activity Status Breakdown">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={metrics.statusDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} innerRadius={40} paddingAngle={3}>
                      {metrics.statusDist.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend formatter={(v) => <span style={{ fontSize: 12, color: T.text }}>{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </Section>
            </div>

            {/* WBS chart */}
            {metrics.wbsData.length > 0 && (
              <Section title="WBS Section Breakdown (Top 8)">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={metrics.wbsData} layout="vertical" barSize={12}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border} horizontal={false} />
                    <XAxis type="number" tick={{ fill: T.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fill: T.muted, fontSize: 10, fontFamily: "'Barlow Condensed'" }} width={24} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="total" name="Total" fill={T.blue} radius={[0,3,3,0]} />
                    <Bar dataKey="critical" name="Critical" fill={T.red} radius={[0,3,3,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Section>
            )}

            {/* At-Risk table */}
            {metrics.atRisk.length > 0 && (
              <Section title={`⚠️ Top At-Risk Activities — Critical Path, Zero Float (${metrics.atRisk.length} shown)`}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                        {["Activity ID", "Name", "Duration", "Float", "Status"].map(h => (
                          <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: T.muted,
                            fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.06em",
                            textTransform: "uppercase", fontSize: 11, fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.atRisk.map((a, i) => (
                        <tr key={a.id} style={{ borderBottom: `1px solid ${T.border}22`, background: i % 2 === 0 ? "transparent" : T.border + "15" }}>
                          <td className="mono" style={{ padding: "7px 10px", color: T.orange, fontSize: 11 }}>{a.id}</td>
                          <td style={{ padding: "7px 10px", color: T.text, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</td>
                          <td className="mono" style={{ padding: "7px 10px", color: T.blue }}>{a.originalDuration}d</td>
                          <td className="mono" style={{ padding: "7px 10px" }}><Pill color={T.red}>{a.totalFloat}</Pill></td>
                          <td style={{ padding: "7px 10px" }}><Pill color={T.muted}>{a.status}</Pill></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {!metrics.hasCost && (
              <div style={{
                background: T.yellow + "10", border: `1px solid ${T.yellow}30`,
                borderRadius: 8, padding: "10px 16px", fontSize: 13, color: T.muted
              }}>
                💡 <strong style={{ color: T.yellow }}>Cost data not found</strong> — This export contains schedule data only. To enable EVM metrics (SPI, CPI, EAC, VAC), re-export from Primavera P6 with <em>Budgeted Total Cost</em> and <em>Actual Total Cost</em> columns populated.
              </div>
            )}
          </div>
        )}

        {/* ─── ACTIVITIES TAB ─── */}
        {activeTab === "activities" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Filters */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input
                placeholder="🔍  Search activity ID or name..."
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                style={{ flex: 1, minWidth: 220, background: T.card, border: `1px solid ${T.border}`,
                  color: T.text, padding: "8px 12px", borderRadius: 6, fontSize: 13, outline: "none" }}
              />
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                style={{ background: T.card, border: `1px solid ${T.border}`, color: T.text,
                  padding: "8px 12px", borderRadius: 6, fontSize: 13, outline: "none", cursor: "pointer" }}>
                <option value="all">All Statuses</option>
                <option value="Not Started">Not Started</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: T.text }}>
                <input type="checkbox" checked={onlyCritical} onChange={e => setOnlyCritical(e.target.checked)}
                  style={{ accentColor: T.red, width: 14, height: 14 }} />
                Critical only
              </label>
              <div style={{ fontSize: 12, color: T.muted }}>{filteredActs.length} activities shown</div>
            </div>

            {/* Table */}
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead style={{ position: "sticky", top: 0, background: T.surface, zIndex: 1 }}>
                    <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                      {["Activity ID", "Name", "Duration", "Start", "Finish", "Float", "Status", "Critical"].map(h => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: T.muted,
                          fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.06em",
                          textTransform: "uppercase", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredActs.map((a, i) => (
                      <tr key={a.id} style={{ borderBottom: `1px solid ${T.border}22`, background: i%2===0?"transparent":T.border+"10" }}>
                        <td className="mono" style={{ padding: "6px 10px", color: T.orange, fontSize: 11, whiteSpace: "nowrap" }}>{a.id}</td>
                        <td style={{ padding: "6px 10px", color: T.text, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.name}>{a.name}</td>
                        <td className="mono" style={{ padding: "6px 10px", color: T.blue, whiteSpace: "nowrap" }}>{a.originalDuration}d</td>
                        <td className="mono" style={{ padding: "6px 10px", color: T.muted, fontSize: 11, whiteSpace: "nowrap" }}>{a.start || "—"}</td>
                        <td className="mono" style={{ padding: "6px 10px", color: T.muted, fontSize: 11, whiteSpace: "nowrap" }}>{a.finish || "—"}</td>
                        <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                          <Pill color={a.totalFloat === 0 ? T.red : a.totalFloat <= 5 ? T.orange : a.totalFloat <= 14 ? T.yellow : T.green}>
                            {a.totalFloat}d
                          </Pill>
                        </td>
                        <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                          <Pill color={a.status==="Completed"?T.green:a.status==="In Progress"?T.blue:T.muted}>{a.status}</Pill>
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>{a.critical ? "🔴" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─── AI ASSISTANT TAB ─── */}
        {activeTab === "chat" && (
          <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 160px)", gap: 14 }}>

            {/* Context badge */}
            <div style={{ background: T.green + "10", border: `1px solid ${T.green}30`, borderRadius: 6, padding: "8px 14px", fontSize: 12, color: T.muted }}>
              🧠 <strong style={{ color: T.green }}>AI has full project context</strong> — {metrics?.total} activities · {metrics?.criticalCount} critical · {metrics?.f0.length} zero-float · Schedule + WBS data loaded
              {!apiKey && <span style={{ marginLeft: 10, color: T.orange }}>⚠ Set your API key to enable chat →</span>}
            </div>

            {/* Suggested questions */}
            {messages.length <= 1 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {["Is the project on schedule?", "Which activities are most at risk?", "What should the team focus on this week?", "Generate a weekly status report", "Explain the critical path", "Which activities have float I can use?"].map(q => (
                  <button key={q} onClick={() => { setChatInput(q); }} style={{
                    background: T.card, border: `1px solid ${T.border}`, color: T.muted,
                    padding: "6px 12px", borderRadius: 16, cursor: "pointer", fontSize: 12,
                    transition: "all 0.15s"
                  }}>{q}</button>
                ))}
              </div>
            )}

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}>
              {messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
              {chatLoading && (
                <div className="fade-in" style={{ display: "flex", gap: 6, padding: "10px 14px" }}>
                  {[0,1,2].map(i => <div key={i} className="blink" style={{ width:8, height:8, borderRadius:"50%", background:T.orange, animationDelay:`${i*0.2}s` }} />)}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div style={{ display: "flex", gap: 10 }}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder={apiKey ? "Ask about delays, float, risks, or say 'generate report'..." : "Enter API key in Settings to enable AI chat..."}
                style={{
                  flex: 1, background: T.card, border: `1px solid ${T.border}`,
                  color: T.text, padding: "12px 16px", borderRadius: 8, fontSize: 14, outline: "none",
                  fontFamily: "'Barlow',sans-serif"
                }}
              />
              <button onClick={sendMessage} disabled={chatLoading || !chatInput.trim()} style={{
                background: chatLoading || !chatInput.trim() ? T.dim : T.orange,
                border: "none", color: chatLoading ? T.muted : "#000",
                padding: "12px 20px", borderRadius: 8, cursor: "pointer",
                fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700,
                fontSize: 14, letterSpacing: "0.05em", transition: "all 0.15s"
              }}>SEND</button>
            </div>
          </div>
        )}

        {/* ─── REPORTS TAB ─── */}
        {activeTab === "reports" && metrics && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setReportText(generateReport(projectName, metrics)); }} style={{
                background: T.orange, border: "none", color: "#000",
                padding: "10px 20px", borderRadius: 6, cursor: "pointer",
                fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 14
              }}>🔄 Regenerate Report</button>
              <button onClick={() => reportText && navigator.clipboard.writeText(reportText)} style={{
                background: T.card, border: `1px solid ${T.border}`, color: T.text,
                padding: "10px 20px", borderRadius: 6, cursor: "pointer",
                fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, fontSize: 14
              }}>📋 Copy to Clipboard</button>
            </div>
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 20 }}>
              {reportText ? (
                <pre className="mono" style={{ fontSize: 13, lineHeight: 1.7, color: T.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {reportText}
                </pre>
              ) : (
                <div style={{ color: T.muted, textAlign: "center", padding: 40 }}>
                  Click "Regenerate Report" or ask the AI assistant to "generate a report"
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── API KEY MODAL ── */}
      {showKeyModal && (
        <div style={{
          position: "fixed", inset: 0, background: "#00000080",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999
        }} onClick={e => e.target === e.currentTarget && setShowKeyModal(false)}>
          <div className="fade-in" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 28, width: 460, maxWidth: "95vw" }}>
            <div className="condensed" style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>⚙ Settings</div>
            <div style={{ width: 40, height: 2, background: T.orange, marginBottom: 16 }} />

            <div style={{ fontSize: 12, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 6 }}>OpenRouter API Key</div>
            <p style={{ fontSize: 13, color: T.muted, marginBottom: 10, lineHeight: 1.6 }}>
              Get a free key from <span style={{ color: T.blue }}>admin</span>. It's free to use. Key is stored in your browser only.
            </p>
            <input
              type="password" value={apiKeyInput} onChange={e => setApiKeyInput(e.target.value)}
              placeholder="sk-or-v1-..."
              onKeyDown={e => e.key === "Enter" && saveApiKey()}
              style={{ width: "100%", background: T.card, border: `1px solid ${T.border}`,
                color: T.text, padding: "10px 14px", borderRadius: 6, fontSize: 13, outline: "none",
                marginBottom: 16, fontFamily: "'JetBrains Mono',monospace"
              }}
            />

            <div style={{ fontSize: 12, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 6 }}>AI Model</div>
            <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} style={{
              width: "100%", background: T.card, border: `1px solid ${T.border}`,
              color: T.text, padding: "10px 14px", borderRadius: 6, fontSize: 13,
              outline: "none", cursor: "pointer", marginBottom: 6,
            }}>
              <optgroup label="🆓 Free (Auto)">
                <option value="openrouter/free">Auto — Best Available Free Model ⭐ Recommended</option>
              </optgroup>
              <optgroup label="🆓 Free (Specific Models)">
                <option value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B (Free)</option>
                <option value="meta-llama/llama-4-scout:free">Llama 4 Scout (Free)</option>
                <option value="meta-llama/llama-4-maverick:free">Llama 4 Maverick (Free)</option>
                <option value="google/gemini-2.0-flash-exp:free">Gemini 2.0 Flash Exp (Free)</option>
                <option value="mistralai/mistral-7b-instruct:free">Mistral 7B (Free)</option>
                <option value="deepseek/deepseek-r1:free">DeepSeek R1 (Free)</option>
                <option value="allenai/olmo-3.1-32b-think:free">OLMo 3.1 32B (Free)</option>
              </optgroup>
              <optgroup label="💳 Paid (higher quality)">
                <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
                <option value="anthropic/claude-3-5-haiku">Claude 3.5 Haiku</option>
                <option value="google/gemini-flash-1.5">Gemini Flash 1.5</option>
              </optgroup>
            </select>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 16 }}>
              💡 <strong style={{color: T.yellow}}>Tip:</strong> Use "Auto" to never hit availability errors — OpenRouter picks the best free model automatically. 20 req/min · 200 req/day limit on free models.
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={saveApiKey} style={{
                background: T.orange, border: "none", color: "#000",
                padding: "10px 20px", borderRadius: 6, cursor: "pointer",
                fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 14, flex: 1
              }}>Save Settings</button>
              <button onClick={() => setShowKeyModal(false)} style={{
                background: T.card, border: `1px solid ${T.border}`, color: T.muted,
                padding: "10px 20px", borderRadius: 6, cursor: "pointer", fontSize: 14
              }}>Cancel</button>
            </div>
            {apiKey && <div style={{ marginTop: 10, fontSize: 12, color: T.green }}>✓ API key is set · Model: {selectedModel.split("/")[1]}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
