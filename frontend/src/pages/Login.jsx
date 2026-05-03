import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiClient from "../utils/apiClient.js";

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [captchaInput, setCaptchaInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const createCaptcha = () => {
    const text = Math.floor(1000 + Math.random() * 9000).toString();
    setCaptcha(text);
  };

  useEffect(() => {
    createCaptcha();
  }, []);

  const submitLogin = async (e) => {
    e.preventDefault();
    setLoginError("");

    if (!username.trim()) {
      setLoginError("Username is required");
      return;
    }

    if (password.length < 6) {
      setLoginError("Password must be at least 6 characters");
      return;
    }

    if (!captchaInput.trim()) {
      setLoginError("Please enter the captcha");
      return;
    }

    setLoading(true);

    try {
      await apiClient.post(
        "/admin/login",
        {
          username,
          password,
          captchaInput,
          captchaActual: captcha,
        }
      );

      navigate("/admin");
    } catch (err) {
      const errorMsg = err.response?.data?.message || "Login failed. Please try again.";
      setLoginError(errorMsg);
      createCaptcha();
      setCaptchaInput("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-shell">
      <div className="admin-login-wrap">
        <section className="admin-login-hero">
          <p className="admin-login-eyebrow">Operations Console</p>
          <h1>Secure entry for the gym management workspace.</h1>
          <p>Login keeps billing, members, renewals, and package operations inside a single controlled dashboard.</p>
          <button onClick={() => navigate("/")} className="admin-login-home" aria-label="Go to home page">
            Home
          </button>
        </section>

        <section className="admin-login-card">
          <p className="admin-login-eyebrow">Admin Access</p>
          <h2>GIRI GYM</h2>
          <p className="admin-login-sub">Use your admin username and password to continue.</p>

          <form onSubmit={submitLogin} className="admin-login-form">
            {loginError ? <div className="admin-login-error">{loginError}</div> : null}

            <div className="admin-login-field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="admin-login-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="admin-login-captcha">
              <div className="admin-login-captcha-head">
                <p>Captcha Verification</p>
                <button type="button" onClick={createCaptcha}>
                  Refresh
                </button>
              </div>
              <div className="admin-login-captcha-code">{captcha}</div>
              <input
                type="text"
                placeholder="Enter captcha"
                value={captchaInput}
                onChange={(e) => setCaptchaInput(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <button type="submit" disabled={loading} className="admin-login-submit">
              {loading ? "Logging in..." : "Login"}
            </button>
          </form>

          <p className="admin-login-copy">Copyright 2026 Giri Gym. All rights reserved.</p>
        </section>
      </div>
    </div>
  );
}
