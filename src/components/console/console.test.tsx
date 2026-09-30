import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HandoffDeliveryStatus,
  HandoffTimeline,
  HealthCard,
  MetricCard,
  StatusBadge,
  StatusDot,
  statusTone,
  DataTable,
} from "./index";

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("console primitives — status tone mapping", () => {
  it("maps delivery/acceptance outcomes onto the success tone", () => {
    expect(statusTone("DELIVERED")).toBe("success");
    expect(statusTone("ACCEPTED")).toBe("success");
    expect(statusTone("VALIDATED")).toBe("success");
    expect(statusTone("HEALTHY")).toBe("success");
  });

  it("maps failed/refused outcomes onto the danger tone", () => {
    expect(statusTone("ADAPTATION_REFUSED")).toBe("danger");
    expect(statusTone("REJECTED")).toBe("danger");
    expect(statusTone("FAILED")).toBe("danger");
    expect(statusTone("AUTH_REJECTED")).toBe("danger");
  });

  it("never paints NOT_CONFIGURED or unknown statuses as healthy", () => {
    expect(statusTone("NOT_CONFIGURED")).toBe("neutral");
    expect(statusTone("UNKNOWN")).toBe("neutral");
    expect(statusTone("SOME_FUTURE_STATUS")).toBe("neutral");
    expect(statusTone(null)).toBe("neutral");
  });

  it("renders the raw status text verbatim", () => {
    const markup = html(<StatusBadge status="ADAPTATION_REFUSED" />);
    expect(markup).toContain("ADAPTATION_REFUSED");
    expect(markup).toContain("bg-red-100");
  });
});

describe("console primitives — handoff delivery status", () => {
  it("derives DUPLICATE from DELIVERED + duplicate flag", () => {
    const markup = html(<HandoffDeliveryStatus status="DELIVERED" duplicate />);
    expect(markup).toContain("DUPLICATE");
    expect(markup).not.toContain("&gt;DELIVERED&lt;");
  });

  it("shows DELIVERED without the duplicate flag as success", () => {
    const markup = html(<HandoffDeliveryStatus status="DELIVERED" duplicate={false} />);
    expect(markup).toContain("DELIVERED");
    expect(markup).toContain("bg-emerald-100");
  });

  it("renders the refused error code alongside the status", () => {
    const markup = html(<HandoffDeliveryStatus status="REJECTED" lastErrorCode="ADAPTATION_REFUSED" />);
    expect(markup).toContain("REJECTED");
    expect(markup).toContain("ADAPTATION_REFUSED");
  });
});

describe("console primitives — handoff lifecycle timeline", () => {
  it("renders every lifecycle stage with its persisted state", () => {
    const markup = html(
      <HandoffTimeline
        steps={[
          { name: "Opportunity", status: "READY", detail: "opp-1" },
          { name: "Eligibility", status: "VALIDATED" },
          { name: "Adapter", status: "ADAPTATION_REFUSED", detail: "nothing was sent", current: true },
          { name: "Transport", status: "NOT_CONFIGURED" },
          { name: "AI Income Lab Receiver", status: null },
          { name: "Job Run", status: null },
        ]}
      />,
    );
    for (const stage of ["Opportunity", "Eligibility", "Adapter", "Transport", "AI Income Lab Receiver", "Job Run"]) {
      expect(markup).toContain(stage);
    }
    expect(markup).toContain("ADAPTATION_REFUSED");
    expect(markup).toContain("NOT_CONFIGURED");
  });
});

describe("console primitives — data table states", () => {
  interface Row {
    id: string;
    name: string;
  }

  const columns = [{ key: "name", header: "Name", render: (row: Row) => row.name }];

  it("renders headers and rows", () => {
    const markup = html(
      <DataTable
        columns={columns}
        rows={[
          { id: "a", name: "Alpha" },
          { id: "b", name: "Beta" },
        ]}
        rowKey={(row) => row.id}
      />,
    );
    expect(markup).toContain("Name");
    expect(markup).toContain("Alpha");
    expect(markup).toContain("Beta");
  });

  it("renders the empty state when there are no rows", () => {
    const markup = html(<DataTable columns={columns} rows={[]} rowKey={(row) => row.id} />);
    expect(markup).toContain("Nothing here yet");
  });

  it("renders a custom empty state", () => {
    const markup = html(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        empty={<div>NO_DELIVERIES_RECORDED</div>}
      />,
    );
    expect(markup).toContain("NO_DELIVERIES_RECORDED");
  });

  it("renders the loading state", () => {
    const markup = html(<DataTable columns={columns} rows={[]} rowKey={(row) => row.id} loading />);
    expect(markup).toContain("Loading");
  });

  it("renders the error state with retry", () => {
    const markup = html(
      <DataTable columns={columns} rows={[]} rowKey={(row) => row.id} error="DATABASE_URL is not configured" />,
    );
    expect(markup).toContain("DATABASE_URL is not configured");
  });
});

describe("console primitives — health and metrics", () => {
  it("renders NOT_CONFIGURED health honestly with its message", () => {
    const markup = html(
      <HealthCard name="AI Income Lab connectivity" status="NOT_CONFIGURED" message="Endpoint and credential are not set." />,
    );
    expect(markup).toContain("AI Income Lab connectivity");
    expect(markup).toContain("NOT_CONFIGURED");
    expect(markup).toContain("Endpoint and credential are not set.");
    expect(markup).not.toContain("bg-emerald-100");
  });

  it("renders Data unavailable for a metric with no value", () => {
    const markup = html(<MetricCard label="Research runs" value={null} />);
    expect(markup).toContain("Data unavailable");
    expect(markup).toContain("Research runs");
  });

  it("renders the given value without reformatting it", () => {
    const markup = html(<MetricCard label="Handoffs accepted" value="7" hint="Human-accepted" />);
    expect(markup).toContain("7");
    expect(markup).toContain("Human-accepted");
  });

  it("status dot renders compact status labels", () => {
    const markup = html(<StatusDot status="RUNNING" label="Brave" />);
    expect(markup).toContain("Brave");
    expect(markup).toContain("bg-sky-500");
  });
});
