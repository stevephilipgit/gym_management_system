# 🚀 Analytics Charts - Quick Implementation Reference

## File Modifications Summary

### 📁 File 1: `gym_project_backend/models/Member.js`

**What to add**: Indexes for optimization

**Location**: After memberSchema definition, before `export default mongoose.model("Member", memberSchema);`

**Current Last Lines** (line ~75-80):
```javascript
memberSchema.pre("save", function (next) {
  if (this.fullName && this.fatherName) {
    this.fullName = generateFormattedName(this.fullName, this.fatherName);
  }
  next();
});

export default mongoose.model("Member", memberSchema);
```

**Change To**:
```javascript
memberSchema.pre("save", function (next) {
  if (this.fullName && this.fatherName) {
    this.fullName = generateFormattedName(this.fullName, this.fatherName);
  }
  next();
});

// ✅ ADD THESE INDEXES FOR ANALYTICS OPTIMIZATION
memberSchema.index({ dob: 1 });
memberSchema.index({ gymPlan: 1 });
memberSchema.index({ createdAt: 1 });
memberSchema.index({ status: 1 });
memberSchema.index({ dob: 1, createdAt: 1 });
memberSchema.index({ gymPlan: 1, createdAt: 1 });

export default mongoose.model("Member", memberSchema);
```

---

### 📁 File 2: `gym_project_backend/routes/financeRoutes.js`

**What to add**: 3 new API endpoints

**Location**: At the END of the file, before the final `export default router;`

**Find This** (should be near line 280-301):
```javascript
router.get("/income", adminAuth, financeLimiter, async (req, res) => {
  // ... existing code ...
});

export default router;
```

**Add This Before** `export default router;`:

```javascript
/* ============================================================
   ANALYTICS ENDPOINT 1: AGE DISTRIBUTION HISTOGRAM
============================================================ */
router.get("/analytics/age-distribution", adminAuth, async (req, res) => {
  try {
    const { from, to } = req.query;

    const dateFilter = {};
    if (from || to) {
      if (from) dateFilter.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.$lte = toDate;
      }
    }

    const ageDistribution = await Member.aggregate([
      {
        $match: {
          status: "active",
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        }
      },
      {
        $addFields: {
          age: {
            $floor: {
              $divide: [
                { $subtract: [new Date(), "$dob"] },
                31536000000,
              ]
            }
          }
        }
      },
      {
        $bucket: {
          groupBy: "$age",
          boundaries: [0, 18, 26, 36, 46, 120],
          default: "Unknown",
          output: {
            count: { $sum: 1 }
          }
        }
      },
      {
        $project: {
          _id: 0,
          ageRange: {
            $switch: {
              branches: [
                { case: { $eq: ["$_id", 0] }, then: "18-25" },
                { case: { $eq: ["$_id", 26] }, then: "26-35" },
                { case: { $eq: ["$_id", 36] }, then: "36-45" },
                { case: { $eq: ["$_id", 46] }, then: "46+" },
              ],
              default: "Unknown"
            }
          },
          count: 1
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: ageDistribution,
      total: ageDistribution.reduce((sum, item) => sum + item.count, 0),
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("Age distribution error:", err);
    res.status(500).json({ message: "Failed to fetch age distribution" });
  }
});


/* ============================================================
   ANALYTICS ENDPOINT 2: SOURCE CONTRIBUTION PIE CHART
============================================================ */
router.get("/analytics/source-contribution", adminAuth, async (req, res) => {
  try {
    const { from, to } = req.query;

    const dateFilter = {};
    if (from || to) {
      if (from) dateFilter.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.$lte = toDate;
      }
    }

    const sourceDistribution = await Member.aggregate([
      {
        $match: {
          status: "active",
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        }
      },
      {
        $group: {
          _id: { $ifNull: ["$customFields.referral_source", "Not Specified"] },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    const total = sourceDistribution.reduce((sum, item) => sum + item.count, 0);
    
    const formatted = sourceDistribution.map(item => ({
      name: item._id || "Not Specified",
      value: item.count,
      percentage: total > 0 ? ((item.count / total) * 100).toFixed(2) : 0
    }));

    res.json({
      success: true,
      data: formatted,
      total,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("Source contribution error:", err);
    res.status(500).json({ message: "Failed to fetch source contribution" });
  }
});


/* ============================================================
   ANALYTICS ENDPOINT 3: PLAN DISTRIBUTION PIE CHART
============================================================ */
router.get("/analytics/plan-distribution", adminAuth, async (req, res) => {
  try {
    const { from, to } = req.query;

    const dateFilter = {};
    if (from || to) {
      if (from) dateFilter.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.$lte = toDate;
      }
    }

    const planDistribution = await Member.aggregate([
      {
        $match: {
          status: "active",
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        }
      },
      {
        $group: {
          _id: { $ifNull: ["$gymPlan", "Unknown"] },
          count: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0]
            }
          }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    const total = planDistribution.reduce((sum, item) => sum + item.count, 0);
    
    const formatted = planDistribution.map(item => ({
      name: item._id || "Unknown",
      value: item.count,
      percentage: total > 0 ? ((item.count / total) * 100).toFixed(2) : 0
    }));

    res.json({
      success: true,
      data: formatted,
      total,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("Plan distribution error:", err);
    res.status(500).json({ message: "Failed to fetch plan distribution" });
  }
});

export default router;
```

