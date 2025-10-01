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

const COLORS = ["#ccff00", "#6ca8ff", "#3ddc84", "#ffb800"];

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

  const displayData = view === "today" ? todayData : customData;
  const safePlans = displayData?.plans || {};
  const safeTrainingIncome = displayData?.trainingTypes || {};
  const safeMemberCounts = displayData?.memberCountsByTraining || {};

  return (
    <div className="section-stack">
      <section className="panel">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="section-heading">
            <span className="eyebrow">Finance Console</span>
            <h2 className="text-3xl sm:text-4xl">Revenue dashboard</h2>
            <p className="panel-subtitle">
              View live daily performance or generate historical reports without leaving the admin workspace.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={() => setView("today")} className={view === "today" ? "btn-primary" : "btn-secondary"}>
              Today's Analytics
            </button>
            <button onClick={() => setView("custom")} className={view === "custom" ? "btn-primary" : "btn-secondary"}>
              Custom Range
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <span className="chip">Auto refresh every 30 seconds</span>
          <span className="chip">Business hours 4:00 AM to 11:00 PM</span>
        </div>
      </section>

      {view === "custom" && (
        <section className="panel">
          <div className="section-heading">
            <span className="eyebrow">Report Range</span>
            <h3 className="panel-title">Select dates</h3>
          </div>

          <div className="form-grid-2 mt-6">
            <div className="field-group">
              <label className="field-label">From</label>
              <DatePicker selected={fromDate} onChange={setFromDate} dateFormat="yyyy-MM-dd" className="field-control" />
            </div>

            <div className="field-group">
              <label className="field-label">To</label>
              <DatePicker selected={toDate} onChange={setToDate} dateFormat="yyyy-MM-dd" className="field-control" />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
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
              className="btn-primary"
            >
              {customLoading ? "Loading..." : "Generate Report"}
            </button>

            <button onClick={exportAnalyticsPDF} className="btn-secondary">
              Export PDF
            </button>
          </div>
        </section>
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
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={Object.entries(safePlans).map(([plan, amount]) => ({ plan, amount }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="plan" stroke="#818181" />
                    <YAxis stroke="#818181" />
                    <Tooltip />
                    <Bar dataKey="amount" fill="#ccff00" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartPanel>

              <ChartPanel title={view === "today" ? "Income by Training Type" : "Members by Training Type"}>
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie
                      data={Object.entries(view === "today" ? safeTrainingIncome : safeMemberCounts).map(([name, value]) => ({
                        name,
                        value,
                      }))}
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
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={ageDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="ageRange" stroke="#818181" />
                    <YAxis stroke="#818181" />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6ca8ff" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </AnalyticsBlock>
            </ChartPanel>

            <ChartPanel title="Source Contribution">
              <AnalyticsBlock loading={analyticsLoading} hasData={sourceContribution.length > 0}>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={sourceContribution} cx="50%" cy="50%" outerRadius={96} dataKey="value" label>
                      {sourceContribution.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </AnalyticsBlock>
            </ChartPanel>

            <ChartPanel title="Plan Distribution">
              <AnalyticsBlock loading={analyticsLoading} hasData={planDistribution.length > 0}>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={planDistribution} cx="50%" cy="50%" outerRadius={96} dataKey="value" label>
                      {planDistribution.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
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

function MetricCard({ title, value, accent = "default" }) {
  const accentClass =
    accent === "revenue"
      ? "text-[#FF5CF7]"
      : accent === "warning"
      ? "text-warning"
      : accent === "info"
        ? "text-[#6ca8ff]"
        : accent === "success"
          ? "text-success"
          : "light-text";

  return (
    <article className="metric-card">
      <span className="eyebrow">Summary</span>
      <div>
        <p className="muted-copy">{title}</p>
        <p className={`metric-value mt-4 ${accentClass}`}>{value}</p>
      </div>
    </article>
  );
}

function ChartPanel({ title, children }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <span className="eyebrow">Visualization</span>
        <h3 className="panel-title">{title}</h3>
      </div>
      <div className="mt-6">{children}</div>
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
