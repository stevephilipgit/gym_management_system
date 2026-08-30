import { generateWithFallback } from "./providerFactory.js";

const DAY_MS = 1000 * 60 * 60 * 24;

const getDaysRemaining = (validTill) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const valid = new Date(validTill);
  valid.setHours(0, 0, 0, 0);

  return Math.floor((valid.getTime() - today.getTime()) / DAY_MS);
};

const getFallbackMessage = (member, daysRemaining) =>
  `Hi ${member.name}, your gym membership expires in ${daysRemaining} day(s). Please renew soon!`;

export const generateReminderMessage = async (member) => {
  if (!member || typeof member.name !== "string" || !member.name.trim()) {
    throw new Error("Member name is required");
  }

  const validDate = new Date(member.validTill);
  if (Number.isNaN(validDate.getTime())) {
    throw new Error("Member validTill must be a valid date");
  }

  const daysRemaining = getDaysRemaining(member.validTill);
  const formattedDate = validDate.toLocaleDateString("en-GB");
  const prompt = `Generate a short, friendly WhatsApp reminder for a gym member.
Member name: ${member.name}
Membership expires in: ${daysRemaining} day(s) (on ${formattedDate})
Requirements: max 2 sentences, include their name,
mention exact days remaining, end with a call to action.
Return only the message text, nothing else.`;

  try {
    const result = await generateWithFallback({
      systemPrompt: "You generate short gym reminder messages. Reply with only the message text.",
      history: [],
      userMessage: prompt,
    });
    return String(result.text ?? "").trim();
  } catch {
    return getFallbackMessage(member, daysRemaining);
  }
};

export const buildWhatsAppLink = async (phone, message) => {
  const sanitizedPhone = String(phone || "")
    .trim()
    .replace(/(?!^\+)[^\d]/g, "")
    .replace(/^\+/, "");

  return `https://wa.me/${sanitizedPhone}?text=${encodeURIComponent(message)}`;
};

export const prepareRemindersWithMessages = async (members) => {
  const cappedMembers = members.length > 20 ? members.slice(0, 20) : members;
  const warning = members.length > 20 ? "Only first 20 members processed" : null;

  const results = await Promise.allSettled(
    cappedMembers.map(async (member) => {
      const message = await generateReminderMessage(member);
      const whatsappLink = await buildWhatsAppLink(member.phone, message);

      return {
        name: member.name,
        phone: member.phone,
        email: member.email ?? null,
        validTill: member.validTill,
        daysRemaining: getDaysRemaining(member.validTill),
        message,
        whatsappLink,
        status: "Ready",
      };
    })
  );

  const reminders = await Promise.all(
    results.map(async (result, index) => {
      const member = cappedMembers[index];

      if (result.status === "fulfilled") {
        return result.value;
      }

      const daysRemaining = getDaysRemaining(member.validTill);
      const fallbackMessage = getFallbackMessage(member, daysRemaining);
      return {
        name: member.name,
        phone: member.phone,
        email: member.email ?? null,
        validTill: member.validTill,
        daysRemaining,
        message: fallbackMessage,
        whatsappLink: await buildWhatsAppLink(member.phone, fallbackMessage),
        status: "Ready",
      };
    })
  );

  return {
    count: reminders.length,
    warning,
    reminders,
  };
};
