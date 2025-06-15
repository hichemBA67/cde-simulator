import { useEffect, useState, useCallback } from "react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Scatter,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import type { SimulationParams } from "./types";
import { ethers } from "ethers";

// Chainlink BTC/USD price feed address on Ethereum mainnet
const CHAINLINK_BTC_USD_FEED = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";
const ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];

type PricePoint = {
  t: number;
  ref: number;
  oracle: number;
};

type TriggerPoint = {
  t: number;
  value: number;
};

type Props = {
  params: SimulationParams;
};

export default function SimulationChart({ params }: Props) {
  const [data, setData] = useState<PricePoint[]>([]);
  const [staticPoints, setStaticPoints] = useState<TriggerPoint[]>([]);
  const [refAreaLeft, setRefAreaLeft] = useState<string>("");
  const [refAreaRight, setRefAreaRight] = useState<string>("");
  const [left, setLeft] = useState<number | undefined>(undefined);
  const [right, setRight] = useState<number | undefined>(undefined);
  const [top, setTop] = useState<number | undefined>(undefined);
  const [bottom, setBottom] = useState<number | undefined>(undefined);
  const [chainlinkPrice, setChainlinkPrice] = useState<number | null>(null);
  const [currentCoinbasePrice, setCurrentCoinbasePrice] = useState<
    number | null
  >(null);
  const [cde, setCde] = useState<number>(0);
  const [adaptiveThresholds, setAdaptiveThresholds] = useState<
    { upper: number; lower: number }[]
  >([]);
  const [cdeValues, setCdeValues] = useState<number[]>([]);
  const [initialCde, setInitialCde] = useState<number>(1000);
  const [secondChartLeft, setSecondChartLeft] = useState<number | undefined>(
    undefined
  );
  const [secondChartRight, setSecondChartRight] = useState<number | undefined>(
    undefined
  );
  const [secondChartTop, setSecondChartTop] = useState<number | undefined>(
    undefined
  );
  const [secondChartBottom, setSecondChartBottom] = useState<
    number | undefined
  >(undefined);
  const [adaptiveOraclePrice, setAdaptiveOraclePrice] = useState<number | null>(
    null
  );

  const calculateCDE = useCallback((prices: PricePoint[]) => {
    if (prices.length < 2) return 0;

    let totalArea = 0;
    for (let i = 1; i < prices.length; i++) {
      const prev = prices[i - 1];
      const curr = prices[i];
      const timeDiff = curr.t - prev.t;
      const priceDiff = Math.abs(curr.ref - curr.oracle);
      totalArea += (priceDiff * timeDiff) / 1000; // Convert to seconds
    }
    return totalArea;
  }, []);

  const fetchChainlinkPrice = useCallback(async () => {
    try {
      const provider = new ethers.JsonRpcProvider("https://eth.llamarpc.com");
      const contract = new ethers.Contract(
        CHAINLINK_BTC_USD_FEED,
        ABI,
        provider
      );
      const { answer } = await contract.latestRoundData();
      // Chainlink price is in 8 decimals
      const price = Number(answer) / 1e8;
      setChainlinkPrice(price);
    } catch (error) {
      console.error("Error fetching Chainlink price:", error);
    }
  }, []);

  // Fetch Chainlink price every 30 seconds
  useEffect(() => {
    fetchChainlinkPrice();
    const interval = setInterval(fetchChainlinkPrice, 30000);
    return () => clearInterval(interval);
  }, [fetchChainlinkPrice]);

  const handleWebSocketMessage = useCallback(
    (message: MessageEvent) => {
      try {
        const parsedData = JSON.parse(message.data);
        if (parsedData.type === "ticker" && parsedData.price) {
          const price = parseFloat(parsedData.price);
          const timestamp = Date.now();
          setCurrentCoinbasePrice(price);

          setData((prevData) => {
            const newData = [
              ...prevData,
              {
                t: timestamp,
                ref: price,
                oracle: chainlinkPrice || price, // Use Chainlink price if available, fallback to Coinbase price
              },
            ];

            // Keep only the last 1000 points to prevent memory issues
            if (newData.length > 1000) {
              return newData.slice(-1000);
            }
            return newData;
          });

          // Update CDE
          setData((prevData) => {
            const newCde = calculateCDE(prevData);
            setCde(newCde);
            return prevData;
          });

          // Update trigger points based on the new price
          if (chainlinkPrice) {
            const deviation = Math.abs(chainlinkPrice - price) / price;
            if (deviation > params.staticThreshold) {
              setStaticPoints((prev) => [
                ...prev,
                { t: timestamp, value: price },
              ]);
            }
          }
        }
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
      }
    },
    [params.staticThreshold, chainlinkPrice, calculateCDE]
  );

  useEffect(() => {
    const ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");

    ws.onopen = () => {
      console.log("WebSocket Connected");
      ws.send(
        JSON.stringify({
          type: "subscribe",
          product_ids: ["BTC-USD"],
          channels: ["ticker"],
        })
      );
    };

    ws.onmessage = handleWebSocketMessage;

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("WebSocket Disconnected");
    };

    return () => {
      ws.close();
    };
  }, [handleWebSocketMessage]);

  const zoom = () => {
    if (refAreaLeft === refAreaRight || refAreaRight === "") {
      setRefAreaLeft("");
      setRefAreaRight("");
      return;
    }

    let leftNum = parseInt(refAreaLeft);
    let rightNum = parseInt(refAreaRight);
    if (leftNum > rightNum) {
      [leftNum, rightNum] = [rightNum, leftNum];
    }

    const selectedData = data.filter(
      (item) => item.t >= leftNum && item.t <= rightNum
    );
    const minValue = Math.min(
      ...selectedData.map((item) => Math.min(item.ref, item.oracle))
    );
    const maxValue = Math.max(
      ...selectedData.map((item) => Math.max(item.ref, item.oracle))
    );

    setLeft(leftNum);
    setRight(rightNum);
    setBottom(minValue);
    setTop(maxValue);
    setRefAreaLeft("");
    setRefAreaRight("");
  };

  const getDomain = () => {
    if (left === undefined || right === undefined) return undefined;
    return [left, right];
  };

  const getYDomain = () => {
    if (bottom === undefined || top === undefined) {
      // Add 2% padding to the min and max values
      const allPrices = data.map((item) => [item.ref, item.oracle]).flat();
      if (allPrices.length === 0) return undefined;
      const min = Math.min(...allPrices);
      const max = Math.max(...allPrices);
      const padding = (max - min) * 0.02; // 2% padding
      return [min - padding, max + padding];
    }
    return [bottom, top];
  };

  // Calculate thresholds for the current price
  const getThresholds = () => {
    if (!data.length) return { upper: 0, lower: 0 };
    const currentPrice = data[data.length - 1].oracle;
    const upper = currentPrice * (1 + 0.005);
    const lower = currentPrice * (1 - 0.005);
    console.log("Current price:", currentPrice);
    console.log("Upper threshold:", upper);
    console.log("Lower threshold:", lower);
    return { upper, lower };
  };

  const thresholds = getThresholds();

  // Add threshold data to the main dataset
  const dataWithThresholds = data.map((point) => ({
    ...point,
    upperThreshold: thresholds.upper,
    lowerThreshold: thresholds.lower,
  }));

  const getDeviationPercentage = () => {
    if (!currentCoinbasePrice || !chainlinkPrice) return 0;
    return (
      ((chainlinkPrice - currentCoinbasePrice) / currentCoinbasePrice) * 100
    );
  };

  const getDeviationValue = () => {
    if (!currentCoinbasePrice || !chainlinkPrice) return 0;
    return chainlinkPrice - currentCoinbasePrice;
  };

  // Calculate adaptive thresholds based on price volatility
  const calculateAdaptiveThresholds = useCallback((prices: PricePoint[]) => {
    if (prices.length < 2) return [];

    const thresholds = prices.map((point, index) => {
      if (index === 0)
        return { upper: point.oracle * 1.005, lower: point.oracle * 0.995 };

      // Calculate rolling standard deviation of the last 10 points
      const lookback = Math.min(10, index);
      const recentPrices = prices
        .slice(index - lookback, index + 1)
        .map((p) => p.oracle);
      const mean =
        recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
      const variance =
        recentPrices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
        recentPrices.length;
      const stdDev = Math.sqrt(variance);

      // Adjust threshold based on volatility
      const volatilityFactor = Math.min(0.01, stdDev / mean); // Cap at 1%
      return {
        upper: point.oracle * (1 + volatilityFactor),
        lower: point.oracle * (1 - volatilityFactor),
      };
    });

    return thresholds;
  }, []);

  // Update adaptive thresholds when data changes
  useEffect(() => {
    const newThresholds = calculateAdaptiveThresholds(data);
    setAdaptiveThresholds(newThresholds);
  }, [data, calculateAdaptiveThresholds]);

  // Calculate CDE values over time
  useEffect(() => {
    const newCdeValues = data.map((_, index) => {
      if (index < 2) return 0;
      return calculateCDE(data.slice(0, index + 1));
    });
    setCdeValues(newCdeValues);
  }, [data, calculateCDE]);

  // Update adaptive oracle price when thresholds are hit
  useEffect(() => {
    if (!data.length || !chainlinkPrice) return;

    const currentPoint = data[data.length - 1];
    const currentThresholds = adaptiveThresholds[adaptiveThresholds.length - 1];

    if (!currentThresholds) return;

    const deviation =
      Math.abs(currentPoint.ref - chainlinkPrice) / chainlinkPrice;
    const thresholdDeviation =
      Math.abs(currentThresholds.upper - currentThresholds.lower) /
      (2 * chainlinkPrice);

    if (deviation > thresholdDeviation) {
      setAdaptiveOraclePrice(currentPoint.ref);
    } else {
      setAdaptiveOraclePrice(chainlinkPrice);
    }
  }, [data, chainlinkPrice, adaptiveThresholds]);

  const zoomSecondChart = () => {
    if (secondChartLeft === undefined || secondChartRight === undefined) return;
    let leftNum = secondChartLeft;
    let rightNum = secondChartRight;
    if (leftNum > rightNum) {
      [leftNum, rightNum] = [rightNum, leftNum];
    }

    const selectedData = data.filter(
      (item) => item.t >= leftNum && item.t <= rightNum
    );
    const minValue = Math.min(
      ...selectedData.map((item) => Math.min(item.ref, item.oracle))
    );
    const maxValue = Math.max(
      ...selectedData.map((item) => Math.max(item.ref, item.oracle))
    );

    setSecondChartLeft(leftNum);
    setSecondChartRight(rightNum);
    setSecondChartBottom(minValue);
    setSecondChartTop(maxValue);
  };

  const getSecondChartDomain = () => {
    if (secondChartLeft === undefined || secondChartRight === undefined)
      return undefined;
    return [secondChartLeft, secondChartRight];
  };

  const getSecondChartYDomain = () => {
    if (secondChartBottom === undefined || secondChartTop === undefined) {
      const allPrices = data.map((item) => [item.ref, item.oracle]).flat();
      if (allPrices.length === 0) return undefined;
      const min = Math.min(...allPrices);
      const max = Math.max(...allPrices);
      const padding = (max - min) * 0.02;
      return [min - padding, max + padding];
    }
    return [secondChartBottom, secondChartTop];
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        position: "fixed",
        top: 0,
        left: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: "20px",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "20px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          background: "rgba(255, 255, 255, 0.9)",
          padding: "10px 20px",
          borderRadius: "8px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          display: "flex",
          gap: "20px",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontWeight: "bold" }}>CDE Controls</div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              onClick={() => {
                if (cdeValues.length === 0) return;
                const min = Math.min(...cdeValues);
                const max = Math.max(...cdeValues);
                const range = max - min;
                const newRange = range * 0.8; // Zoom in by 20%
                const center = (max + min) / 2;
                setSecondChartBottom(center - newRange / 2);
                setSecondChartTop(center + newRange / 2);
              }}
              style={{
                padding: "5px",
                background: "none",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M15.5 14H14.71L14.43 13.73C15.41 12.59 16 11.11 16 9.5C16 5.91 13.09 3 9.5 3C5.91 3 3 5.91 3 9.5C3 13.09 5.91 16 9.5 16C11.11 16 12.59 15.41 13.73 14.43L14 14.71V15.5L19 20.49L20.49 19L15.5 14ZM9.5 14C7.01 14 5 11.99 5 9.5C5 7.01 7.01 5 9.5 5C11.99 5 14 7.01 14 9.5C14 11.99 11.99 14 9.5 14Z"
                  fill="currentColor"
                />
                <path d="M12 9.5H7V10.5H12V9.5Z" fill="currentColor" />
                <path d="M9.5 7V12H10.5V7H9.5Z" fill="currentColor" />
              </svg>
            </button>
            <button
              onClick={() => {
                if (cdeValues.length === 0) return;
                const min = Math.min(...cdeValues);
                const max = Math.max(...cdeValues);
                const range = max - min;
                const newRange = range * 1.2; // Zoom out by 20%
                const center = (max + min) / 2;
                setSecondChartBottom(center - newRange / 2);
                setSecondChartTop(center + newRange / 2);
              }}
              style={{
                padding: "5px",
                background: "none",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M15.5 14H14.71L14.43 13.73C15.41 12.59 16 11.11 16 9.5C16 5.91 13.09 3 9.5 3C5.91 3 3 5.91 3 9.5C3 13.09 5.91 16 9.5 16C11.11 16 12.59 15.41 13.73 14.43L14 14.71V15.5L19 20.49L20.49 19L15.5 14ZM9.5 14C7.01 14 5 11.99 5 9.5C5 7.01 7.01 5 9.5 5C11.99 5 14 7.01 14 9.5C14 11.99 11.99 14 9.5 14Z"
                  fill="currentColor"
                />
                <path d="M7 9.5H12V10.5H7V9.5Z" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontWeight: "bold" }}>Current Values</div>
          <div>Current CDE: {cde.toFixed(2)} PE</div>
          <div>Deviation: {getDeviationPercentage().toFixed(2)}%</div>
          <div>
            Deviation Value: {getDeviationValue() > 0 ? "+" : ""}
            {getDeviationValue().toFixed(2)} USD
          </div>
        </div>
      </div>
      <div
        style={{
          width: "80%",
          height: "35%",
          maxWidth: "1200px",
        }}
      >
        <ResponsiveContainer>
          <LineChart
            data={dataWithThresholds}
            onMouseDown={(e) => e?.activeLabel && setRefAreaLeft(e.activeLabel)}
            onMouseMove={(e) =>
              refAreaLeft && e?.activeLabel && setRefAreaRight(e.activeLabel)
            }
            onMouseUp={zoom}
            margin={{ top: 20, right: 30, left: 50, bottom: 20 }}
          >
            <CartesianGrid stroke="#ccc" />
            <XAxis
              dataKey="t"
              allowDataOverflow
              domain={getDomain()}
              tickFormatter={(value) => new Date(value).toLocaleTimeString()}
            />
            <YAxis
              allowDataOverflow
              domain={getYDomain()}
              tickFormatter={(value) => `$${value.toLocaleString()}`}
            />
            <Tooltip
              labelFormatter={(value) => new Date(value).toLocaleString()}
              formatter={(value: number) => [`$${value.toLocaleString()}`, ""]}
            />
            <Legend />
            {/* Threshold bands */}
            <ReferenceArea
              y1={thresholds.lower}
              y2={thresholds.upper}
              fill="#ff4d4d"
              fillOpacity={0.2}
              stroke="none"
            />
            <Line
              type="monotone"
              dataKey="upperThreshold"
              stroke="#ff4d4d"
              dot={false}
              name="Upper Threshold"
              strokeWidth={3}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="lowerThreshold"
              stroke="#ffa64d"
              dot={false}
              name="Lower Threshold"
              strokeWidth={3}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="ref"
              stroke="#000000"
              name="Coinbase Price"
              strokeWidth={3}
            />
            <Line
              type="monotone"
              dataKey="oracle"
              stroke="#0066cc"
              name="Chainlink Price"
              strokeWidth={3}
            />
            <Scatter data={staticPoints} fill="red" name="Static Updates" />
            {refAreaLeft && refAreaRight ? (
              <ReferenceArea
                x1={refAreaLeft}
                x2={refAreaRight}
                strokeOpacity={0.3}
                fill="#8884d8"
                fillOpacity={0.3}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div
        style={{
          width: "80%",
          maxWidth: "1200px",
          background: "rgba(255, 255, 255, 0.9)",
          padding: "15px",
          borderRadius: "8px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          display: "flex",
          gap: "30px",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontWeight: "bold" }}>CDE Bounds</div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <label>Initial CDE:</label>
            <input
              type="number"
              value={initialCde}
              onChange={(e) => setInitialCde(Number(e.target.value))}
              style={{ width: "80px" }}
            />
            <span>PE</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontWeight: "bold" }}>Current Values</div>
          <div>Current CDE: {cde.toFixed(2)} PE</div>
          <div>Deviation: {getDeviationPercentage().toFixed(2)}%</div>
          <div>
            Deviation Value: {getDeviationValue() > 0 ? "+" : ""}
            {getDeviationValue().toFixed(2)} USD
          </div>
        </div>
      </div>
      <div
        style={{
          width: "80%",
          height: "35%",
          maxWidth: "1200px",
        }}
      >
        <ResponsiveContainer>
          <LineChart
            data={data.map((point) => ({
              ...point,
              oracle: adaptiveOraclePrice || point.oracle,
            }))}
            onMouseDown={(e) =>
              e?.activeLabel && setSecondChartLeft(Number(e.activeLabel))
            }
            onMouseMove={(e) =>
              secondChartLeft &&
              e?.activeLabel &&
              setSecondChartRight(Number(e.activeLabel))
            }
            onMouseUp={zoomSecondChart}
            margin={{ top: 20, right: 30, left: 50, bottom: 20 }}
          >
            <CartesianGrid stroke="#ccc" />
            <XAxis
              dataKey="t"
              allowDataOverflow
              domain={getSecondChartDomain()}
              tickFormatter={(value) => new Date(value).toLocaleTimeString()}
            />
            <YAxis
              allowDataOverflow
              domain={getSecondChartYDomain()}
              tickFormatter={(value) => `$${value.toLocaleString()}`}
            />
            <Tooltip
              labelFormatter={(value) => new Date(value).toLocaleString()}
              formatter={(value: number) => [`$${value.toLocaleString()}`, ""]}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="ref"
              stroke="#000000"
              name="Coinbase Price"
              strokeWidth={3}
            />
            <Line
              type="monotone"
              dataKey="oracle"
              stroke="#0066cc"
              name="Adaptive Oracle Price"
              strokeWidth={3}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div
        style={{
          display: "flex",
          gap: "10px",
          justifyContent: "center",
          marginTop: "10px",
          marginBottom: "30px",
        }}
      >
        <button
          onClick={() => {
            if (secondChartBottom === undefined || secondChartTop === undefined)
              return;
            const range = secondChartTop - secondChartBottom;
            const newRange = range * 0.8; // Zoom in by 20%
            const center = (secondChartTop + secondChartBottom) / 2;
            setSecondChartBottom(center - newRange / 2);
            setSecondChartTop(center + newRange / 2);
          }}
          style={{
            padding: "5px",
            background: "none",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M15.5 14H14.71L14.43 13.73C15.41 12.59 16 11.11 16 9.5C16 5.91 13.09 3 9.5 3C5.91 3 3 5.91 3 9.5C3 13.09 5.91 16 9.5 16C11.11 16 12.59 15.41 13.73 14.43L14 14.71V15.5L19 20.49L20.49 19L15.5 14ZM9.5 14C7.01 14 5 11.99 5 9.5C5 7.01 7.01 5 9.5 5C11.99 5 14 7.01 14 9.5C14 11.99 11.99 14 9.5 14Z"
              fill="currentColor"
            />
            <path d="M12 9.5H7V10.5H12V9.5Z" fill="currentColor" />
            <path d="M9.5 7V12H10.5V7H9.5Z" fill="currentColor" />
          </svg>
        </button>
        <button
          onClick={() => {
            if (
              secondChartBottom === undefined ||
              secondChartTop === undefined
            ) {
              // If not zoomed, zoom out from the current view
              const allPrices = data
                .map((item) => [item.ref, item.oracle])
                .flat();
              if (allPrices.length === 0) return;
              const min = Math.min(...allPrices);
              const max = Math.max(...allPrices);
              const range = max - min;
              const padding = range * 0.1; // 10% padding
              setSecondChartBottom(min - padding);
              setSecondChartTop(max + padding);
            } else {
              // If already zoomed, zoom out by 20%
              const range = secondChartTop - secondChartBottom;
              const newRange = range * 1.2; // Zoom out by 20%
              const center = (secondChartTop + secondChartBottom) / 2;
              setSecondChartBottom(center - newRange / 2);
              setSecondChartTop(center + newRange / 2);
            }
          }}
          style={{
            padding: "5px",
            background: "none",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M15.5 14H14.71L14.43 13.73C15.41 12.59 16 11.11 16 9.5C16 5.91 13.09 3 9.5 3C5.91 3 3 5.91 3 9.5C3 13.09 5.91 16 9.5 16C11.11 16 12.59 15.41 13.73 14.43L14 14.71V15.5L19 20.49L20.49 19L15.5 14ZM9.5 14C7.01 14 5 11.99 5 9.5C5 7.01 7.01 5 9.5 5C11.99 5 14 7.01 14 9.5C14 11.99 11.99 14 9.5 14Z"
              fill="currentColor"
            />
            <path d="M7 9.5H12V10.5H7V9.5Z" fill="currentColor" />
          </svg>
        </button>
      </div>
      <div
        style={{
          width: "80%",
          height: "35%",
          maxWidth: "1200px",
          marginTop: "30px",
        }}
      >
        <ResponsiveContainer>
          <LineChart
            data={data.map((point, index) => ({
              t: point.t,
              cde: cdeValues[index],
            }))}
            margin={{ top: 20, right: 30, left: 50, bottom: 20 }}
          >
            <CartesianGrid stroke="#ccc" />
            <XAxis
              dataKey="t"
              allowDataOverflow
              tickFormatter={(value) => new Date(value).toLocaleTimeString()}
            />
            <YAxis
              allowDataOverflow
              tickFormatter={(value) => `${value.toFixed(2)} PE`}
            />
            <Tooltip
              labelFormatter={(value) => new Date(value).toLocaleString()}
              formatter={(value: number) => [`${value.toFixed(2)} PE`, "CDE"]}
            />
            <Legend />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
