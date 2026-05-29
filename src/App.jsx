import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";
import {
  doc, getDoc, setDoc, deleteDoc, onSnapshot,
  collection, getDocs, writeBatch, updateDoc,
} from "firebase/firestore";

// ── Collections ───────────────────────────────────────────
const COL_RES   = "jf_reservations";  // {companyName, contactName, contactEmail, contactPhone, code, ts}
const COL_CODES = "jf_codes";         // {used: bool, companyName: str, boothId: str|null}

// ── Admin ──────────────────────────────────────────────────
const ADMIN_PW = "jobfair2026admin";

// ── Floor Plan Layout ─────────────────────────────────────
// All booths: 3m wide × 2m deep
// Scale: 18px/m → BW=54, BD=36
const BW = 54, BD = 36;
const HALL_W = 720, HALL_H = 460;

// Row positions
const TOP_Y    = 18;                        // top wall row top edge
const BOT_Y    = HALL_H - BD - 18;          // bottom wall row top edge (406)
const ISL_T_Y  = HALL_H / 2 - BD - 5;      // island top face top edge (189)
const ISL_B_Y  = HALL_H / 2 + 5;           // island bottom face top edge (235)

// X anchors
// Top row (9–17):    rightmost booth 9 ends at x=700, booth 17 leftmost at x=214
// Bottom row (1–8):  right-aligned with entrance (east) wall → right edge at x=700
//                    so BOT_X0 = 700 - 8*54 = 268
// Center island (18–33): 8 per row, starts at x=144
const BOT_X0  = 268;   // booth 1 left edge (right-aligned with east wall)
const TOP_X0  = 214;   // booth 17 left edge (leftmost of top row)
const ISL_X0  = 144;   // booth 18 / 33 left edge

// Build booth positions map
const BOOTHS = {};

// Bottom wall: booths 1–8, left to right
for (let i = 0; i < 8; i++) {
  BOOTHS[String(i + 1)] = { x: BOT_X0 + i * BW, y: BOT_Y, w: BW, h: BD, row: "bottom" };
}

// Top wall: booths 17(left)…9(right) → render left-to-right as 17,16,…,9
for (let i = 0; i < 9; i++) {
  const num = 17 - i;
  BOOTHS[String(num)] = { x: TOP_X0 + i * BW, y: TOP_Y, w: BW, h: BD, row: "top" };
}

// Island top face: 18–25 left to right
for (let i = 0; i < 8; i++) {
  BOOTHS[String(18 + i)] = { x: ISL_X0 + i * BW, y: ISL_T_Y, w: BW, h: BD, row: "island-top" };
}

// Island bottom face: 33(left)…26(right) left to right
for (let i = 0; i < 8; i++) {
  BOOTHS[String(33 - i)] = { x: ISL_X0 + i * BW, y: ISL_B_Y, w: BW, h: BD, row: "island-bot" };
}

