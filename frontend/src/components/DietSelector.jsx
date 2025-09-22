import { useEffect, useState } from "react";
import { API_BASE_URL } from "../utils/apiClient.js";

export const DietSelector = ({ trainingType, onDietSelect, initialDietId }) => {
  const [diets, setDiets] = useState([]);
  const [defaultDietId, setDefaultDietId] = useState(null);
  const [selectedDietId, setSelectedDietId] = useState(initialDietId);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSelectedDietId(initialDietId || null);
  }, [initialDietId]);

  useEffect(() => {
    fetchDiets();
  }, [trainingType]);

  const fetchDiets = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/diets`, {
        credentials: "include",
      });
      const data = await res.json();
      setDiets(data);

      if (trainingType) {
        const mapRes = await fetch(`${API_BASE_URL}/diets/mapping/${trainingType}`, {
          credentials: "include",
        });
        const mapData = await mapRes.json();
        if (mapData.diet) {
          setDefaultDietId(mapData.diet._id);
          setSelectedDietId((current) => current || initialDietId || mapData.diet._id);
        }
      } else {
        setDefaultDietId(null);
      }
    } catch (error) {
      console.error("Failed to fetch diets:", error);
    }
    setLoading(false);
  };

  useEffect(() => {
    const selectedDiet = diets.find((diet) => diet._id === selectedDietId);
    if (selectedDietId && selectedDiet) {
      onDietSelect(selectedDietId, selectedDiet.name, selectedDiet.description || "");
    } else {
      onDietSelect(null, null, "");
    }
  }, [selectedDietId, diets, onDietSelect]);

  return (
    <div className="panel" style={{ padding: "20px", background: "var(--surface-muted)" }}>
      <div className="section-stack" style={{ gap: "16px" }}>
        <div>
          <label className="field-label">Select Diet Plan</label>
          <p className="muted-copy mt-2">Choose the plan that should be included in the invoice.</p>
        </div>

        <select
          value={selectedDietId || ""}
          onChange={(e) => setSelectedDietId(e.target.value || null)}
          disabled={loading}
          className="field-control"
        >
          <option value="">No Diet Plan</option>
          {diets.map((diet) => (
            <option key={diet._id} value={diet._id}>
              {diet.name}
              {defaultDietId === diet._id ? " (Default)" : ""}
            </option>
          ))}
        </select>

        {selectedDietId && <p className="muted-copy">The selected diet will be attached to the member invoice.</p>}
      </div>
    </div>
  );
};
