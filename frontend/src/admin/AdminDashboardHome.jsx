import { useEffect, useRef, useState } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import apiClient from "../utils/apiClient.js";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/* ── Semantic visualization palette ──────────────────────────────
   Primary business data uses the brand accent; categorical data uses
   stable secondary tones so the same category keeps the same colour
   across every chart (e.g. "Weight Gain" is always blue). */
const TRAINING_TYPE_COLORS = {
  "Weight Loss": "var(--accent)",
  "Weight Gain": "#6ca8ff",
  "Transformation": "#3ddc84",
};
const PALETTE = ["#6ca8ff", "var(--accent)", "#3ddc84", "#b78bff", "#ffb800", "#26c6da"];
const categoryColor = (name = "", index = 0) =>
  TRAINING_TYPE_COLORS[name] || PALETTE[index % PALETTE.length];

const formatINR = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;
const formatCount = (value) => Number(value || 0).toLocaleString("en-IN");

const compactCurrency = (value) => {
  const n = Number(value || 0);
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1).replace(/\.0$/, "")}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1).replace(/\.0$/, "")}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `₹${n}`;
};

const TOOLTIP_STYLE = {
  background: "var(--surface-soft)",
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  color: "var(--text-primary)",
  fontSize: 12,
  padding: "6px 10px",
};

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
    } catch {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const planItems = Object.entries(safePlans).map(([name, value]) => ({ name, value: Number(value) || 0 }));
  const trainingItems = Object.entries(view === "today" ? safeTrainingIncome : safeMemberCounts).map(
    ([name, value]) => ({ name, value: Number(value) || 0 })
  );

  return (
    <div className="saas-container dashboard-shell">
      <header className="dash-header">
        <div className="dash-header-meta">
          <h1 className="dash-title">Revenue Dashboard</h1>
          <p className="dash-subtitle">Live daily performance</p>
          <div className="dash-meta">
            <span>Auto refresh: 30s</span>
            <span aria-hidden="true">•</span>
            <span>Business hours: 4:00 AM – 11:00 PM</span>
          </div>
        </div>

        <div className="dash-header-controls">
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
      </header>

      {view === "custom" && (
        <div className="saas-filter-bar dash-filter">
          <div className="dash-filter-item">
            <label htmlFor="dash-from">From</label>
            <DatePicker id="dash-from" selected={fromDate} onChange={setFromDate} dateFormat="yyyy-MM-dd" className="saas-input" />
          </div>

          <div className="dash-filter-item">
            <label htmlFor="dash-to">To</label>
            <DatePicker id="dash-to" selected={toDate} onChange={setToDate} dateFormat="yyyy-MM-dd" className="saas-input" />
          </div>

          <div className="dash-filter-actions">
            <button
              type="button"
              className="btn-primary min-h-0 px-4 py-2"
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

            <button type="button" className="btn-secondary min-h-0 px-4 py-2" onClick={exportAnalyticsPDF}>
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
          <section className="dash-grid dash-grid-kpis" aria-label="Key metrics">
            <DashboardMetricCard
              title={view === "today" ? "Today's Revenue" : "Total Revenue"}
              value={formatINR(displayData?.totalAmount || 0)}
              emphasized
            />
            <DashboardMetricCard title="New Joining Revenue" value={formatINR(displayData?.newVsRenew?.new || 0)} />
            <DashboardMetricCard title="Renewal Revenue" value={formatINR(displayData?.newVsRenew?.renewal || 0)} />
            <DashboardMetricCard title="Transactions" value={formatCount(displayData?.logs?.length || 0)} />
          </section>

          {Object.keys(safePlans).length > 0 ? (
            <>
              <section className="dash-grid dash-grid-2" aria-label="Revenue by plan and training type">
                <ChartCard title={view === "today" ? "Today's Income by Plan" : "Income by Plan"}>
                  {planItems.length > 1 ? (
                    <MiniBarChart
                      data={planItems}
                      tickFormatter={(v) => compactCurrency(v)}
                      valueLabel="income by plan"
                      color="var(--accent)"
                    />
                  ) : (
                    <DistributionBreakdown data={planItems} formatter={formatINR} />
                  )}
                </ChartCard>

                <ChartCard title={view === "today" ? "Income by Training Type" : "Members by Training Type"}>
                  <DistributionBreakdown
                    data={trainingItems}
                    formatter={view === "today" ? formatINR : formatCount}
                  />
                </ChartCard>
              </section>

              <section className="dash-grid dash-grid-3" aria-label="Member analytics">
                <ChartCard title="Age Distribution">
                  <AnalyticsBlock loading={analyticsLoading} hasData={ageDistribution.length > 0}>
                    <MiniBarChart
                      data={ageDistribution}
                      xKey="ageRange"
                      yKey="count"
                      tickFormatter={(v) => String(v)}
                      valueLabel="member age distribution"
                      color="#6ca8ff"
                    />
                  </AnalyticsBlock>
                </ChartCard>

                <ChartCard title="Source Contribution">
                  <AnalyticsBlock loading={analyticsLoading} hasData={sourceContribution.length > 0}>
                    <DistributionBreakdown data={sourceContribution} formatter={formatINR} />
                  </AnalyticsBlock>
                </ChartCard>

                <ChartCard title="Plan Distribution">
                  <AnalyticsBlock loading={analyticsLoading} hasData={planDistribution.length > 0}>
                    <DistributionBreakdown data={planDistribution} formatter={formatINR} />
                  </AnalyticsBlock>
                </ChartCard>
              </section>
            </>
          ) : (
            <div className="empty-state">
              <p>
                {view === "today"
                  ? "No transactions recorded today yet."
                  : "No data found for the selected date range."}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Reusable dashboard components ──────────────────────────────── */

function DashboardMetricCard({ title, value, emphasized = false }) {
  return (
    <article className={`dash-kpi ${emphasized ? "dash-kpi-primary" : ""}`}>
      <span className="dash-kpi-title">{title}</span>
      <span className="dash-kpi-value">{value}</span>
    </article>
  );
}

function ChartCard({ title, children }) {
  return (
    <section className="dash-chart-card">
      <h3 className="dash-chart-title">{title}</h3>
      {children}
    </section>
  );
}

function MiniBarChart({ data, xKey = "name", yKey = "value", color, tickFormatter, valueLabel }) {
  return (
    <div role="img" aria-label={`Bar chart: ${valueLabel}`}>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="26%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border-color)" }}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={tickFormatter}
          />
          <Tooltip
            formatter={(v) => (typeof tickFormatter === "function" ? tickFormatter(v) : v)}
            cursor={{ fill: "rgba(212,175,55,0.06)" }}
            contentStyle={TOOLTIP_STYLE}
          />
          <Bar dataKey={yKey} fill={color} radius={[5, 5, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* Data-aware distribution. Shows a compact single-metric summary when the
   dataset has one category, otherwise a proportional segmented list. This
   never renders a giant pie for a single data point. */
function DistributionBreakdown({ data = [], formatter = formatINR }) {
  const items = data.map((d) => ({
    name: d.name || d.planName || d.ageRange || "Unknown",
    value: Number(d.value || 0),
  }));

  if (items.length === 0) return <p className="muted-copy">No data available.</p>;

  const total = items.reduce((sum, d) => sum + d.value, 0);

  if (items.length === 1) {
    const d = items[0];
    const color = categoryColor(d.name, 0);
    return (
      <div className="dash-dist dash-dist-single">
        <span className="dash-dist-single-label">
          <i className="dash-dist-dot" style={{ background: color }} aria-hidden="true" />
          {d.name}
        </span>
        <span className="dash-single-value">{formatter(d.value)}</span>
        <span className="dash-single-pct">100%</span>
      </div>
    );
  }

  return (
    <div className="dash-dist">
      {items.map((d, idx) => {
        const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
        const color = categoryColor(d.name, idx);
        return (
          <div key={d.name} className="dash-dist-row">
            <div className="dash-dist-head">
              <span className="dash-dist-name" title={d.name}>
                <i className="dash-dist-dot" style={{ background: color }} aria-hidden="true" />
                {d.name}
              </span>
              <span className="dash-dist-pct">{pct}%</span>
              <span className="dash-dist-value">{formatter(d.value)}</span>
            </div>
            <div className="dash-dist-track" role="img" aria-label={`${d.name}: ${pct}%`}>
              <div className="dash-dist-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
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