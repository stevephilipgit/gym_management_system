import { useState } from "react";
import apiClient from "../utils/apiClient.js";
import RegisterForm from "./components/RegisterForm";

export default function AdminUpdate() {
  const [gymId, setGymId] = useState("");
  const [memberData, setMemberData] = useState(null);
  const [loading, setLoading] = useState(false);

  const normalizeGymId = (value) => value.replace(/\D/g, "");

  const searchMember = async () => {
    const normalizedGymId = normalizeGymId(gymId);
    if (!normalizedGymId) return alert("Please enter a valid Gym ID");

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

  return (
    <div className="section-stack">
      <section className="panel">
        <div className="section-heading">
          <span className="eyebrow">Update Workspace</span>
          <h2 className="text-3xl">Update member details</h2>
          <p className="panel-subtitle">Search by Gym ID and then edit the stored member profile.</p>
        </div>

        <div className="mt-6 flex flex-col gap-4 sm:flex-row">
          <input
            type="text"
            value={gymId}
            onChange={(e) => setGymId(normalizeGymId(e.target.value))}
            placeholder="Enter Gym ID"
            className="field-control sm:max-w-xs"
          />

          <button onClick={searchMember} disabled={loading} className="btn-primary sm:w-auto">
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </section>

      {memberData && <RegisterForm defaultData={memberData} onSubmit={updateMember} buttonLabel="Save Changes" />}
    </div>
  );
}
