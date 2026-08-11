import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import apiClient from "../utils/apiClient.js";
import RegisterForm from "./components/forms/RegisterForm";

export default function AdminUpdate() {
  const [gymId, setGymId] = useState("");
  const [memberData, setMemberData] = useState(null);
  const [loading, setLoading] = useState(false);
  const location = useLocation();

  const normalizeGymId = (value) => value.replace(/\D/g, "");

  const fetchMemberByGymId = async (normalizedGymId) => {
    if (!normalizedGymId) return;

    try {
      setLoading(true);
      const res = await apiClient.get(`/members/${normalizedGymId}`);
      setMemberData(res.data?.data || res.data || null);
      setGymId(normalizedGymId);
    } catch (err) {
      alert("Member not found or unauthorized");
      setMemberData(null);
    } finally {
      setLoading(false);
    }
  };

  const searchMember = async () => {
    const normalizedGymId = normalizeGymId(gymId);
    if (!normalizedGymId) return alert("Please enter a valid Gym ID");
    await fetchMemberByGymId(normalizedGymId);
  };

  const updateMember = async (updated) => {
    const normalizedGymId = normalizeGymId(gymId);
    if (!normalizedGymId) return alert("Invalid Gym ID");

    try {
      const fd = new FormData();
      Object.keys(updated).forEach((key) => {
        if (key !== "photo" && key !== "customFields") {
          fd.append(key, updated[key]);
        }
      });

      if (updated.photo instanceof File) {
        fd.append("photo", updated.photo);
      }
      fd.append("customFields", JSON.stringify(updated.customFields || {}));

      await apiClient.put(`/members/${normalizedGymId}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      alert("Member updated successfully");
      setMemberData(null);
      setGymId("");
    } catch (err) {
      alert("Update failed");
      console.log("Update Error:", err);
    }
  };

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const gymIdQuery = normalizeGymId(searchParams.get("gymId") || "");
    if (gymIdQuery) {
      fetchMemberByGymId(gymIdQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  return (
    <div className="saas-container">
      <div className="saas-header">
        <h1>Update member details</h1>
        <p>Search by Gym ID and then edit the stored member profile.</p>
      </div>

      <div className="saas-filter-bar">
        <input
          type="text"
          value={gymId}
          onChange={(e) => setGymId(normalizeGymId(e.target.value))}
          placeholder="Enter Gym ID"
          className="saas-input"
          style={{ flex: '1 1 300px' }}
        />

        <button onClick={searchMember} disabled={loading} className="btn-primary" style={{ padding: '8px 24px', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: '#000', fontWeight: 600, cursor: 'pointer' }}>
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {memberData && (
        <div style={{ marginTop: '24px' }}>
          <RegisterForm defaultData={memberData} onSubmit={updateMember} buttonLabel="Save Changes" />
        </div>
      )}
    </div>
  );
}