---

### 📁 File 3: `src/admin/AdminDashboardHome.jsx`

#### **3A. Add State Variables**

**Find This** (around line 20-30):
```javascript
export default function AdminDashboardHome() {
  // TODAY'S ANALYTICS STATE
  const [todayData, setTodayData] = useState(null);
  const [todayLoading, setTodayLoading] = useState(false);
  
  // CUSTOM RANGE STATE
  const [fromDate, setFromDate] = useState(null);
  const [toDate, setToDate] = useState(null);
  const [customData, setCustomData] = useState(null);
  const [customLoading, setCustomLoading] = useState(false);
```

**Add After** `const [customLoading, setCustomLoading] = useState(false);`:

```javascript
  
  // ✅ ANALYTICS CHARTS STATE
  const [ageDistribution, setAgeDistribution] = useState([]);
  const [sourceContribution, setSourceContribution] = useState([]);
  const [planDistribution, setPlanDistribution] = useState([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
```

#### **3B. Add fetchAnalytics Function**

**Find This** (around line 50-80):
```javascript
  const fetchCustomReport = async () => {
    if (!fromDate || !toDate) {
      alert("Please select both dates");
      return;
    }

    setCustomLoading(true);
    try {
      const res = await axios.get(
        "http://localhost:5000/api/finance/income",
        {
          params: {
            from: fromDate.toISOString().split("T")[0],
            to: toDate.toISOString().split("T")[0],
          },
          withCredentials: true,
        }
      );
      setCustomData(res.data);
    } catch (err) {
      alert("No data found for this range");
      setCustomData(null);
    } finally {
      setCustomLoading(false);
    }
  };
```

**Add After** `};`:

```javascript

  /* ============================================================
     FETCH ANALYTICS CHARTS (respect date range filter)
  ============================================================ */
  const fetchAnalytics = async (params = {}) => {
    setAnalyticsLoading(true);
    try {
      const queryParams = new URLSearchParams();
      
      if (params.from) queryParams.append("from", params.from);
      if (params.to) queryParams.append("to", params.to);

      const [ageRes, sourceRes, planRes] = await Promise.all([
        axios.get(
          `http://localhost:5000/api/finance/analytics/age-distribution?${queryParams}`,
          { withCredentials: true }
        ),
        axios.get(
          `http://localhost:5000/api/finance/analytics/source-contribution?${queryParams}`,
          { withCredentials: true }
        ),
        axios.get(
          `http://localhost:5000/api/finance/analytics/plan-distribution?${queryParams}`,
          { withCredentials: true }
        ),
      ]);

      setAgeDistribution(ageRes.data.data || []);
      setSourceContribution(sourceRes.data.data || []);
      setPlanDistribution(planRes.data.data || []);
      
      console.log("✅ Analytics data refreshed");
    } catch (err) {
      console.error("Error fetching analytics:", err);
    } finally {
      setAnalyticsLoading(false);
    }
  };
