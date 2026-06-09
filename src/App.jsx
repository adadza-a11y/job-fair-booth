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
// Coordinates match cue_cafeteria_floor_plan_v4.svg (viewBox 0 0 680 590)
// Total: 28 booths
const TOTAL_BOOTHS = 28;

const BOOTHS = {
  // South wall: 1–8 (right to left), booth 1 = sponsor corner
  "1":  { x: 556, y: 480, w: 62, h: 42, sponsor: true, wall: true },
  "2":  { x: 486, y: 480, w: 62, h: 42, wall: true },
  "3":  { x: 416, y: 480, w: 62, h: 42, wall: true },
  "4":  { x: 346, y: 480, w: 62, h: 42, wall: true },
  "5":  { x: 276, y: 480, w: 62, h: 42, wall: true },
  "6":  { x: 206, y: 480, w: 62, h: 42, wall: true },
  "7":  { x: 136, y: 480, w: 62, h: 42, wall: true },
  "8":  { x: 74,  y: 480, w: 54, h: 42, wall: true },
  // East wall: 9–16 (right to left), booth 9 = sponsor corner
  "9":  { x: 556, y: 54,  w: 62, h: 42, sponsor: true, wall: true },
  "10": { x: 486, y: 54,  w: 62, h: 42, wall: true },
  "11": { x: 416, y: 54,  w: 62, h: 42, wall: true },
  "12": { x: 346, y: 54,  w: 62, h: 42, wall: true },
  "13": { x: 276, y: 54,  w: 62, h: 42, wall: true },
  "14": { x: 206, y: 54,  w: 62, h: 42, wall: true },
  "15": { x: 136, y: 54,  w: 62, h: 42, wall: true },
  "16": { x: 74,  y: 54,  w: 54, h: 42, wall: true },
  // North wall: 17–19 (vertical, top to bottom)
  "17": { x: 68, y: 168, w: 42, h: 62, wall: true },
  "18": { x: 68, y: 242, w: 42, h: 62, wall: true },
  "19": { x: 68, y: 316, w: 42, h: 62, wall: true },
  // Island top face: 20–23
  "20": { x: 164, y: 214, w: 56, h: 52 },
  "21": { x: 228, y: 214, w: 56, h: 52 },
  "22": { x: 292, y: 214, w: 56, h: 52 },
  "23": { x: 356, y: 214, w: 56, h: 52 },
  // Island bottom face: 24–27
  "24": { x: 164, y: 302, w: 56, h: 52 },
  "25": { x: 228, y: 302, w: 56, h: 52 },
  "26": { x: 292, y: 302, w: 56, h: 52 },
  "27": { x: 356, y: 302, w: 56, h: 52 },
  // Sponsor island booth: 28 (large, faces entrance)
  "28": { x: 424, y: 214, w: 80, h: 140, sponsor: true },
};

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
              <div style={{ fontSize: 24, fontWeight: 800, color: C.green }}>{TOTAL_BOOTHS - Object.keys(reservations).length}</div>
              <div style={{ fontSize: 12, color: C.grayD }}>Available</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.navy }}>{TOTAL_BOOTHS}</div>
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
              <div style={{ fontSize: 12, color: C.grayD }}>
                {BOOTHS[selectedBooth]?.wall ? "3m × 2m" : selectedBooth === "28" ? "Large Sponsor Booth" : "2m × 2m"} — CUE Main Cafeteria
              </div>
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

      {/* ── Persistent New Entry button ── */}
      <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 998 }}>
        <button
          onClick={() => { setPhase("code"); setCodeInput(""); setValidCode(null); setSelectedBooth(null); setForm({ companyName: "", contactName: "", contactEmail: "", contactPhone: "" }); setErr(""); setSuccessMsg(""); }}
          style={{ background: C.cyan, color: C.white, border: "none", borderRadius: 50, padding: "14px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,.4)", letterSpacing: .5 }}
        >
          + New Entry
        </button>
      </div>

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
function FloorPlan({ reservations, onBoothClick, adminMode, phase, highlightBooth }) {
  // Uses exact coordinates from cue_cafeteria_floor_plan_v4.svg (viewBox 0 0 680 590)

  return (
    <div style={{ background: C.white, borderRadius: 16, padding: "20px 12px", overflowX: "auto", boxShadow: "0 4px 24px rgba(0,0,0,.25)" }}>
      <svg width="100%" viewBox="0 0 680 590" style={{ display: "block", margin: "0 auto", maxWidth: 720 }}>
        {/* Room boundary */}
        <rect x="68" y="48" width="556" height="488" rx="6" fill="#f8fafc" stroke={C.navy} strokeWidth="1.5" />
        {/* Wall labels — placed outside the room boundary */}
        <text x="346" y="42" textAnchor="middle" fontSize="9" fill={C.grayD} letterSpacing="1">EAST WALL</text>
        <text x="346" y="548" textAnchor="middle" fontSize="9" fill={C.grayD} letterSpacing="1">SOUTH WALL</text>
        <text x="40" y="295" textAnchor="middle" fontSize="8" fill={C.grayD} transform="rotate(-90,40,295)" letterSpacing="1">NORTH WALL</text>
        {/* Entrance */}
        <rect x="624" y="256" width="20" height="56" rx="3" fill={C.cyan} />
        <text fontSize="8" x="634" y="278" textAnchor="middle" fill={C.white} fontWeight="700">EN</text>
        <text fontSize="8" x="634" y="290" textAnchor="middle" fill={C.white} fontWeight="700">TR</text>
        {/* 2m aisle */}
        <rect x="110" y="192" width="48" height="184" rx="3" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="0.5" strokeDasharray="3 3" />
        <text fontSize="8" x="134" y="279" textAnchor="middle" fill="#94a3b8" transform="rotate(-90,134,284)">2m aisle</text>
        {/* Island outline */}
        <rect x="158" y="192" width="450" height="184" rx="6" fill="none" stroke="#94a3b8" strokeWidth="0.8" strokeDasharray="5 4" />
        <text fontSize="9" x="310" y="207" textAnchor="middle" fill="#94a3b8">ISLAND — back to back</text>

        {/* All booths */}
        {Object.entries(BOOTHS).map(([id, b]) => {
          const reserved = reservations[id];
          const isHighlighted = highlightBooth === id;
          let fill, stroke, textColor, strokeWidth;
          if (isHighlighted)      { fill="#dbeafe"; stroke=C.cyan;     textColor=C.navy;     strokeWidth="2.5"; }
          else if (reserved)      { fill="#fee2e2"; stroke=C.red;      textColor=C.red;      strokeWidth="1";   }
          else if (b.sponsor && b.wall) { fill="#e0f7fa"; stroke=C.cyan; textColor="#0e7490"; strokeWidth="1.5"; }
          else if (b.wall)        { fill="#cffafe"; stroke=C.cyan;     textColor="#0e7490";  strokeWidth="1.2"; }
          else if (b.sponsor)     { fill="#FAECE7"; stroke="#993C1D";  textColor="#993C1D";  strokeWidth="1";   }
          else                    { fill="#EAF3DE"; stroke="#3B6D11";  textColor="#27500A";  strokeWidth="0.7"; }
          const cursor = onBoothClick ? (reserved && !adminMode ? "not-allowed" : "pointer") : "default";
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          const sizeLabel = id === "28" ? null : b.wall ? "3×2m" : "2×2m";
          const hasSubtext = reserved || (!reserved && b.sponsor);
          // Corner booths 1 & 9 rendered as diamonds (rotated squares)
          const cornerShape = (id === "9" || id === "1")
            ? `${cx},${b.y} ${b.x+b.w},${cy} ${cx},${b.y+b.h} ${b.x},${cy}`
            : null;
          return (
            <g key={id} onClick={() => onBoothClick && onBoothClick(id)} style={{ cursor }}>
              {cornerShape
                ? <polygon points={cornerShape} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
                : <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="4" fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
              }
              <text fontSize="11" fontWeight="600" x={cx} y={cy - 8} textAnchor="middle" dominantBaseline="middle" fill={textColor}>{id}</text>
              {sizeLabel && <text fontSize="7" x={cx} y={cy + 4} textAnchor="middle" fill={textColor} opacity="0.75">{sizeLabel}</text>}
              {reserved && <text fontSize="7" x={cx} y={cy + 14} textAnchor="middle" fill={textColor}>{reserved.companyName.length > 9 ? reserved.companyName.slice(0,9)+"…" : reserved.companyName}</text>}
              {!reserved && b.sponsor && <text fontSize="7" x={cx} y={cy + 14} textAnchor="middle" fill="#993C1D">Sponsor</text>}
            </g>
          );
        })}

        {/* Booth size callout */}
        <rect x="430" y="548" width="192" height="28" rx="5" fill="#e0f7fa" stroke={C.cyan} strokeWidth="1" />
        <text fontSize="9" fontWeight="700" x="526" y="559" textAnchor="middle" fill="#0e7490">📐 Wall: 3×2m · Island: 2×2m</text>
        <text fontSize="8" x="526" y="570" textAnchor="middle" fill="#0e7490">(width × depth)</text>

        {/* Legend */}
        <rect x="74" y="552" width="11" height="11" rx="2" fill="#cffafe" stroke={C.cyan} strokeWidth="1.2" />
        <text fontSize="9" x="91" y="562" fill={C.grayD}>Wall booth</text>
        <rect x="168" y="552" width="11" height="11" rx="2" fill="#EAF3DE" stroke="#3B6D11" strokeWidth="0.5" />
        <text fontSize="9" x="185" y="562" fill={C.grayD}>Island booth</text>
        <rect x="262" y="552" width="11" height="11" rx="2" fill="#fee2e2" stroke={C.red} strokeWidth="0.7" />
        <text fontSize="9" x="279" y="562" fill={C.grayD}>Reserved</text>
        <rect x="340" y="552" width="11" height="11" rx="2" fill="#FAECE7" stroke="#993C1D" strokeWidth="1" />
        <text fontSize="9" x="357" y="562" fill={C.grayD}>Sponsor</text>
      </svg>

      {/* Stats */}
      <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 12, fontSize: 13, color: C.grayD }}>
        <span><span style={{ color: C.red, fontWeight: 700 }}>{Object.keys(reservations).length}</span> reserved</span>
        <span><span style={{ color: C.green, fontWeight: 700 }}>{TOTAL_BOOTHS - Object.keys(reservations).length}</span> available</span>
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
