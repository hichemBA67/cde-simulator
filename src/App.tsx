// App.tsx
import { useState } from "react";
import SimulationChart from "./SimulationChart";

export default function App() {
  const [params] = useState({
    staticThreshold: 0.02,
    cdeThreshold: 500,
    duration: 300,
  });

  return (
    <div className="p-4 space-y-4">
      <SimulationChart params={params} />
    </div>
  );
}
