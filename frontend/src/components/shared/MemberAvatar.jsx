import { useState } from "react";

/**
 * Member avatar with a safe fallback.
 *
 * Renders the member photo (legacy /uploads path, media delivery URL, or a
 * local blob preview) and degrades to initials whenever the URL is missing,
 * blocked, or fails to load — never a broken-image icon.
 */
export default function MemberAvatar({
  photoUrl,
  name = "",
  size = 48,
  className = "",
  style = {},
}) {
  // Only remember a failure for the URL that actually failed, so a NEW photo
  // URL gets a fresh attempt without needing a reset effect.
  const [failedUrl, setFailedUrl] = useState(null);
  const failed = Boolean(photoUrl) && failedUrl === photoUrl;

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";

  const boxStyle = {
    width: size,
    height: size,
    borderRadius: 10,
    flexShrink: 0,
    ...style,
  };

  if (!photoUrl || failed) {
    return (
      <div
        className={className}
        style={{
          ...boxStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#e5e7eb",
          color: "#6b7280",
          fontWeight: 700,
          fontSize: Math.round(size / 2.6),
          letterSpacing: "0.5px",
        }}
        title={name}
        aria-label={name || "Member photo"}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      className={className}
      src={photoUrl}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailedUrl(photoUrl)}
      style={{
        ...boxStyle,
        objectFit: "cover",
        display: "block",
        background: "#e5e7eb",
      }}
    />
  );
}
