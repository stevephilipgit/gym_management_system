import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiEye, FiEyeOff, FiLock, FiRefreshCw, FiShield, FiUser } from "react-icons/fi";
import apiClient from "../utils/apiClient.js";
import { saveSessionIdentity } from "../utils/sessionIdentity.js";

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaSvg, setCaptchaSvg] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const fetchCaptcha = async () => {
    setCaptchaLoading(true);
    setCaptchaAnswer("");
    try {
      const res = await apiClient.get("/admin/captcha");
      setCaptchaId(res.data?.captchaId || "");
      setCaptchaSvg(res.data?.svgBase64 || "");
    } catch {
      setLoginError("Unable to load the security check. Please refresh the page.");
    } finally {
      setCaptchaLoading(false);
    }
  };

  useEffect(() => {
    fetchCaptcha();
  }, []);

  const submitLogin = async (e) => {
    e.preventDefault();
    setLoginError("");

    if (!username.trim()) {
      setLoginError("Username or email is required");
      return;
    }

    if (password.length < 8) {
      setLoginError("Password must be at least 8 characters");
      return;
    }

    if (!captchaAnswer.trim()) {
      setLoginError("Please enter the captcha");
      return;
    }

    setLoading(true);

    try {
      const res = await apiClient.post("/admin/login", {
        username,
        password,
        captchaId,
        captchaAnswer,
      });

      // Bind this tab to the session identity (opaque sid + admin id — NOT the
      // JWT). The server matches the sid against the httpOnly cookie pair for
      // THIS tab's session; the admin id lets AuthGuard detect a tab that was
      // taken over by another session in the same browser.
      if (res.data?.sessionId) {
        saveSessionIdentity(res.data.sessionId, res.data?.admin?.id);
      }

      navigate("/admin");
    } catch (err) {
      const errorMsg = err.response?.data?.message || "Login failed. Please try again.";
      setLoginError(errorMsg);
      fetchCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-page">
      <div className="admin-login-bg" aria-hidden="true" />
      <div className="admin-login-accent" aria-hidden="true" />

      <div className="admin-login-frame">
        <header className="admin-login-brand">
          <p className="admin-login-brand-name">
            GIRI <span>GYM</span>
          </p>
          <p className="admin-login-brand-portal">Admin Portal</p>
          <p className="admin-login-brand-sub">Gym Management System</p>
        </header>

        <div className="admin-login-card">
          <form onSubmit={submitLogin} className="admin-login-form">
            {loginError ? <div className="admin-login-error" role="alert">{loginError}</div> : null}

            <div className="admin-login-field">
              <label htmlFor="username">Username or Email</label>
              <div className="admin-login-input">
                <FiUser className="admin-login-input-icon" />
                <input
                  id="username"
                  type="text"
                  placeholder="username or email"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            <div className="admin-login-field">
              <label htmlFor="password">Password</label>
              <div className="admin-login-input">
                <FiLock className="admin-login-input-icon" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="--------"
                  autoComplete="current-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  className="admin-login-password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  disabled={loading}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <FiEyeOff /> : <FiEye />}
                </button>
              </div>
            </div>

            <div className="admin-login-field">
              <label htmlFor="captcha">Captcha</label>
              <div className="admin-login-captcha-row">
                <div className="admin-login-captcha-code">
                  {captchaSvg ? (
                    <img
                      src={`data:image/svg+xml;base64,${captchaSvg}`}
                      alt="Security check"
                      className="admin-login-captcha-img"
                    />
                  ) : (
                    <span className="admin-login-captcha-placeholder">
                      {captchaLoading ? "Loading..." : "Unavailable"}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="admin-login-captcha-refresh"
                  onClick={fetchCaptcha}
                  disabled={loading || captchaLoading}
                  aria-label="Refresh captcha"
                >
                  <FiRefreshCw />
                  Refresh
                </button>
              </div>
              <div className="admin-login-input">
                <FiShield className="admin-login-input-icon" />
                <input
                  id="captcha"
                  type="text"
                  placeholder="Enter captcha"
                  autoComplete="off"
                  maxLength={6}
                  value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            <button type="submit" disabled={loading} className="admin-login-submit">
              {loading ? "Logging in..." : "Login"}
            </button>
          </form>
        </div>

        <p className="admin-login-secure">
          <FiLock className="admin-login-secure-icon" />
          Secure admin access
        </p>

        <button
          type="button"
          onClick={() => navigate("/")}
          className="admin-login-home"
          aria-label="Go to home page"
        >
          Back to Home
        </button>

        <p className="admin-login-copy">© 2026 Giri Gym. All rights reserved.</p>
      </div>
    </div>
  );
}
