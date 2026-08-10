import { useEffect, useRef, useState } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import apiClient from "../utils/apiClient.js";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = ["#D4AF37", "#6ca8ff", "#3ddc84", "#ffb800"];

export default function AdminDashboardHome() {
  const [todayData, setTodayData] = useState(null);
  const [todayLoading, setTodayLoading] = useState(false);
  const [fromDate, setFromDate] = useState(null);
  const [toDate, setToDate] = useState(null);
  const [customData, setCustomData] = useState(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [ageDistribution, setAgeDistribution] = useState([]);
  const [sourceContribution, setSourceContribution] = useState([]);
  const [planDistribution, setPlanDistribution] = useState([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [view, setView] = useState("today");
  const [lastMidnightCheck, setLastMidnightCheck] = useState(new Date());

  const pollIntervalRef = useRef(null);
  const midnightCheckRef = useRef(null);

  const fetchTodayData = async () => {
    setTodayLoading(true);
    try {
      const res = await apiClient.get("/finance/summary/today");
      setTodayData(res.data?.data || res.data || null);
    } catch (err) {
      console.error("Error fetching today's data:", err);
    } finally {
      setTodayLoading(false);
    }
  };

  const fetchCustomReport = async () => {
    if (!fromDate || !toDate) {
      alert("Please select both dates");
      return;
    }

    setCustomLoading(true);
    try {
      const res = await apiClient.get("/finance/income", {
        params: {
          from: fromDate.toISOString().split("T")[0],
          to: toDate.toISOString().split("T")[0],
        }
      });
      setCustomData(res.data?.data || res.data || null);
    } catch (err) {
      alert("No data found for this range");
      setCustomData(null);
    } finally {
      setCustomLoading(false);
    }
  };

  const exportAnalyticsPDF = async () => {
    try {
      if (!fromDate || !toDate) {
        alert("Please select both dates for export");
        return;
      }

      if (!customData) {
        alert("Please generate a report first before exporting");
        return;
      }

      const startDate = fromDate.toISOString().split("T")[0];
      const endDate = toDate.toISOString().split("T")[0];

      const response = await apiClient.post(
        "/analytics/export-pdf",
        {
          startDate,
          endDate,
          dashboardData: customData,
        },
        { responseType: "blob" }
      );

      const blob = new Blob([response.data], { type: "application/pdf" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `analytics_${startDate}_to_${endDate}.pdf`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error("Export Error:", err);
      alert("Failed to export PDF. Please check the console for details.");
    }
  };

  const fetchAnalytics = async (params = {}) => {
    setAnalyticsLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (params.from) queryParams.append("from", params.from);
      if (params.to) queryParams.append("to", params.to);

      const [ageRes, sourceRes, planRes] = await Promise.all([
        apiClient.get(`/finance/analytics/age-distribution?${queryParams}`),
        apiClient.get(`/finance/analytics/source-contribution?${queryParams}`),
        apiClient.get(`/finance/analytics/plan-distribution?${queryParams}`),
      ]);

      setAgeDistribution(ageRes.data.data || []);
      setSourceContribution(sourceRes.data.data || []);
      setPlanDistribution(planRes.data.data || []);
    } catch (err) {
      console.error("Error fetching analytics:", err);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const checkMidnight = () => {
    const now = new Date();
    const lastCheck = new Date(lastMidnightCheck);
    if (
      now.getDate() !== lastCheck.getDate() ||
      now.getMonth() !== lastCheck.getMonth() ||
      now.getFullYear() !== lastCheck.getFullYear()
    ) {
      fetchTodayData();
      const todayDate = now.toISOString().split("T")[0];
      fetchAnalytics({ from: todayDate, to: todayDate });
      setLastMidnightCheck(now);
    }
  };

  useEffect(() => {
    fetchTodayData();
    const today = new Date().toISOString().split("T")[0];
    fetchAnalytics({ from: today, to: today });

    pollIntervalRef.current = setInterval(() => {
      if (view === "today") {
        fetchTodayData();
      }
    }, 30000);

    midnightCheckRef.current = setInterval(checkMidnight, 60000);

    return () => {
      clearInterval(pollIntervalRef.current);
      clearInterval(midnightCheckRef.current);
    };
  }, [view]);

  const applyPresetRange = async (preset) => {
    if (preset === "today") {
      setView("today");
      await fetchTodayData();
      const today = new Date().toISOString().split("T")[0];
      await fetchAnalytics({ from: today, to: today });
      return;
    }

    if (preset === "custom") {
      setView("custom");
      return;
    }

    // compute date ranges for other presets
    const now = new Date();
    let from, to;
    to = now.toISOString().split("T")[0];
    if (preset === "yesterday") {
      const y = new Date(now);
      y.setDate(now.getDate() - 1);
      from = y.toISOString().split("T")[0];
    } else if (preset === "7day") {
      const d = new Date(now);
      d.setDate(now.getDate() - 6);
      from = d.toISOString().split("T")[0];
    } else if (preset === "30day") {
      const d = new Date(now);
      d.setDate(now.getDate() - 29);
      from = d.toISOString().split("T")[0];
    }

    if (from && to) {
      setView("custom");
      setFromDate(new Date(from));
      setToDate(new Date(to));
      // fetch income and analytics for this range
      try {
        setCustomLoading(true);
        const res = await apiClient.get("/finance/income", { params: { from, to } });
        setCustomData(res.data?.data || res.data || null);
      } catch {
        setCustomData(null);
      } finally {
        setCustomLoading(false);
      }

      await fetchAnalytics({ from, to });
    }
  };

  const displayData = view === "today" ? todayData : customData;
  const safePlans = displayData?.plans || {};
  const safeTrainingIncome = displayData?.trainingTypes || {};
  const safeMemberCounts = displayData?.memberCountsByTraining || {};

  return (
    <div className="saas-container dashboard-shell">
      <header className="dashboard-hero">
        <div className="dashboard-hero-meta">
          <h1>Revenue dashboard</h1>
          <p>View live daily performance or generate historical reports without leaving the admin workspace.</p>
          <div className="dashboard-hero-tags">
            <span>Auto refresh every 30 seconds</span>
            <span>Business hours 4:00 AM to 11:00 PM</span>
          </div>
        </div>

        <div className="dashboard-tab-group">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              aria-label="Date range"
              className="saas-input"
              value={view === "today" && !fromDate ? "today" : fromDate && toDate && view === "custom" ? "custom" : "today"}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "custom") {
                  applyPresetRange("custom");
                } else if (val === "today") {
                  applyPresetRange("today");
                } else if (val === "yesterday") {
                  applyPresetRange("yesterday");
                } else if (val === "7day") {
                  applyPresetRange("7day");
                } else if (val === "30day") {
                  applyPresetRange("30day");
                }
              }}
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7day">Last 7 days</option>
              <option value="30day">Last 30 days</option>
              <option value="custom">Custom range</option>
            </select>
          </div>
        </div>
      </header>

      {view === "custom" && (
        <div className="saas-filter-bar dashboard-filter-bar">
          <div className="dashboard-filter-item">
            <label>From</label>
            <DatePicker selected={fromDate} onChange={setFromDate} dateFormat="yyyy-MM-dd" className="saas-input" />
          </div>

          <div className="dashboard-filter-item">
            <label>To</label>
            <DatePicker selected={toDate} onChange={setToDate} dateFormat="yyyy-MM-dd" className="saas-input" />
          </div>

          <div className="dashboard-filter-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                if (!fromDate || !toDate) {
                  alert("Please select both dates");
                  return;
                }
                await fetchCustomReport();
                await fetchAnalytics({
                  from: fromDate.toISOString().split("T")[0],
                  to: toDate.toISOString().split("T")[0],
                });
              }}
            >
              {customLoading ? "Loading..." : "Generate Report"}
            </button>

            <button type="button" className="btn-secondary" onClick={exportAnalyticsPDF}>
              Export PDF
            </button>
          </div>
        </div>
      )}

      {!displayData && !todayLoading && view === "today" ? (
        <div className="empty-state">
          <p>No dashboard data is available yet.</p>
        </div>
      ) : (
        <>
          <section className="dashboard-grid dashboard-grid-metrics">
            <MetricCard title={view === "today" ? "Today's Revenue" : "Total Revenue"} value={`Rs. ${displayData?.totalAmount || 0}`} accent="revenue" />
            <MetricCard title="New Joining Revenue" value={`Rs. ${displayData?.newVsRenew?.new || 0}`} accent="warning" />
            <MetricCard title="Renewal Revenue" value={`Rs. ${displayData?.newVsRenew?.renewal || 0}`} accent="info" />
            <MetricCard title="Transactions" value={displayData?.logs?.length || 0} accent="success" />
          </section>

          {Object.keys(safePlans).length > 0 ? (
            <section className="dashboard-grid dashboard-grid-charts">
              <ChartPanel title={view === "today" ? "Today's Income by Plan" : "Income by Plan"}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={Object.entries(safePlans).map(([plan, amount]) => ({ plan, amount }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="plan" stroke="var(--text-muted)" />
                    <YAxis stroke="var(--text-muted)" />
                    <Tooltip />
                    <Bar dataKey="amount" fill="var(--accent)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartPanel>

              <ChartPanel title={view === "today" ? "Income by Training Type" : "Members by Training Type"}>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={Object.entries(view === "today" ? safeTrainingIncome : safeMemberCounts).map(([name, value]) => ({ name, value }))}
                      dataKey="value"
                      outerRadius={110}
                      label
                    >
                      {Object.entries(view === "today" ? safeTrainingIncome : safeMemberCounts).map((_, idx) => (
                        <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </ChartPanel>
            </section>
          ) : (
            <div className="empty-state">
              <p>
                {view === "today"
                  ? "No transactions recorded today yet."
                  : "No data found for the selected date range."}
              </p>
            </div>
          )}

          <section className="dashboard-grid dashboard-grid-analytics">
            <ChartPanel title="Age Distribution">
              <AnalyticsBlock loading={analyticsLoading} hasData={ageDistribution.length > 0}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={ageDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="ageRange" stroke="var(--text-muted)" />
                    <YAxis stroke="var(--text-muted)" />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6ca8ff" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </AnalyticsBlock>
            </ChartPanel>

            <ChartPanel title="Source Contribution">
              <AnalyticsBlock loading={analyticsLoading} hasData={sourceContribution.length > 0}>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={sourceContribution} cx="50%" cy="50%" outerRadius={96} dataKey="value" label>
                      {sourceContribution.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </AnalyticsBlock>
            </ChartPanel>

            <ChartPanel title="Plan Distribution">
              <AnalyticsBlock loading={analyticsLoading} hasData={planDistribution.length > 0}>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={planDistribution} cx="50%" cy="50%" outerRadius={96} dataKey="value" label>
                      {planDistribution.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </AnalyticsBlock>
            </ChartPanel>
          </section>
        </>
      )}
    </div>
  );
}

function CompactBreakdown({ data = [], currency = true }) {
  const total = data.reduce((s, item) => s + (item.value || 0), 0);
  if (!data || data.length === 0) return <p className="muted-copy">No data available.</p>;

  // If only one category, present a compact single-metric (no progress bar)
  if (data.length === 1) {
    const d = data[0];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <div style={{ fontSize: "1rem", fontWeight: 700 }}>{d.name || d.label || d.key}</div>
          <div style={{ textAlign: "right" }}>
            <div className="metric-value" style={{ margin: 0 }}>{currency ? `Rs. ${d.value || 0}` : d.value || 0}</div>
            <div className="muted-copy">100%</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {data.map((d, idx) => {
        const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
        return (
          <div key={idx} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontWeight: 700 }}>{d.name || d.label || d.key}</div>
                <div className="muted-copy">{currency ? `Rs. ${d.value || 0}` : d.value || 0}</div>
              </div>
              <div style={{ height: 8, background: "var(--row-odd)", borderRadius: 999 }}>
                <div style={{ height: 8, width: `${pct}%`, background: "var(--accent)", borderRadius: 999 }} />
              </div>
            </div>
            <div style={{ minWidth: 48, textAlign: "right" }} className="muted-copy">{pct}%</div>
          </div>
        );
      })}
    </div>
  );
}

const METRIC_ICONS = {
  revenue: "₹",
  warning: "↑",
  info: "↻",
  success: "#",
};

const METRIC_VALUE_COLOR = {
  revenue: "text-[var(--accent)]",
  warning: "text-[var(--warning)]",
  info: "text-[var(--info)]",
  success: "text-[var(--success)]",
};

function MetricCard({ title, value, accent = "default" }) {
  const valueColorClass = METRIC_VALUE_COLOR[accent] ?? "";
  const icon = METRIC_ICONS[accent] ?? "";

  return (
    <article className={`dashboard-metric-card accent-${accent}`}>
      <div className="dashboard-metric-card-header">
        <span className="eyebrow">Summary</span>
        {icon && (
          <span className="dashboard-metric-card-icon" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <div>
        <p className="metric-title">{title}</p>
        <p className={`metric-value mt-3 ${valueColorClass}`}>{value}</p>
      </div>
    </article>
  );
}

function ChartPanel({ title, children }) {
  return (
    <section className="dashboard-chart-panel">
      <h3 className="dashboard-chart-title">{title}</h3>
      <div className="dashboard-chart-body">{children}</div>
    </section>
  );
}

function AnalyticsBlock({ loading, hasData, children }) {
  if (loading) {
    return <p className="muted-copy">Loading analytics...</p>;
  }

  if (!hasData) {
    return <p className="muted-copy">No data available.</p>;
  }

  return children;
}
