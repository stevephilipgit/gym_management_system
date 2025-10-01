import DOMPurify from "dompurify";

export const sanitizeHtml = (dirty) =>
  DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ["b", "i", "em", "strong", "p", "br", "ul", "li", "ol", "a"],
    ALLOWED_ATTR: ["href", "target", "rel"],
  });
