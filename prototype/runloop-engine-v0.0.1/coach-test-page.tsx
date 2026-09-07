import { analyzeAthlete } from "./engine";
import { mockAnalysisInput } from "./mock-data";

export default function CoachTestPage() {
  const analysis = analyzeAthlete(mockAnalysisInput);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#101413",
        color: "#f3f1e8",
        padding: "40px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "900px",
          margin: "0 auto",
        }}
      >
        <h1>RunLoop Analysis Engine Prototype</h1>

        <p
          style={{
            color: "#9aa5a0",
            marginBottom: "32px",
          }}
        >
          Deterministic coaching logic using mock athlete data.
        </p>

        <section
          style={{
            padding: "24px",
            border: "1px solid #2a3431",
            borderRadius: "16px",
            marginBottom: "24px",
          }}
        >
          <h2>Recommendation</h2>

          <h3>
            {analysis.recommendation.headline}
          </h3>

          <p>
            {analysis.recommendation.explanation}
          </p>

          <p>
            Confidence:{" "}
            {analysis.recommendation.confidence}
          </p>

          <ul>
            {analysis.recommendation.parameters.map(
              (parameter) => (
                <li key={parameter}>
                  {parameter}
                </li>
              )
            )}
          </ul>
        </section>

        <section
          style={{
            padding: "24px",
            border: "1px solid #2a3431",
            borderRadius: "16px",
            marginBottom: "24px",
          }}
        >
          <h2>Findings</h2>

          {analysis.findings.length === 0 ? (
            <p>No major findings.</p>
          ) : (
            analysis.findings.map((finding) => (
              <div
                key={finding.id}
                style={{
                  marginBottom: "24px",
                }}
              >
                <h3>{finding.title}</h3>

                <p>{finding.detail}</p>

                <p>
                  Confidence:{" "}
                  {finding.confidence}
                </p>

                <ul>
                  {finding.evidence.map(
                    (evidence) => (
                      <li key={evidence}>
                        {evidence}
                      </li>
                    )
                  )}
                </ul>
              </div>
            ))
          )}
        </section>

        <section
          style={{
            padding: "24px",
            border: "1px solid #2a3431",
            borderRadius: "16px",
            marginBottom: "24px",
          }}
        >
          <h2>Metric Trends</h2>

          {analysis.trends.length === 0 ? (
            <p>
              Not enough comparable data yet.
            </p>
          ) : (
            analysis.trends.map((trend) => (
              <div
                key={trend.metric}
                style={{
                  marginBottom: "20px",
                }}
              >
                <h3>{trend.metric}</h3>

                <p>
                  Direction: {trend.direction}
                </p>

                <p>{trend.explanation}</p>
              </div>
            ))
          )}
        </section>

        <section
          style={{
            padding: "24px",
            border: "1px solid #2a3431",
            borderRadius: "16px",
            marginBottom: "24px",
          }}
        >
          <h2>Missing Context</h2>

          {analysis.missingData.length === 0 ? (
            <p>
              No important missing context identified.
            </p>
          ) : (
            analysis.missingData.map((item) => (
              <div key={item.field}>
                <p>
                  <strong>{item.field}</strong>
                </p>

                <p>{item.reason}</p>
              </div>
            ))
          )}
        </section>

        <section
          style={{
            padding: "24px",
            border: "1px solid #2a3431",
            borderRadius: "16px",
          }}
        >
          <h2>Uncertainty</h2>

          <ul>
            {analysis.uncertainty.map(
              (statement) => (
                <li key={statement}>
                  {statement}
                </li>
              )
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
