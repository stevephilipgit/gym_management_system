// components/forms/FormFileUpload.jsx — image upload with preview
export default function FormFileUpload({ onFile, preview, error, accept = "image/jpeg,image/png" }) {
  return (
    <div className="register-file-upload" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 16px",
          borderRadius: "8px",
          border: "1px dashed var(--border-color)",
          cursor: "pointer",
          color: "var(--text-primary)",
          fontSize: "14px",
          background: "var(--surface-muted)",
        }}
      >
        <input
          type="file"
          accept={accept}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
          style={{ display: "none" }}
        />
        📷 Upload Photo
      </label>
      {preview && <img src={preview} alt="Member preview" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover" }} />}
      {error && <span role="alert" style={{ fontSize: "12px", color: "#e11d48" }}>{error}</span>}
    </div>
  );
}
