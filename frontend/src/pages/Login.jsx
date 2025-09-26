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
    <div className="page-shell">
      <header className="glass-bar">
        <div className="page-frame flex items-center justify-between gap-4 py-4">
          <div>
            <p className="eyebrow">Admin Access</p>
            <div className="text-2xl font-extrabold tracking-[0.18em] dark-text">GIRI GYM</div>
          </div>
          <button onClick={() => navigate("/")} className="nav-link nav-link-active" aria-label="Go to home page">
            Home
          </button>
        </div>
      </header>

      <div className="page-frame py-8">
        <div className="hero-grid">
          <section className="hero-panel">
            <div className="hero-image h-full">
              <img
                src="https://images.unsplash.com/photo-1571902943202-507ec2618e8f?auto=format&fit=crop&w=1400&q=80"
                alt="Admin login backdrop"
                style={{ height: "100%", minHeight: "620px" }}
              />
            </div>

            <div className="absolute inset-0 z-10 flex items-end p-6 sm:p-8">
              <div className="max-w-xl section-stack">
                <span className="eyebrow">Operations Console</span>
                <h1 className="text-4xl font-extrabold sm:text-5xl">
                  Secure entry for the gym management workspace.
                </h1>
                <p>
                  Login keeps billing, members, renewals, and package operations inside a single controlled dashboard.
                </p>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <span className="eyebrow">Sign In</span>
              <h2 className="text-3xl">Admin Login</h2>
              <p className="panel-subtitle">Use your admin username and password to continue.</p>
            </div>

            <form onSubmit={submitLogin} className="section-stack mt-6">
              {loginError && (
                <div className="status-pill status-pill-danger justify-start rounded-xl px-4 py-3">
                  {loginError}
                </div>
              )}

              <div className="field-group">
                <label htmlFor="username" className="field-label">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  placeholder="Enter username"
                  className="field-control"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>

              <div className="field-group">
                <label htmlFor="password" className="field-label">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  className="field-control"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>

              <div className="panel" style={{ padding: "20px", background: "var(--surface-muted)" }}>
                <div className="section-stack" style={{ gap: "16px" }}>
                  <div>
                    <p className="field-label">Captcha Verification</p>
                    <p className="muted-copy mt-2">Enter the verification code shown below.</p>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="chip px-5 py-4 text-lg tracking-[0.4em] light-text">{captcha}</div>
                    <button type="button" onClick={createCaptcha} className="btn-ghost">
                      Refresh
                    </button>
                  </div>

                  <input
                    type="text"
                    placeholder="Enter captcha"
                    className="field-control"
                    value={captchaInput}
                    onChange={(e) => setCaptchaInput(e.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? "Logging in..." : "Login"}
              </button>
            </form>

            <p className="muted-copy mt-6">Copyright 2025 Giri Gym. All rights reserved.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
