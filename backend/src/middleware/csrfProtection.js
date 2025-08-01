import csurf from "csurf";

const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  },
});

export default csrfProtection;
