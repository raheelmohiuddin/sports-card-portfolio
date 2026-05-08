import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { lookupPsaCert, addCard, uploadCardImages } from "../services/api.js";
import DropZone from "../components/DropZone.jsx";
import { gradients } from "../utils/theme.js";

function useImageFile(psaUrl) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const displayUrl = previewUrl ?? psaUrl ?? null;
  return { file, setFile, previewUrl, displayUrl };
}

function isRare(card) {
  return card?.psaPopulationHigher === 0 && card?.psaPopulation != null && card.psaPopulation <= 25;
}

export default function AddCardPage() {
  const navigate = useNavigate();
  const [certNumber, setCertNumber]     = useState("");
  const [certFocused, setCertFocused]   = useState(false);
  const [cardData, setCardData]         = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [saveLoading, setSaveLoading]   = useState(false);
  const [error, setError]               = useState(null);
  const [duplicateId, setDuplicateId]   = useState(null);
  const [myCost, setMyCost]             = useState("");
  const [costFocused, setCostFocused]   = useState(false);

  const front = useImageFile(cardData?.frontImageUrl ?? null);
  const back  = useImageFile(cardData?.backImageUrl  ?? null);

  async function handleLookup(e) {
    e.preventDefault();
    setError(null);
    setDuplicateId(null);
    setCardData(null);
    front.setFile(null);
    back.setFile(null);
    setLookupLoading(true);
    setMyCost("");
    try {
      setCardData(await lookupPsaCert(certNumber.trim()));
    } catch (err) {
      setError(err.message);
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleSave() {
    if (!cardData) return;
    setError(null);
    setDuplicateId(null);
    setSaveLoading(true);
    try {
      const trimmedCost = myCost.trim();
      const costNum = trimmedCost === "" ? null : parseFloat(trimmedCost);
      if (costNum !== null && (isNaN(costNum) || costNum < 0)) {
        setError("My Cost must be a positive number.");
        setSaveLoading(false);
        return;
      }
      const { frontUploadUrl, backUploadUrl } = await addCard({
        ...cardData,
        myCost: costNum,
      });
      await uploadCardImages({
        frontUploadUrl, frontFile: front.file,
        backUploadUrl,  backFile:  back.file,
      });
      navigate("/portfolio?tab=cards");
    } catch (err) {
      if (err.status === 409) {
        setDuplicateId(err.data?.existingCardId ?? "");
      } else {
        setError(err.message);
      }
    } finally {
      setSaveLoading(false);
    }
  }

  const hasPsaFront = !!cardData?.frontImageUrl;
  const hasPsaBack  = !!cardData?.backImageUrl;
  const canSave     = hasPsaFront || hasPsaBack || front.file || back.file;
  const rare        = isRare(cardData);

  return (
    <div style={st.page}>
      <div className="container" style={st.inner}>
        {/* ── Header ── */}
        <header style={st.header}>
          <p style={st.eyebrow}>
            <span style={st.eyebrowMark}>◆</span> Add a Card
          </p>
          <h1 style={st.title}>Add to Your Collection</h1>
          <p style={st.subtitle}>
            Look up any PSA-graded card by its certificate number to populate
            details, then upload your own photos for the 3D card viewer.
          </p>
        </header>

        {/* ── Lookup ── */}
        <section style={st.lookupSection}>
          <label style={st.fieldLabel}>PSA Certificate Number</label>
          <form onSubmit={handleLookup} style={st.lookupRow}>
            <input
              style={{ ...st.certInput, ...(certFocused ? st.certInputFocused : {}) }}
              type="text"
              placeholder="e.g. 12345678"
              value={certNumber}
              onChange={(e) => setCertNumber(e.target.value)}
              onFocus={() => setCertFocused(true)}
              onBlur={() => setCertFocused(false)}
              required
            />
            <button
              type="submit"
              style={{ ...st.lookupBtn, ...(lookupLoading ? st.btnDisabled : {}) }}
              disabled={lookupLoading || !certNumber.trim()}
            >
              {lookupLoading ? "Looking up…" : "Lookup →"}
            </button>
          </form>

          {error && (
            <div style={st.error}>
              <span style={st.errorMark}>!</span>
              <span>{error}</span>
            </div>
          )}

          {duplicateId !== null && (
            <div style={st.dupAlert}>
              <div>
                <p style={st.dupTitle}>This card is already in your portfolio</p>
                <p style={st.dupSub}>
                  You've added this PSA cert before. Open it to update cost,
                  target price, or remove it.
                </p>
              </div>
              <Link
                to={duplicateId
                  ? `/portfolio?tab=cards&highlight=${duplicateId}`
                  : "/portfolio?tab=cards"}
                style={st.dupCta}
              >
                View card →
              </Link>
            </div>
          )}
        </section>

        {/* ── PSA Result ── */}
        {cardData && (
          <>
            <section style={{ ...st.detailPanel, ...(rare ? st.detailPanelRare : {}) }}>
              <div style={st.detailHeader}>
                <div style={st.detailHeaderLeft}>
                  <h2 style={st.playerName}>{cardData.playerName ?? "Unknown Player"}</h2>
                  <p style={st.detailMeta}>
                    {[cardData.year, cardData.brand, cardData.sport].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div style={st.gradeBadge}>
                  <span style={st.gradeBadgeLabel}>PSA</span>
                  <span style={st.gradeBadgeValue}>{cardData.grade}</span>
                </div>
              </div>

              {cardData.gradeDescription && (
                <div style={st.gradeDesc}>{cardData.gradeDescription}</div>
              )}

              <div style={st.detailDivider} />

              <div style={st.detailGrid}>
                <DetailRow label="Cert #"   value={cardData.certNumber} />
                <DetailRow label="Card #"   value={cardData.cardNumber} />
                <DetailRow label="Variety"  value={cardData.variety} />
                <DetailRow label="Sport"    value={cardData.sport} />
              </div>

              {(cardData.psaPopulation != null || cardData.psaPopulationHigher != null) && (
                <>
                  <div style={st.detailDivider} />
                  <div style={st.popSection}>
                    <span style={st.popLabel}>Population</span>
                    <div style={st.popValues}>
                      {cardData.psaPopulation != null && (
                        <div style={st.popValue}>
                          <span style={st.popValueNum}>{cardData.psaPopulation.toLocaleString()}</span>
                          <span style={st.popValueLbl}>at this grade</span>
                        </div>
                      )}
                      {cardData.psaPopulationHigher != null && (
                        <div style={st.popValue}>
                          <span style={{
                            ...st.popValueNum,
                            ...(cardData.psaPopulationHigher === 0 ? st.popValueZero : {}),
                          }}>
                            {cardData.psaPopulationHigher === 0 ? "HIGHEST GRADED" : cardData.psaPopulationHigher.toLocaleString()}
                          </span>
                          <span style={st.popValueLbl}>graded higher</span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {rare && (
                <div style={st.rareCallout}>
                  <span style={st.rareCalloutMark}>✦</span>
                  <span>Low-population card — only {cardData.psaPopulation} graded, none higher.</span>
                </div>
              )}
            </section>

            {/* ── Upload zones ── */}
            <section style={st.uploadSection}>
              <h3 style={st.sectionTitle}>Card Photos</h3>
              <p style={st.sectionSub}>
                {hasPsaFront || hasPsaBack
                  ? "PSA images shown by default — drop your own photos to override."
                  : "No PSA images available — upload at least one photo to add this card."}
              </p>

              <div style={st.zonesRow}>
                <ImageZone
                  side="Front"
                  psaUrl={cardData.frontImageUrl}
                  file={front.file}
                  setFile={front.setFile}
                  displayUrl={front.displayUrl}
                />
                <ImageZone
                  side="Back"
                  psaUrl={cardData.backImageUrl}
                  file={back.file}
                  setFile={back.setFile}
                  displayUrl={back.displayUrl}
                />
              </div>
            </section>

            {/* ── My Cost ── */}
            <section style={st.costSection}>
              <h3 style={st.sectionTitle}>Your Cost</h3>
              <p style={st.sectionSub}>
                Optional — what you paid for this card. Used to calculate
                profit / loss against current market value.
              </p>
              <div style={{ ...st.costInputWrap, ...(costFocused ? st.costInputWrapFocused : {}) }}>
                <span style={st.costDollar}>$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={myCost}
                  onChange={(e) => setMyCost(e.target.value)}
                  onFocus={() => setCostFocused(true)}
                  onBlur={() => setCostFocused(false)}
                  style={st.costInput}
                />
              </div>
            </section>

            {/* ── Save ── */}
            <button
              onClick={handleSave}
              disabled={saveLoading || !canSave}
              style={{
                ...st.saveBtn,
                ...(saveLoading || !canSave ? st.saveBtnDisabled : {}),
              }}
            >
              {saveLoading ? "Saving…" : (
                <>
                  <span style={st.saveBtnMark}>◆</span>
                  Add to Portfolio
                  <span style={st.saveBtnArrow}>→</span>
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={st.detailRow}>
      <span style={st.detailRowLabel}>{label}</span>
      <span style={st.detailRowValue}>{value}</span>
    </div>
  );
}

function ImageZone({ side, psaUrl, file, setFile, displayUrl }) {
  const hasPsa  = !!psaUrl;
  const hasFile = !!file;

  return (
    <div style={st.zone}>
      <div style={st.zoneHeader}>
        <span style={st.zoneLabel}>{side}</span>
        {hasFile && <span style={st.zoneTagUser}>Your Photo</span>}
        {!hasFile && hasPsa && <span style={st.zoneTagPsa}>PSA</span>}
      </div>

      <DropZone
        onFile={setFile}
        previewUrl={displayUrl}
        label={`Drop ${side.toLowerCase()} image`}
        hint={hasPsa ? "or click to override PSA image" : "or click to browse"}
      />

      {hasFile && (
        <button
          type="button"
          onClick={() => setFile(null)}
          style={st.zoneClear}
        >
          ✕ Remove{hasPsa ? " — revert to PSA" : ""}
        </button>
      )}
    </div>
  );
}

const st = {
  // ─── Page (full-bleed dark gradient — matches PortfolioPage) ───
  page: {
    overflowX: "hidden",
    background: gradients.pageDark,
    minHeight: "calc(100vh - 60px)",
    // -1rem instead of calc(50% - 50vw) — see PortfolioPage st.page for
    // the full reasoning (100vw + scrollbar = right-edge overflow on mobile).
    marginLeft: "-1rem",
    marginRight: "-1rem",
    maxWidth: "calc(100% + 2rem)",
    boxSizing: "border-box",
    marginTop: "-2rem",
    marginBottom: "-2rem",
    padding: "3.5rem 0 5rem",
    color: "#e2e8f0",
  },
  inner: { maxWidth: 760 },

  // ─── Header ───
  header: { marginBottom: "2.5rem" },
  eyebrow: {
    color: "#f59e0b",
    fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    marginBottom: "1rem",
  },
  eyebrowMark: { marginRight: "0.4rem" },
  title: {
    fontSize: "clamp(1.8rem, 4vw, 2.6rem)",
    fontWeight: 800, color: "#f1f5f9",
    letterSpacing: "-0.03em", lineHeight: 1.1,
    margin: "0 0 0.85rem",
  },
  subtitle: {
    color: "#64748b", fontSize: "0.95rem",
    lineHeight: 1.65, maxWidth: 520, margin: 0,
  },

  // ─── Lookup ───
  lookupSection: { marginBottom: "2.5rem" },
  fieldLabel: {
    display: "block",
    fontSize: "0.7rem", fontWeight: 600,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: "#64748b", marginBottom: "0.7rem",
  },
  lookupRow: { display: "flex", gap: "0.75rem", flexWrap: "wrap" },
  certInput: {
    flex: 1, minWidth: 200,
    background: "rgba(15,23,42,0.7)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#f1f5f9",
    fontSize: "1rem", fontWeight: 500,
    padding: "0.85rem 1.25rem",
    borderRadius: 999,
    outline: "none",
    transition: "border-color 0.2s, background 0.2s, box-shadow 0.2s",
    fontVariantNumeric: "tabular-nums",
  },
  certInputFocused: {
    borderColor: "rgba(245,158,11,0.65)",
    background: "rgba(15,23,42,0.95)",
    boxShadow: "0 0 0 3px rgba(245,158,11,0.12)",
  },
  lookupBtn: {
    background: "#f59e0b", color: "#0f172a",
    border: "none", borderRadius: 999,
    padding: "0.85rem 1.75rem",
    fontSize: "0.92rem", fontWeight: 800,
    cursor: "pointer",
    letterSpacing: "0.01em",
    transition: "background 0.2s, transform 0.1s",
  },
  btnDisabled: { opacity: 0.5, cursor: "not-allowed" },

  error: {
    display: "flex", alignItems: "center", gap: "0.6rem",
    background: "rgba(248,113,113,0.08)",
    border: "1px solid rgba(248,113,113,0.25)",
    color: "#fca5a5",
    fontSize: "0.85rem",
    padding: "0.75rem 1rem", borderRadius: 8,
    marginTop: "1rem",
  },
  errorMark: {
    width: 20, height: 20,
    background: "#dc2626", color: "#fff",
    borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "0.72rem", fontWeight: 800,
    flexShrink: 0,
  },

  dupAlert: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: "1.25rem", flexWrap: "wrap",
    background: "linear-gradient(135deg, rgba(245,158,11,0.1), rgba(217,119,6,0.04))",
    border: "1px solid rgba(245,158,11,0.4)",
    borderRadius: 12,
    padding: "1rem 1.25rem",
    marginTop: "1rem",
  },
  dupTitle: {
    color: "#fbbf24", fontSize: "0.95rem", fontWeight: 700,
    margin: 0, letterSpacing: "-0.01em",
  },
  dupSub: {
    color: "#94a3b8", fontSize: "0.78rem",
    margin: "0.3rem 0 0", lineHeight: 1.5,
  },
  dupCta: {
    background: "#f59e0b", color: "#0f172a",
    fontWeight: 800, fontSize: "0.85rem",
    padding: "0.6rem 1.2rem", borderRadius: 999,
    textDecoration: "none", letterSpacing: "0.01em",
    flexShrink: 0,
  },

  // ─── Detail panel ───
  detailPanel: {
    background: gradients.goldPanel,
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 16,
    padding: "1.75rem 2rem",
    marginBottom: "2rem",
  },
  detailPanelRare: {
    borderColor: "rgba(245,158,11,0.3)",
    boxShadow: "0 0 0 1px rgba(245,158,11,0.1), 0 0 32px rgba(245,158,11,0.06)",
  },
  detailHeader: {
    display: "flex", alignItems: "flex-start",
    justifyContent: "space-between", gap: "1rem",
    marginBottom: "0.5rem",
  },
  detailHeaderLeft: { flex: 1, minWidth: 0 },
  playerName: {
    fontSize: "1.5rem", fontWeight: 800, color: "#f1f5f9",
    letterSpacing: "-0.02em", margin: 0, lineHeight: 1.2,
  },
  detailMeta: {
    fontSize: "0.85rem", color: "#94a3b8",
    marginTop: "0.4rem", letterSpacing: "0.02em",
  },
  gradeBadge: {
    display: "flex", alignItems: "center", gap: "0.4rem",
    background: "rgba(15,23,42,0.85)",
    border: "1px solid rgba(245,158,11,0.45)",
    borderRadius: 6,
    padding: "0.5rem 0.85rem",
    flexShrink: 0,
  },
  gradeBadgeLabel: {
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.14em", color: "#94a3b8",
  },
  gradeBadgeValue: {
    fontSize: "1.15rem", fontWeight: 800,
    color: "#f59e0b", lineHeight: 1,
  },
  gradeDesc: {
    fontSize: "0.78rem", color: "#cbd5e1",
    fontStyle: "italic", marginTop: "0.4rem",
  },
  detailDivider: {
    height: 1,
    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
    margin: "1.25rem 0",
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "0.75rem 1.5rem",
  },
  detailRow: { display: "flex", flexDirection: "column", gap: "0.2rem" },
  detailRowLabel: {
    fontSize: "0.62rem", fontWeight: 600,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: "#64748b",
  },
  detailRowValue: { fontSize: "0.92rem", color: "#e2e8f0", fontWeight: 500 },

  popSection: {
    display: "flex", alignItems: "center",
    gap: "1.5rem", flexWrap: "wrap",
  },
  popLabel: {
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: "#64748b",
  },
  popValues: { display: "flex", gap: "2rem", flexWrap: "wrap" },
  popValue: { display: "flex", flexDirection: "column", gap: "0.15rem" },
  popValueNum: {
    fontSize: "1.25rem", fontWeight: 800,
    color: "#f1f5f9", lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },
  popValueZero: { color: "#10b981" },
  popValueLbl: { fontSize: "0.7rem", color: "#64748b" },

  rareCallout: {
    display: "flex", alignItems: "center", gap: "0.6rem",
    background: "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(217,119,6,0.06))",
    border: "1px solid rgba(245,158,11,0.3)",
    borderRadius: 8,
    padding: "0.7rem 1rem",
    marginTop: "1.25rem",
    color: "#fbbf24",
    fontSize: "0.82rem", fontWeight: 600,
  },
  rareCalloutMark: { fontSize: "1rem" },

  // ─── Upload section ───
  uploadSection: { marginBottom: "2.5rem" },
  sectionTitle: {
    fontSize: "1.1rem", fontWeight: 700,
    color: "#f1f5f9", margin: "0 0 0.4rem",
    letterSpacing: "-0.01em",
  },
  sectionSub: {
    fontSize: "0.82rem", color: "#64748b",
    margin: "0 0 1.25rem",
  },
  zonesRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "1.25rem",
  },
  zone: {},
  zoneHeader: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between", gap: "0.5rem",
    marginBottom: "0.6rem",
  },
  zoneLabel: {
    fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: "#94a3b8",
  },
  zoneTagPsa: {
    fontSize: "0.6rem", fontWeight: 700,
    letterSpacing: "0.1em", textTransform: "uppercase",
    color: "#94a3b8",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    padding: "0.18rem 0.45rem", borderRadius: 3,
  },
  zoneTagUser: {
    fontSize: "0.6rem", fontWeight: 700,
    letterSpacing: "0.1em", textTransform: "uppercase",
    color: "#10b981",
    background: "rgba(16,185,129,0.08)",
    border: "1px solid rgba(16,185,129,0.25)",
    padding: "0.18rem 0.45rem", borderRadius: 3,
  },
  zoneClear: {
    background: "none", border: "none",
    color: "#64748b", fontSize: "0.72rem",
    cursor: "pointer", padding: "0.5rem 0", marginTop: "0.4rem",
    letterSpacing: "0.02em",
  },

  // ─── My Cost ───
  costSection: { marginBottom: "2.5rem" },
  costInputWrap: {
    position: "relative",
    display: "flex", alignItems: "center",
    background: "rgba(15,23,42,0.7)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 999,
    padding: "0 1.25rem",
    transition: "border-color 0.2s, background 0.2s, box-shadow 0.2s",
    maxWidth: 320,
  },
  costDollar: {
    color: "#f59e0b", fontSize: "1.05rem", fontWeight: 700,
    marginRight: "0.5rem",
  },
  costInput: {
    flex: 1,
    background: "transparent",
    border: "none", outline: "none",
    color: "#f1f5f9",
    fontSize: "1rem", fontWeight: 600,
    padding: "0.85rem 0",
    fontVariantNumeric: "tabular-nums",
    MozAppearance: "textfield",
  },
  costInputWrapFocused: {
    borderColor: "rgba(245,158,11,0.65)",
    background: "rgba(15,23,42,0.95)",
    boxShadow: "0 0 0 3px rgba(245,158,11,0.12)",
  },

  // ─── Save button ───
  saveBtn: {
    display: "flex", alignItems: "center", justifyContent: "center",
    gap: "0.6rem",
    width: "100%",
    background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
    color: "#0f172a", border: "none",
    borderRadius: 12,
    padding: "1.1rem 2rem",
    fontSize: "1.05rem", fontWeight: 800,
    cursor: "pointer",
    letterSpacing: "0.01em",
    boxShadow: "0 6px 24px rgba(245,158,11,0.25), 0 0 0 1px rgba(245,158,11,0.4)",
    transition: "transform 0.1s, box-shadow 0.2s",
  },
  saveBtnDisabled: {
    background: "rgba(245,158,11,0.25)",
    color: "rgba(15,23,42,0.6)",
    cursor: "not-allowed",
    boxShadow: "none",
  },
  saveBtnMark: { fontSize: "0.85rem" },
  saveBtnArrow: { fontSize: "1.1rem" },
};
