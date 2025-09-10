export function generateFormattedName(fullName, fatherName) {
  if (!fullName || !fatherName) return fullName;

  fullName = fullName.trim();
  fatherName = fatherName.trim();
  const correctInitial = fatherName.charAt(0).toUpperCase();

  const parts = fullName.split(/\s+/);
  const last = parts[parts.length - 1];

  // Case 1: Last word is ANY initial (A / A.)
  if (/^[A-Za-z]\.?$/.test(last)) {
    parts[parts.length - 1] = `${correctInitial}.`;
    return parts.join(" ")
      .replace(/\s+/g, " ")
      .replace(/\.+/g, ".")
      .trim();
  }

  // Case 2: Last word is ALREADY correct initial
  if (last.toUpperCase() === correctInitial || last.toUpperCase() === `${correctInitial}.`) {
    return fullName
      .replace(/\s+/g, " ")
      .replace(/\.+/g, ".")
      .trim();
  }

  // Case 3: No initial present → append
  return `${fullName} ${correctInitial}.`
    .replace(/\s+/g, " ")
    .replace(/\.+/g, ".")
    .trim();
}
