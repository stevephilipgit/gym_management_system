const DAY_MS = 1000 * 60 * 60 * 24;

export const getDaysRemaining = (validTill) => {
  if (!validTill) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const valid = new Date(validTill);
  if (isNaN(valid)) {
    console.error("Invalid date:", validTill);
    return 0;
  }
  valid.setHours(0, 0, 0, 0);

  const diffTime = valid.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffTime / DAY_MS);

  return daysRemaining;
};

export const getDaysIndicatorClass = (daysRemaining) => {
  if (daysRemaining < 3) return "status-pill status-red";
  if (daysRemaining < 7) return "status-pill status-yellow";
  return "status-pill status-green";
};
