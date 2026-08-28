// components/forms/FormFileUpload.jsx — image upload with preview
export default function FormFileUpload({ onFile, preview, error, accept = "image/jpeg,image/png" }) {
  return (
    <div className="register-upload">
      <div className="register-upload-box" aria-hidden="true">
        {preview ? (
          <img src={preview} alt="Member preview" />
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-3.3 3.6-5.5 8-5.5s8 2.2 8 5.5" />
          </svg>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <label className="register-upload-btn" title="Upload Photo">
          <input
            type="file"
            accept={accept}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </label>
        {preview && <span className="register-field-hint">Replace by uploading a new photo.</span>}
        {error && <span className="register-field-error" role="alert">{error}</span>}
      </div>
    </div>
  );
}
