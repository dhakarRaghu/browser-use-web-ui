"use client";

import { useState, useEffect, useRef } from "react";

interface StepData {
  step: number;
  thought: string;
  actions: { [key: string]: any }[];
  screenshot?: string;
}

interface DoneData {
  status: "done";
  result: string;
}

interface ErrorData {
  status: "error";
  message: string;
}

export default function Home() {
  const [task, setTask] = useState(
    "Navigate to https://www.google.com, input 'Python' into the search bar, wait 5 seconds, click the first search result link using a CSS selector like 'h3' within 'a', wait 5 seconds, then extract all text content from the page."
  );
  const [logs, setLogs] = useState<string[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    wsRef.current = new WebSocket("ws://localhost:8000/ws");
    const ws = wsRef.current;

    ws.onopen = () => console.log("WebSocket connected");
    ws.onmessage = (event: MessageEvent) => {
      const data: StepData | DoneData | ErrorData = JSON.parse(event.data);
      if ("status" in data) {
        if (data.status === "done") {
          setResult(data.result);
          setIsLoading(false);
        } else if (data.status === "error") {
          setError(data.message);
          setIsLoading(false);
        }
      } else {
        const stepData = data as StepData;
        setLogs((prev) => [...prev, `Step ${stepData.step}: ${stepData.thought}`]);
        if (stepData.screenshot) {
          setScreenshot(`data:image/png;base64,${stepData.screenshot}`);
        }
      }
    };
    ws.onerror = (error) => console.error("WebSocket error:", error);
    ws.onclose = () => console.log("WebSocket closed");

    return () => ws.close();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task || isLoading) return;

    setLogs([]);
    setScreenshot(null);
    setResult("");
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("http://localhost:8000/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
      if (!response.ok) throw new Error("Failed to start task");
      const data = await response.json();
      console.log(data);
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  const handleStop = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send("stop");
    }
  };

  return (
    <div style={{ padding: "20px", fontFamily: "Arial", maxWidth: "800px", margin: "0 auto" }}>
      <h1>Browser Automation</h1>
      <p style={{ color: "orange" }}>
        Please ensure your default browser (e.g., Chrome) is running with remote debugging enabled. Run it with: <br />
        <code>chrome --remote-debugging-port=9222</code> (Windows: adjust path to chrome.exe)
      </p>
      <form onSubmit={handleSubmit} style={{ marginBottom: "20px" }}>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Enter your task..."
          rows={4}
          style={{ width: "100%", marginBottom: "10px", padding: "8px" }}
          disabled={isLoading}
        />
        <div>
          <button
            type="submit"
            disabled={isLoading}
            style={{
              padding: "10px 20px",
              backgroundColor: isLoading ? "#ccc" : "#0070f3",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: isLoading ? "not-allowed" : "pointer",
              marginRight: "10px",
            }}
          >
            {isLoading ? "Running..." : "Run Task"}
          </button>
          <button
            type="button"
            onClick={handleStop}
            disabled={!isLoading}
            style={{
              padding: "10px 20px",
              backgroundColor: !isLoading ? "#ccc" : "#ff4444",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: !isLoading ? "not-allowed" : "pointer",
            }}
          >
            Stop
          </button>
        </div>
      </form>

      <div>
        <h2>Live Updates</h2>
        {logs.length > 0 ? (
          <ul style={{ listStyleType: "none", padding: 0 }}>
            {logs.map((log, index) => (
              <li key={index} style={{ marginBottom: "5px" }}>{log}</li>
            ))}
          </ul>
        ) : (
          <p>No updates yet...</p>
        )}
        {screenshot && (
          <img
            src={screenshot}
            alt="Browser screenshot"
            style={{ maxWidth: "100%", marginTop: "10px", border: "1px solid #ccc" }}
          />
        )}
      </div>

      {error && (
        <div style={{ marginTop: "20px", color: "red" }}>
          <h2>Error</h2>
          <p>{error}</p>
        </div>
      )}

      {result && (
        <div style={{ marginTop: "20px" }}>
          <h2>Result</h2>
          <pre style={{ backgroundColor: "#f5f5f5", padding: "10px", borderRadius: "5px" }}>
            {result}
          </pre>
        </div>
      )}
    </div>
  );
}