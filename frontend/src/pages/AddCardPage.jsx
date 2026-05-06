import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { lookupPsaCert, addCard, uploadCardImages } from "../services/api.js";
import DropZone from "../components/DropZone.jsx";

function useImageFile(psaUrl) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Display: user file preview > PSA CDN url > null
  const displayUrl = previewUrl ?? psaUrl ?? null;

  return { file, setFile, previewUrl, displayUrl };
}

export default function AddCardPage() {
  const navigate = useNavigate();
  const [certNumber, setCertNumber] = useState("");
  const [cardData, setCardData] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [error, setError] = useState(null);

  const front = useImageFile(cardData?.frontImageUrl ?? null);
  const back  = useImageFile(cardData?.backImageUrl  ?? null);

  async function handleLookup(e) {
    e.preventDefault();
    setError(null);
    setCardData(null);
    front.setFile(null);
    back.setFile(null);
    setLookupLoading(true);
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
    setSaveLoading(true);
    try {
      const { frontUploadUrl, backUploadUrl } = await addCard(cardData);
      await uploadCardImages({
        frontUploadUrl, frontFile: front.file,
        backUploadUrl,  backFile:  back.file,
      });
      navigate("/portfolio");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaveLoading(false);
    }
  }

  const hasPsaFront = !!cardData?.frontImageUrl;
  const hasPsaBack  = !!cardData?.backImageUrl;
  const canSave = hasPsaFront || hasPsaBack || front.file || back.file;

  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={styles.title}>Add a Card by PSA Cert Number</h1>

      <form onSubmit={handleLookup} style={styles.form}>
        <label style={styles.label}>PSA Certificate Number</label>
        <div style={styles.row}>
          <input
            style={styles.input}
            type="text"
            placeholder="e.g. 12345678"
            value={certNumber}
            onChange={(e) => setCertNumber(e.target.value)}
            required
          />
          <button type="submit" style={styles.lookupBtn} disabled={lookupLoading}>
            {lookupLoading ? "Looking up…" : "Lookup"}
          </button>
        </div>
      </form>

      {error && <p style={styles.error}>{error}</p>}

      {cardData && (
        <div style={styles.result}>
          {/* Card header */}
          <div style={styles.cardHeader}>
            <div>
              <h2 style={styles.playerName}>{cardData.playerName}</h2>
              <p style={styles.subtitle}>
                {[cardData.year, cardData.brand, cardData.sport].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div style={styles.gradeBadge}>PSA {cardData.grade}</div>
          </div>

          <table style={styles.table}>
            <tbody>
              {[
                ["Cert #", cardData.certNumber],
                ["Card #", cardData.cardNumber],
                ["Grade",  cardData.gradeDescription],
                ["Variety",cardData.variety],
              ].map(([lbl, val]) =>
                val ? (
                  <tr key={lbl}>
                    <td style={styles.tdLabel}>{lbl}</td>
                    <td style={styles.tdVal}>{val}</td>
                  </tr>
                ) : null
              )}
            </tbody>
          </table>

          <div style={styles.divider} />

          {/* Dual drop zones */}
          <div style={styles.zonesRow}>
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

          {!hasPsaFront && !hasPsaBack && !front.file && !back.file && (
            <p style={styles.requiredHint}>
              No PSA images found — upload at least one photo to continue.
            </p>
          )}

          <button
            onClick={handleSave}
            style={{ ...styles.saveBtn, ...(!canSave ? styles.saveBtnDisabled : {}) }}
            disabled={saveLoading || !canSave}
          >
            {saveLoading ? "Saving…" : "Add to Portfolio"}
          </button>
        </div>
      )}
    </div>
  );
}

function ImageZone({ side, psaUrl, file, setFile, displayUrl }) {
  const hasPsa = !!psaUrl;
  const hasFile = !!file;

  return (
    <div style={styles.zone}>
      <p style={styles.zoneLabel}>
        {side}
        {hasPsa && !hasFile && <span style={styles.psaTag}> PSA</span>}
        {hasFile && <span style={styles.userTag}> Your photo</span>}
      </p>

      <DropZone
        onFile={setFile}
        previewUrl={displayUrl}
        label={`Drop ${side.toLowerCase()} image`}
        hint={hasPsa ? "Drop to override PSA image" : "or click to browse"}
      />

      {hasFile && (
        <button style={styles.clearBtn} onClick={() => setFile(null)} type="button">
          ✕ Remove{hasPsa ? " (revert to PSA)" : ""}
        </button>
      )}
    </div>
  );
}

const styles = {
  title: { fontSize: "1.4rem", fontWeight: 700, marginBottom: "1.5rem" },
  form: { marginBottom: "1rem" },
  label: { display: "block", fontWeight: 500, marginBottom: "0.4rem", fontSize: "0.9rem" },
  row: { display: "flex", gap: "0.5rem" },
  input: {
    flex: 1, padding: "0.6rem 0.75rem",
    border: "1px solid #d1d5db", borderRadius: 6, fontSize: "1rem",
  },
  lookupBtn: {
    background: "#4f46e5", color: "#fff", border: "none",
    borderRadius: 6, padding: "0.6rem 1.25rem", cursor: "pointer", fontWeight: 600,
  },
  error: { color: "#dc2626", margin: "0.75rem 0" },
  result: {
    background: "#fff", border: "1px solid #e5e7eb",
    borderRadius: 12, padding: "1.5rem", marginTop: "1rem",
  },
  cardHeader: {
    display: "flex", justifyContent: "space-between",
    alignItems: "flex-start", marginBottom: "0.75rem",
  },
  playerName: { fontSize: "1.2rem", fontWeight: 700, margin: 0 },
  subtitle: { fontSize: "0.82rem", color: "#6b7280", marginTop: "0.2rem" },
  gradeBadge: {
    background: "#fef3c7", color: "#92400e", fontWeight: 700,
    fontSize: "0.85rem", padding: "0.3rem 0.7rem", borderRadius: 20, whiteSpace: "nowrap",
  },
  table: { width: "100%", borderCollapse: "collapse", marginBottom: "0.5rem" },
  tdLabel: { fontWeight: 500, color: "#9ca3af", padding: "0.2rem 0.5rem 0.2rem 0", fontSize: "0.8rem", width: 80 },
  tdVal: { padding: "0.2rem 0", fontSize: "0.88rem", color: "#111827" },
  divider: { borderTop: "1px solid #f3f4f6", margin: "1rem 0" },
  zonesRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" },
  zone: {},
  zoneLabel: { fontWeight: 600, fontSize: "0.85rem", color: "#374151", marginBottom: "0.4rem" },
  psaTag: { fontWeight: 400, color: "#4f46e5", fontSize: "0.75rem" },
  userTag: { fontWeight: 400, color: "#047857", fontSize: "0.75rem" },
  clearBtn: {
    marginTop: "0.4rem", background: "none", border: "none",
    color: "#9ca3af", fontSize: "0.75rem", cursor: "pointer", padding: 0,
  },
  requiredHint: {
    textAlign: "center", fontSize: "0.78rem",
    color: "#b45309", marginBottom: "1rem",
  },
  saveBtn: {
    background: "#047857", color: "#fff", border: "none", borderRadius: 6,
    padding: "0.7rem 1.5rem", cursor: "pointer", fontWeight: 600,
    fontSize: "1rem", width: "100%",
  },
  saveBtnDisabled: { background: "#d1d5db", cursor: "not-allowed" },
};