// ── Helpers ───────────────────────────────────────────────
function randomCode(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function exportCSV(rows, filename) {
  const headers = ["Booth", "Company", "Contact Name", "Email", "Phone", "Code", "Reserved At"];
  const lines = [headers.join(","), ...rows.map(r =>
    [r.boothId, `"${r.companyName}"`, `"${r.contactName}"`, r.contactEmail, r.contactPhone, r.code,
     new Date(r.ts).toLocaleString()].join(",")
  )];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ── Styles (inline, no external CSS) ─────────────────────
const C = {
  navy: "#0d1f5c",
  navyD: "#091548",
  cyan: "#29b6d4",
  cyanL: "#e0f7fa",
  white: "#ffffff",
  gray: "#f1f5f9",
  grayD: "#94a3b8",
  text: "#1e293b",
  green: "#16a34a",
  red: "#dc2626",
  amber: "#d97706",
};

const S = {
  page: { minHeight: "100vh", background: C.navy, display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px 48px" },
  card: { background: C.white, borderRadius: 16, padding: 32, width: "100%", maxWidth: 520, boxShadow: "0 8px 32px rgba(0,0,0,0.3)" },
  title: { fontSize: 26, fontWeight: 700, color: C.navy, marginBottom: 4, textAlign: "center" },
  sub: { fontSize: 14, color: C.grayD, textAlign: "center", marginBottom: 24 },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: C.navy, marginBottom: 6 },
  input: { width: "100%", padding: "10px 14px", border: `1.5px solid #d1d5db`, borderRadius: 8, fontSize: 15, outline: "none", transition: "border-color .2s" },
  btnPrimary: { width: "100%", padding: "12px", background: C.cyan, color: C.white, border: "none", borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: "pointer", marginTop: 12, letterSpacing: ".5px" },
  btnDanger: { padding: "8px 16px", background: C.red, color: C.white, border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  btnGhost: { padding: "8px 16px", background: "transparent", color: C.grayD, border: `1px solid #d1d5db`, borderRadius: 6, fontSize: 13, cursor: "pointer" },
  error: { background: "#fee2e2", color: C.red, padding: "10px 14px", borderRadius: 8, fontSize: 14, marginTop: 8 },
  success: { background: "#dcfce7", color: C.green, padding: "10px 14px", borderRadius: 8, fontSize: 14, marginTop: 8 },
  tag: (color) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600, background: color + "22", color }),
};

// ── App ───────────────────────────────────────────────────
export default function App() {
  // ── State ───────────────────────────────────────────────
  const [reservations, setReservations] = useState({});          // {boothId: docData}
  const [phase, setPhase]               = useState("code");      // code | map | form | success
  const [codeInput, setCodeInput]       = useState("");
  const [validCode, setValidCode]       = useState(null);        // validated code string
  const [selectedBooth, setSelectedBooth] = useState(null);
  const [form, setForm]                 = useState({ companyName: "", contactName: "", contactEmail: "", contactPhone: "" });
  const [loading, setLoading]           = useState(false);
  const [err, setErr]                   = useState("");
  const [successMsg, setSuccessMsg]     = useState("");
  const [titleClicks, setTitleClicks]   = useState(0);

  // Admin state
  const [adminOpen, setAdminOpen]       = useState(false);
  const [adminPw, setAdminPw]           = useState("");
  const [adminErr, setAdminErr]         = useState("");
  const [adminMode, setAdminMode]       = useState(false);
  const [adminTab, setAdminTab]         = useState("map");       // map | codes | list
  const [allCodes, setAllCodes]         = useState([]);
  const [genCount, setGenCount]         = useState("10");
  const [genPrefix, setGenPrefix]       = useState("");
  const [newCodes, setNewCodes]         = useState([]);
  const [codeSearch, setCodeSearch]     = useState("");
  const [confirmCancel, setConfirmCancel] = useState(null);      // boothId to cancel

  // ── Real-time reservations ──────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, COL_RES), (snap) => {
      const map = {};
      snap.docs.forEach((d) => { map[d.id] = d.data(); });
      setReservations(map);
    });
    return unsub;
  }, []);

  // ── Load codes when admin opens codes tab ───────────────
  useEffect(() => {
    if (adminMode && adminTab === "codes") refreshCodes();
  }, [adminMode, adminTab]);

  async function refreshCodes() {
    const snap = await getDocs(collection(db, COL_CODES));
    setAllCodes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  // ── Title click (admin entry) ───────────────────────────
  function handleTitleClick() {
    const n = titleClicks + 1;
    setTitleClicks(n);
    if (n >= 5) { setAdminOpen(true); setTitleClicks(0); }
  }

  // ── Code validation ─────────────────────────────────────
  async function handleCodeSubmit(e) {
    e.preventDefault();
    setErr("");
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    try {
      const ref = doc(db, COL_CODES, code);
      const snap = await getDoc(ref);
      if (!snap.exists()) { setErr("Invalid access code. Please check with the organizer."); return; }
      const data = snap.data();
      if (data.used) {
        // Code already used — let them in as view-only, highlight their booth
        setValidCode(code);
        setSelectedBooth(data.boothId);
        setPhase("viewmap");
        return;
      }
      setValidCode(code);
      setPhase("map");
    } catch {
      setErr("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Booth selection ─────────────────────────────────────
  function handleBoothClick(id) {
    if (reservations[id]) return; // already taken
    setSelectedBooth(id);
    setPhase("form");
    setErr("");
  }

  // ── Reservation submit ──────────────────────────────────
  async function handleReserve(e) {
    e.preventDefault();
    setErr("");
    const { companyName, contactName, contactEmail, contactPhone } = form;
    if (!companyName.trim() || !contactName.trim() || !contactEmail.trim() || !contactPhone.trim()) {
      setErr("Please fill in all fields."); return;
    }
    if (reservations[selectedBooth]) { setErr("This booth was just taken. Please pick another."); setPhase("map"); return; }
    setLoading(true);
    try {
      const ts = Date.now();
      await setDoc(doc(db, COL_RES, selectedBooth), { companyName: companyName.trim(), contactName: contactName.trim(), contactEmail: contactEmail.trim(), contactPhone: contactPhone.trim(), code: validCode, ts });
      await updateDoc(doc(db, COL_CODES, validCode), { used: true, companyName: companyName.trim(), boothId: selectedBooth });
      setPhase("success");
      setSuccessMsg(`Booth #${selectedBooth} successfully reserved for ${companyName.trim()}.`);
    } catch {
      setErr("Failed to reserve. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Admin login ─────────────────────────────────────────
  function handleAdminLogin(e) {
    e.preventDefault();
    if (adminPw === ADMIN_PW) { setAdminMode(true); setAdminOpen(false); setAdminPw(""); setAdminErr(""); }
    else setAdminErr("Incorrect password.");
  }

  // ── Generate codes ──────────────────────────────────────
  async function handleGenerateCodes() {
    const n = parseInt(genCount) || 10;
    if (n < 1 || n > 200) { alert("Enter a number between 1 and 200."); return; }
    setLoading(true);
    const codes = [];
    const batch = writeBatch(db);
    for (let i = 0; i < n; i++) {
      let code;
      do { code = (genPrefix ? genPrefix.toUpperCase().replace(/[^A-Z0-9]/g,"") : "") + randomCode(genPrefix ? 3 : 5); }
      while (allCodes.find((c) => c.id === code));
      codes.push(code);
      batch.set(doc(db, COL_CODES, code), { used: false, companyName: "", boothId: null, createdAt: Date.now() });
    }
    await batch.commit();
    setNewCodes(codes);
    await refreshCodes();
    setLoading(false);
  }

  // ── Delete code ─────────────────────────────────────────
  async function handleDeleteCode(code) {
    if (!confirm(`Delete code ${code}? This cannot be undone.`)) return;
    await deleteDoc(doc(db, COL_CODES, code));
    await refreshCodes();
  }

  // ── Cancel reservation ──────────────────────────────────
  async function handleCancelReservation(boothId) {
    const res = reservations[boothId];
    if (!res) return;
    setLoading(true);
    try {
      await deleteDoc(doc(db, COL_RES, boothId));
      if (res.code) {
        await updateDoc(doc(db, COL_CODES, res.code), { used: false, companyName: "", boothId: null });
      }
      setConfirmCancel(null);
    } catch { alert("Error cancelling reservation."); }
    finally { setLoading(false); }
  }

  // ── Export CSV ──────────────────────────────────────────
  function handleExport() {
    const rows = Object.entries(reservations).map(([boothId, d]) => ({ boothId, ...d }));
    rows.sort((a, b) => Number(a.boothId) - Number(b.boothId));
    exportCSV(rows, "cue-job-fair-reservations.csv");
  }

  // ── Render ───────────────────────────────────────────────
  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div onClick={handleTitleClick} style={{ cursor: "pointer", userSelect: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <img src="/cue-logo.png" alt="CUE Logo" style={{ height: 80, objectFit: "contain" }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: C.cyan, letterSpacing: 2 }}>
            CATHOLIC UNIVERSITY IN ERBIL
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: C.white, letterSpacing: 1 }}>
            JOB FAIR 2026
          </div>
          <div style={{ fontSize: 13, color: "#93c5fd" }}>
            Booth Reservation System
          </div>
        </div>
        {adminMode && (
          <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "center" }}>
            <span style={S.tag(C.cyan)}>ADMIN MODE</span>
            <button onClick={() => setAdminMode(false)} style={{ ...S.btnGhost, fontSize: 11, padding: "3px 10px" }}>Exit</button>
          </div>
        )}
      </div>

      {/* ── Phase: Code Entry ── */}
      {phase === "code" && (
        <div style={S.card}>
          <div style={S.title}>Enter Your Access Code</div>
          <div style={S.sub}>
            Each company receives a unique code from the organizer.<br />
            Enter it below to access the booth reservation.
          </div>
          <form onSubmit={handleCodeSubmit}>
            <label style={S.label}>Access Code</label>
            <input
              style={{ ...S.input, textTransform: "uppercase", letterSpacing: 3, fontSize: 18, textAlign: "center", fontWeight: 700 }}
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="e.g. CUEX7K"
              maxLength={20}
              autoFocus
            />
            {err && <div style={S.error}>{err}</div>}
            <button style={S.btnPrimary} disabled={loading}>
              {loading ? "Checking…" : "Continue →"}
            </button>
          </form>

          {/* Stats bar */}
          <div style={{ marginTop: 24, padding: "14px 0", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-around" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.navy }}>{Object.keys(reservations).length}</div>
              <div style={{ fontSize: 12, color: C.grayD }}>Reserved</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.green }}>{33 - Object.keys(reservations).length}</div>
              <div style={{ fontSize: 12, color: C.grayD }}>Available</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.navy }}>33</div>
              <div style={{ fontSize: 12, color: C.grayD }}>Total Booths</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Phase: Map ── */}
      {(phase === "map" || (adminMode && adminTab === "map")) && (
        <div style={{ width: "100%", maxWidth: 800 }}>
          {phase === "map" && (
            <div style={{ background: "#1e3a8a22", border: "1px solid #3b82f680", borderRadius: 10, padding: "10px 16px", marginBottom: 16, color: "#bfdbfe", fontSize: 14, textAlign: "center" }}>
              ✓ Code <strong>{validCode}</strong> verified. Select an available booth on the floor plan below.
            </div>
          )}
          <FloorPlan
            reservations={reservations}
            onBoothClick={phase === "map" ? handleBoothClick : adminMode ? (id) => setConfirmCancel(id) : null}
            adminMode={adminMode}
            phase={phase}
          />
          {phase === "map" && (
            <div style={{ marginTop: 12, display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
              <Legend color={C.green} label="Available" />
              <Legend color={C.red} label="Reserved" />
              <Legend color={C.cyan} label="Your selection" />
            </div>
          )}
        </div>
      )}

      {/* ── Phase: Form ── */}
      {phase === "form" && (
        <div style={S.card}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <button onClick={() => setPhase("map")} style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 13 }}>← Back</button>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.navy }}>Reserve Booth #{selectedBooth}</div>
              <div style={{ fontSize: 12, color: C.grayD }}>3m × 2m — CUE Main Cafeteria</div>
            </div>
          </div>
          <form onSubmit={handleReserve}>
            <FormField label="Company Name" value={form.companyName} onChange={(v) => setForm({ ...form, companyName: v })} placeholder="e.g. Acme Corporation" />
            <FormField label="Contact Person" value={form.contactName} onChange={(v) => setForm({ ...form, contactName: v })} placeholder="Full name of representative" />
            <FormField label="Contact Email" type="email" value={form.contactEmail} onChange={(v) => setForm({ ...form, contactEmail: v })} placeholder="name@company.com" />
            <FormField label="Contact Phone" type="tel" value={form.contactPhone} onChange={(v) => setForm({ ...form, contactPhone: v })} placeholder="+964 7xx xxx xxxx" />
            {err && <div style={S.error}>{err}</div>}
            <button style={S.btnPrimary} disabled={loading}>
              {loading ? "Reserving…" : `Confirm Booth #${selectedBooth}`}
            </button>
          </form>
        </div>
      )}

      {/* ── Phase: Success ── */}
      {phase === "success" && (
        <div style={S.card}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>🎉</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.green, marginBottom: 8 }}>Reservation Confirmed!</div>
            <div style={{ fontSize: 15, color: C.text, marginBottom: 20 }}>{successMsg}</div>
            <div style={{ background: C.gray, borderRadius: 10, padding: 16, textAlign: "left", marginBottom: 20 }}>
              <InfoRow label="Company" value={form.companyName} />
              <InfoRow label="Booth" value={`#${selectedBooth} — CUE Main Cafeteria`} />
              <InfoRow label="Contact" value={form.contactName} />
              <InfoRow label="Email" value={form.contactEmail} />
              <InfoRow label="Phone" value={form.contactPhone} />
            </div>
            <div style={{ fontSize: 13, color: C.grayD, marginBottom: 20 }}>
              Please save a screenshot of this page for your records. A representative will contact you with further details.
            </div>
            <button onClick={() => setPhase("viewmap")} style={{ ...S.btnPrimary, marginTop: 0, background: C.navy }}>
              🗺 View Live Floor Map
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: View Map (read-only after reservation) ── */}
      {phase === "viewmap" && (
        <div style={{ width: "100%", maxWidth: 880 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <button onClick={() => setPhase("success")} style={{ ...S.btnGhost, color: C.white, borderColor: "#ffffff44" }}>← Back</button>
            <div style={{ color: C.white, fontSize: 14 }}>
              Live floor map — your booth <strong style={{ color: C.cyan }}>#{selectedBooth}</strong> is highlighted in red.
            </div>
          </div>
          <FloorPlan reservations={reservations} onBoothClick={null} adminMode={false} phase="viewmap" highlightBooth={selectedBooth} />
          <div style={{ marginTop: 12, display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <Legend color={C.green} label="Available" />
            <Legend color={C.red} label="Reserved" />
          </div>
        </div>
      )}

      {/* ── Admin Panel (overlay) ── */}
      {adminMode && adminTab !== "map" && (
        <AdminPanel
          tab={adminTab} setTab={setAdminTab}
          allCodes={allCodes} codeSearch={codeSearch} setCodeSearch={setCodeSearch}
          genCount={genCount} setGenCount={setGenCount}
          genPrefix={genPrefix} setGenPrefix={setGenPrefix}
          newCodes={newCodes} setNewCodes={setNewCodes}
          loading={loading}
          onGenerate={handleGenerateCodes}
          onDeleteCode={handleDeleteCode}
          reservations={reservations}
          onExport={handleExport}
          onCancelRes={(id) => setConfirmCancel(id)}
        />
      )}

      {/* Admin tab switcher (when in admin mode) */}
      {adminMode && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: C.navyD, borderRadius: 50, padding: "8px 12px", display: "flex", gap: 6, boxShadow: "0 4px 24px rgba(0,0,0,.5)", zIndex: 999 }}>
          {["map", "codes", "list"].map((t) => (
            <button key={t} onClick={() => setAdminTab(t)} style={{ padding: "8px 18px", borderRadius: 50, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, background: adminTab === t ? C.cyan : "transparent", color: adminTab === t ? C.white : C.grayD }}>
              {t === "map" ? "🗺 Map" : t === "codes" ? "🔑 Codes" : "📋 List"}
            </button>
          ))}
        </div>
      )}

      {/* Admin login modal */}
      {adminOpen && !adminMode && (
        <Modal onClose={() => setAdminOpen(false)}>
          <div style={{ padding: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.navy, marginBottom: 16 }}>Admin Login</div>
            <form onSubmit={handleAdminLogin}>
              <input type="password" value={adminPw} onChange={(e) => setAdminPw(e.target.value)} placeholder="Admin password" style={{ ...S.input, marginBottom: 8 }} autoFocus />
              {adminErr && <div style={S.error}>{adminErr}</div>}
              <button style={S.btnPrimary}>Login</button>
            </form>
          </div>
        </Modal>
      )}

      {/* Confirm cancel modal */}
      {confirmCancel && (
        <Modal onClose={() => setConfirmCancel(null)}>
          <div style={{ padding: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.red, marginBottom: 12 }}>Cancel Reservation</div>
            {reservations[confirmCancel] ? (
              <>
                <p style={{ fontSize: 14, color: C.text, marginBottom: 16 }}>
                  Cancel <strong>{reservations[confirmCancel].companyName}</strong>'s reservation for Booth #{confirmCancel}?<br />
                  Their access code will be freed so they can re-book.
                </p>
                <div style={{ display: "flex", gap: 10 }}>
                  <button style={S.btnDanger} disabled={loading} onClick={() => handleCancelReservation(confirmCancel)}>
                    {loading ? "Cancelling…" : "Yes, Cancel"}
                  </button>
                  <button style={S.btnGhost} onClick={() => setConfirmCancel(null)}>Keep</button>
                </div>
              </>
            ) : (
              <p style={{ color: C.grayD }}>This booth is not reserved.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Floor Plan SVG ─────────────────────────────────────────
function FloorPlan({ reservations, onBoothClick, adminMode, phase }) {
  const PAD = 40;
  const svgW = HALL_W + PAD * 2 + 80; // extra 80px on right for entrance label
  const svgH = HALL_H + PAD * 2;

  return (
    <div style={{ background: C.white, borderRadius: 16, padding: "20px 12px", overflowX: "auto", boxShadow: "0 4px 24px rgba(0,0,0,.25)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.grayD, textAlign: "center", marginBottom: 12, letterSpacing: 1 }}>
        CUE MAIN CAFETERIA — FLOOR PLAN
      </div>
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block", margin: "0 auto", maxWidth: "100%" }}>
        {/* Hall outline */}
        <rect x={PAD} y={PAD} width={HALL_W} height={HALL_H} fill="#f8fafc" stroke={C.navy} strokeWidth={2.5} rx={4} />

        {/* Wall labels */}
        <text x={PAD + HALL_W / 2} y={PAD - 10} textAnchor="middle" fontSize={11} fill={C.grayD}>EAST WALL</text>
        <text x={PAD + HALL_W / 2} y={PAD + HALL_H + 18} textAnchor="middle" fontSize={11} fill={C.grayD}>WEST WALL</text>

        {/* Entrance marker on right (east) wall */}
        <rect x={PAD + HALL_W - 2} y={PAD + HALL_H / 2 - 40} width={18} height={80} fill={C.cyan} rx={3} />
        <text x={PAD + HALL_W + 22} y={PAD + HALL_H / 2} textAnchor="start" fontSize={11} fontWeight={700} fill={C.cyan} dominantBaseline="middle">ENTRANCE</text>

        {/* Center island outline */}
        <rect
          x={PAD + ISL_X0 - 6}
          y={PAD + ISL_T_Y - 6}
          width={8 * BW + 12}
          height={BD * 2 + 10 + 12}
          fill="#f1f5f9"
          stroke="#94a3b8"
          strokeWidth={1.5}
          strokeDasharray="5,3"
          rx={6}
        />
        <text x={PAD + ISL_X0 + 4 * BW} y={PAD + ISL_T_Y + BD + 5 + 2} textAnchor="middle" fontSize={10} fill="#94a3b8" dominantBaseline="middle">BACK TO BACK</text>

        {/* Render all booths */}
        {Object.entries(BOOTHS).map(([id, b]) => {
          const reserved = reservations[id];
          const isTop = b.row === "top" || b.row === "island-top";
          const fill = reserved ? "#fee2e2" : "#dcfce7";
          const stroke = reserved ? C.red : C.green;
          const textColor = reserved ? C.red : C.green;
          const cursor = onBoothClick ? (reserved && !adminMode ? "not-allowed" : "pointer") : "default";
          const bx = PAD + b.x, by = PAD + b.y;

          return (
            <g key={id} onClick={() => onBoothClick && onBoothClick(id)} style={{ cursor }}>
              <rect
                x={bx} y={by} width={b.w} height={b.h}
                fill={fill} stroke={stroke} strokeWidth={1.5} rx={3}
              />
              {/* Booth number */}
              <text x={bx + b.w / 2} y={by + b.h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={700} fill={textColor}>
                {id}
              </text>
              {/* Company name if reserved */}
              {reserved && (
                <text
                  x={bx + b.w / 2}
                  y={isTop ? by - 6 : by + b.h + 10}
                  textAnchor="middle"
                  fontSize={9}
                  fill={C.navy}
                  fontWeight={600}
                >
                  {reserved.companyName.length > 10 ? reserved.companyName.slice(0, 10) + "…" : reserved.companyName}
                </text>
              )}
            </g>
          );
        })}

        {/* Row labels */}
        <text x={PAD + TOP_X0 - 8} y={PAD + TOP_Y + BD / 2} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={C.grayD}>TOP ROW</text>
        <text x={PAD + BOT_X0 - 8} y={PAD + BOT_Y + BD / 2} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={C.grayD}>BOTTOM ROW</text>
        <text x={PAD + ISL_X0 - 8} y={PAD + ISL_T_Y + BD / 2} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={C.grayD}>ISLAND</text>
      </svg>

      {/* Stats */}
      <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 12, fontSize: 13, color: C.grayD }}>
        <span><span style={{ color: C.red, fontWeight: 700 }}>{Object.keys(reservations).length}</span> reserved</span>
        <span><span style={{ color: C.green, fontWeight: 700 }}>{33 - Object.keys(reservations).length}</span> available</span>
      </div>
    </div>
  );
}

// ── Admin Panel ────────────────────────────────────────────
function AdminPanel({ tab, setTab, allCodes, codeSearch, setCodeSearch, genCount, setGenCount, genPrefix, setGenPrefix, newCodes, setNewCodes, loading, onGenerate, onDeleteCode, reservations, onExport, onCancelRes }) {
  const filteredCodes = allCodes.filter((c) =>
    c.id.includes(codeSearch.toUpperCase()) || c.companyName?.toLowerCase().includes(codeSearch.toLowerCase())
  );

  return (
    <div style={{ width: "100%", maxWidth: 800, marginTop: 8 }}>
      {/* Tab nav */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16 }}>
        {["codes", "list"].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 20px", border: "none", borderRadius: "8px 8px 0 0", cursor: "pointer", fontWeight: 600, fontSize: 13, background: tab === t ? C.white : "#1e3a8a55", color: tab === t ? C.navy : "#93c5fd" }}>
            {t === "codes" ? "🔑 Access Codes" : "📋 Reservations"}
          </button>
        ))}
      </div>

      <div style={{ background: C.white, borderRadius: "0 12px 12px 12px", padding: 24, boxShadow: "0 4px 24px rgba(0,0,0,.25)" }}>

        {/* ── Codes tab ── */}
        {tab === "codes" && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={S.label}>Generate Codes</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={genCount} onChange={(e) => setGenCount(e.target.value)} style={{ ...S.input, width: 70 }} placeholder="10" type="number" min="1" max="200" />
                  <input value={genPrefix} onChange={(e) => setGenPrefix(e.target.value)} style={{ ...S.input, width: 100, textTransform: "uppercase" }} placeholder="Prefix (opt.)" maxLength={4} />
                  <button onClick={onGenerate} disabled={loading} style={{ ...S.btnPrimary, width: "auto", marginTop: 0, padding: "10px 20px" }}>
                    {loading ? "…" : "Generate"}
                  </button>
                </div>
              </div>
              <div style={{ marginLeft: "auto" }}>
                <label style={S.label}>Search</label>
                <input value={codeSearch} onChange={(e) => setCodeSearch(e.target.value)} style={{ ...S.input, width: 200 }} placeholder="Code or company…" />
              </div>
            </div>

            {newCodes.length > 0 && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: 14, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, color: C.green, marginBottom: 8 }}>✓ {newCodes.length} codes generated — copy and distribute:</div>
                <div style={{ fontFamily: "monospace", fontSize: 14, lineHeight: 1.8, wordBreak: "break-all" }}>
                  {newCodes.join("  ·  ")}
                </div>
                <button onClick={() => { navigator.clipboard.writeText(newCodes.join("\n")); }} style={{ marginTop: 8, ...S.btnGhost, fontSize: 12 }}>Copy All</button>
                <button onClick={() => setNewCodes([])} style={{ marginTop: 8, marginLeft: 8, ...S.btnGhost, fontSize: 12 }}>Dismiss</button>
              </div>
            )}

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    {["Code", "Status", "Company", "Booth", ""].map((h) => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: C.navy, borderBottom: "2px solid #e2e8f0" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredCodes.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: C.grayD }}>No codes yet. Generate some above.</td></tr>
                  )}
                  {filteredCodes.map((c) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 700, letterSpacing: 1 }}>{c.id}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={S.tag(c.used ? C.red : C.green)}>{c.used ? "Used" : "Available"}</span>
                      </td>
                      <td style={{ padding: "8px 12px" }}>{c.companyName || "—"}</td>
                      <td style={{ padding: "8px 12px" }}>{c.boothId ? `#${c.boothId}` : "—"}</td>
                      <td style={{ padding: "8px 12px" }}>
                        {!c.used && (
                          <button onClick={() => onDeleteCode(c.id)} style={{ ...S.btnDanger, padding: "4px 10px", fontSize: 11 }}>Delete</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: C.grayD }}>
              {allCodes.filter((c) => !c.used).length} available · {allCodes.filter((c) => c.used).length} used · {allCodes.length} total
            </div>
          </>
        )}

        {/* ── Reservations list tab ── */}
        {tab === "list" && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
              <button onClick={onExport} style={{ ...S.btnPrimary, width: "auto", marginTop: 0, padding: "10px 20px", fontSize: 13 }}>
                ⬇ Export CSV
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    {["Booth", "Company", "Contact", "Email", "Phone", "Code", ""].map((h) => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: C.navy, borderBottom: "2px solid #e2e8f0" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(reservations).length === 0 && (
                    <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: C.grayD }}>No reservations yet.</td></tr>
                  )}
                  {Object.entries(reservations)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([boothId, d]) => (
                      <tr key={boothId} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px 12px", fontWeight: 700 }}>#{boothId}</td>
                        <td style={{ padding: "8px 12px" }}>{d.companyName}</td>
                        <td style={{ padding: "8px 12px" }}>{d.contactName}</td>
                        <td style={{ padding: "8px 12px" }}>{d.contactEmail}</td>
                        <td style={{ padding: "8px 12px" }}>{d.contactPhone}</td>
                        <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>{d.code}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <button onClick={() => onCancelRes(boothId)} style={{ ...S.btnDanger, padding: "4px 10px", fontSize: 11 }}>Cancel</button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: C.grayD }}>
              {Object.keys(reservations).length} of 33 booths reserved
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Small reusable components ──────────────────────────────
function Modal({ children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 }} onClick={onClose}>
      <div style={{ background: C.white, borderRadius: 12, minWidth: 320, maxWidth: 480, width: "90%", boxShadow: "0 16px 48px rgba(0,0,0,.4)" }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={S.label}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={S.input} />
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 14 }}>
      <span style={{ color: C.grayD, minWidth: 80 }}>{label}:</span>
      <span style={{ color: C.text, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.white }}>
      <div style={{ width: 16, height: 16, borderRadius: 3, background: color + "33", border: `2px solid ${color}` }} />
      {label}
    </div>
  );
}