```

#### **3C. Update useEffect to Call fetchAnalytics**

**Find This** (around line 110-130):
```javascript
  useEffect(() => {
    fetchTodayData();
    // ... rest of midnight check logic
  }, []);
```

**Change To**:
```javascript
  useEffect(() => {
    fetchTodayData();
    fetchAnalytics(); // ✅ ADD THIS LINE
    // ... rest of midnight check logic
  }, []);
```

#### **3D. Update fetchCustomReport Call**

**Find This** (around line 180-220, look for button that says "Fetch Report" or similar):
```javascript
<button
  onClick={fetchCustomReport}
  className="..."
>
  Fetch Report
</button>
```

**Change the onClick Handler**:
```javascript
onClick={async () => {
  if (!fromDate || !toDate) {
    alert("Please select both dates");
    return;
  }
  await fetchCustomReport();
  // ✅ ADD THIS - fetch analytics for the same date range
  const params = {
    from: fromDate.toISOString().split("T")[0],
    to: toDate.toISOString().split("T")[0],
  };
  await fetchAnalytics(params);
}}
```

#### **3E. Add Chart Components to JSX**

**Find This** (look for closing div of the custom data section, around line 350-400):
```javascript
{view === "custom" && customData && (
  <div className="...">
    {/* existing custom view content */}
  </div>
)}
```

**Add After This Section**:

```javascript

