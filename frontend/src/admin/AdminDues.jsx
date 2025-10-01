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
    <div className="section-stack">
      <section className="panel">
        <div className="section-heading">
          <span className="eyebrow">Renewal Radar</span>
          <h2 className="text-3xl">Due members</h2>
          <p className="panel-subtitle">Track expiring memberships and sort by urgency.</p>
        </div>

        <div className="mt-6 max-w-md">
          <input
            type="text"
            className="field-control"
            placeholder="Search by name or Gym ID"
            value={searchText}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
      </section>

      <section className="table-shell">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Gym ID</th>
                <th>Name</th>
                <th>Due Date</th>
                <th>Plan</th>
                <th onClick={sortByDaysLeft} className="cursor-pointer">
                  Days Left {sortAsc ? "Up" : "Down"}
                </th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((due) => (
                <tr key={due.gymId}>
                  <td>{due.gymId}</td>
                  <td>{due.name || due.fullName}</td>
                  <td>{formatDate(due.validityEnd || due.due)}</td>
                  <td>{due.gymPlan || due.plan}</td>
                  <td>
                    <span className={getDaysIndicatorClass(due.daysLeft)}>{due.daysLeft}</span>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan="5">
                    <div className="empty-state">No dues found.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex items-center justify-center gap-3">
        <button onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1} className="btn-secondary">
          Previous
        </button>
        <span className="chip">
          Page {currentPage} of {totalPages}
        </span>
        <button
          onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
          disabled={currentPage === totalPages}
          className="btn-secondary"
        >
          Next
        </button>
      </div>
    </div>
  );
}
