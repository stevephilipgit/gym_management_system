import { useEffect, useRef, useState } from "react";
import apiClient from "../utils/apiClient.js";
import { getDaysRemaining, getDaysIndicatorClass } from "../utils/memberStatus.js";

export default function AdminDues() {
  const [dues, setDues] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const recordsPerPage = 10;
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    apiClient
      .get("/members/due/list", {
        params: {
          days: 3650,
          includeExpired: true,
          includeDraft: true,
        },
      })
      .then((res) => {
        const rawList = res.data?.data || res.data || [];
        const normalized = rawList.map((due) => ({
          ...due,
          daysLeft: getDaysRemaining(due.validityEnd || due.due),
        }));
        setDues(normalized);
        setFiltered(normalized);
      })
      .catch((err) => console.log("DUES ERROR:", err));
  }, []);

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-GB");
  };

  const handleSearch = (value) => {
    setSearchText(value);
    const filteredData = dues.filter(
      (d) => (d.name || d.fullName || "").toLowerCase().includes(value.toLowerCase()) || String(d.gymId).includes(value)
    );
    setFiltered(filteredData);
    setCurrentPage(1);
  };

  const sortByDaysLeft = () => {
    const sorted = [...filtered].sort((a, b) => (sortAsc ? a.daysLeft - b.daysLeft : b.daysLeft - a.daysLeft));
    setFiltered(sorted);
    setSortAsc(!sortAsc);
  };

  const lastIndex = currentPage * recordsPerPage;
  const firstIndex = lastIndex - recordsPerPage;
  const paginated = filtered.slice(firstIndex, lastIndex);
  const totalPages = Math.ceil(filtered.length / recordsPerPage) || 1;

  return (
    <div className="saas-container">
      <div className="saas-header">
        <h1>Due members</h1>
        <p>Track expiring memberships and sort by urgency.</p>
      </div>

      <div className="saas-filter-bar">
        <input
          type="text"
          className="saas-input"
          style={{ flex: '1 1 300px' }}
          placeholder="Search by name or Gym ID"
          value={searchText}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      <div className="saas-table-container">
        <table className="saas-table">
          <thead>
            <tr>
              <th>Gym ID</th>
              <th>Name</th>
              <th>Due Date</th>
              <th>Plan</th>
              <th onClick={sortByDaysLeft} style={{ cursor: 'pointer' }}>
                Days Left {sortAsc ? "↑" : "↓"}
              </th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((due) => (
              <tr key={due.gymId}>
                <td>{due.gymId}</td>
                <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{due.name || due.fullName}</td>
                <td>{formatDate(due.validityEnd || due.due)}</td>
                <td>{due.gymPlan || due.plan}</td>
                <td>
                  <span className={getDaysIndicatorClass(due.daysLeft)}>{due.daysLeft}</span>
                </td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                  No dues found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '24px' }}>
        <button onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1} className="btn-secondary" style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.5 : 1 }}>
          Previous
        </button>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>
          Page {currentPage} of {totalPages}
        </span>
        <button
          onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
          disabled={currentPage === totalPages}
          className="btn-secondary"
          style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', opacity: currentPage === totalPages ? 0.5 : 1 }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