{/* ============================================================
    ANALYTICS CHARTS SECTION (Today View)
============================================================ */}
{view === "today" && (
  <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-6">
    {/* AGE DISTRIBUTION HISTOGRAM */}
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">
        👥 Age Distribution
      </h3>
      {analyticsLoading ? (
        <p className="text-center text-gray-500">Loading...</p>
      ) : ageDistribution.length > 0 ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={ageDistribution}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="ageRange" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#0063dbff" />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-center text-gray-500">No data available</p>
      )}
    </div>

    {/* SOURCE CONTRIBUTION PIE */}
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">
        🌍 Source Contribution
      </h3>
      {analyticsLoading ? (
        <p className="text-center text-gray-500">Loading...</p>
      ) : sourceContribution.length > 0 ? (
        <div>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={sourceContribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percentage }) => `${name}: ${percentage}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {sourceContribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-4 text-sm text-gray-600">
            <p className="font-semibold">Breakdown:</p>
            {sourceContribution.map((item) => (
              <p key={item.name}>
                {item.name}: {item.value} ({item.percentage}%)
              </p>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-center text-gray-500">No data available</p>
      )}
    </div>

    {/* PLAN DISTRIBUTION PIE */}
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">
        📋 Plan Distribution
      </h3>
      {analyticsLoading ? (
        <p className="text-center text-gray-500">Loading...</p>
      ) : planDistribution.length > 0 ? (
        <div>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={planDistribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percentage }) => `${name}: ${percentage}%`}
                outerRadius={80}
                fill="#82ca9d"
                dataKey="value"
              >
                {planDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-4 text-sm text-gray-600">
            <p className="font-semibold">Breakdown:</p>
            {planDistribution.map((item) => (
              <p key={item.name}>
                {item.name}: {item.value} ({item.percentage}%)
              </p>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-center text-gray-500">No data available</p>
      )}
    </div>
  </div>
)}

{/* ============================================================
    ANALYTICS CHARTS SECTION (Custom Range View)
============================================================ */}
{view === "custom" && (
  <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-6">
    {/* AGE DISTRIBUTION HISTOGRAM */}
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">
        👥 Age Distribution
      </h3>
      {analyticsLoading ? (
        <p className="text-center text-gray-500">Loading...</p>
      ) : ageDistribution.length > 0 ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={ageDistribution}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="ageRange" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#0063dbff" />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-center text-gray-500">No data available</p>
      )}
    </div>

    {/* SOURCE CONTRIBUTION PIE */}
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">
        🌍 Source Contribution
      </h3>
      {analyticsLoading ? (
        <p className="text-center text-gray-500">Loading...</p>
      ) : sourceContribution.length > 0 ? (
        <div>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={sourceContribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percentage }) => `${name}: ${percentage}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {sourceContribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-4 text-sm text-gray-600">
            <p className="font-semibold">Breakdown:</p>
            {sourceContribution.map((item) => (
              <p key={item.name}>
                {item.name}: {item.value} ({item.percentage}%)
              </p>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-center text-gray-500">No data available</p>
      )}
    </div>

    {/* PLAN DISTRIBUTION PIE */}
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">
        📋 Plan Distribution
      </h3>
      {analyticsLoading ? (
        <p className="text-center text-gray-500">Loading...</p>
      ) : planDistribution.length > 0 ? (
        <div>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={planDistribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percentage }) => `${name}: ${percentage}%`}
                outerRadius={80}
                fill="#82ca9d"
                dataKey="value"
              >
                {planDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-4 text-sm text-gray-600">
            <p className="font-semibold">Breakdown:</p>
            {planDistribution.map((item) => (
              <p key={item.name}>
                {item.name}: {item.value} ({item.percentage}%)
              </p>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-center text-gray-500">No data available</p>
      )}
    </div>
  </div>
)}
```

---

## ✅ Testing the Implementation

### 1️⃣ Test Backend Endpoints

Open **PowerShell** and run:

```powershell
# Test Age Distribution (all members)
curl -X GET "http://localhost:5000/api/finance/analytics/age-distribution" `
  -Headers @{"Authorization"="Bearer YOUR_TOKEN"} `
  -ContentType "application/json"

# Test with date range
curl -X GET "http://localhost:5000/api/finance/analytics/age-distribution?from=2026-01-01&to=2026-03-02" `
  -Headers @{"Authorization"="Bearer YOUR_TOKEN"} `
  -ContentType "application/json"
```

Expected response:
```json
{
  "success": true,
  "data": [
    { "ageRange": "18-25", "count": 5 },
    ...
  ],
  "total": 25,
  "timestamp": "2026-03-02T..."
}
```

### 2️⃣ Test Frontend Integration

1. Navigate to Admin Dashboard
2. You should see 3 new charts in the "Today" view
3. Select a custom date range and click "Fetch Report"
4. Charts should update with filtered data

### 3️⃣ Check Performance

In **Browser DevTools** (F12):
1. Go to **Network** tab
2. Reload dashboard
3. Look for `/api/finance/analytics/*` requests
4. All should complete in **<300ms** (with indexes)

---

## 📋 Modification Checklist

**Mark as complete after each step:**

- [ ] **Member.js**: Added 6 indexes
- [ ] **financeRoutes.js**: Added 3 analytics endpoints
- [ ] **AdminDashboardHome.jsx - 3A**: Added state variables
- [ ] **AdminDashboardHome.jsx - 3B**: Added fetchAnalytics function
- [ ] **AdminDashboardHome.jsx - 3C**: Updated useEffect
- [ ] **AdminDashboardHome.jsx - 3D**: Updated button handler
- [ ] **AdminDashboardHome.jsx - 3E**: Added chart JSX components
- [ ] Test: Endpoints return data
- [ ] Test: Charts render in "Today" view
- [ ] Test: Charts update on custom date range

---

**Reference Documents:**
- 📘 Full guide: [ANALYTICS_CHARTS_IMPLEMENTATION_GUIDE.md](ANALYTICS_CHARTS_IMPLEMENTATION_GUIDE.md)
- 📊 API specs: See "Data Structure & Response Formats" section in main guide

