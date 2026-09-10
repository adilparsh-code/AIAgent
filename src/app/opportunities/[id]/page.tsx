import Link from "next/link";
import { notFound } from "next/navigation";
import { SAMPLE_OPPORTUNITIES } from "@/lib/data";
import { getScoreContributions } from "@/lib/scoring";
import { Badge, Card, CardHeader, ScoreBar, statusBadgeClass } from "@/components/ui";

export default function OpportunityDetailPage({ params }: { params: { id: string } }) {
  const opp = SAMPLE_OPPORTUNITIES.find((o) => o.id === params.id);
  if (!opp) return notFound();

  const breakdown = {
    demand: opp.demandScore,
    commercialIntent: opp.commercialIntentScore,
    competitionOpportunity: 100 - opp.competitionScore,
    startupCost: Math.max(0, 100 - opp.estimatedStartupCost / 2),
    automationPotential: opp.automationScore,
    differentiation: opp.differentiationScore,
    monetizationStrength: opp.monetizationStrengthScore,
    halalCompliance: opp.halalScore,
  };
  const parts = getScoreContributions(breakdown);

  return (
    <div className="space-y-4">
      <Link href="/opportunities" className="text-sm text-blue-600">← Back to opportunities</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{opp.title}</h1>
        <Badge className={statusBadgeClass(opp.status)}>{opp.status}</Badge>
        <Badge className={statusBadgeClass(opp.halalStatus)}>{opp.halalStatus}</Badge>
        <Badge className="bg-slate-100 text-slate-700">SAMPLE DATA</Badge>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Overview" />
          <div className="space-y-2 p-5 text-sm">
            <p><strong>Audience:</strong> {opp.targetAudience}</p>
            <p><strong>Problem:</strong> {opp.problemSolved}</p>
            <p><strong>Monetization:</strong> {opp.monetizationMethod}</p>
            <p><strong>Next action:</strong> {opp.nextAction}</p>
          </div>
        </Card>
        <Card>
          <CardHeader title={`Score breakdown — ${opp.overallScore.toFixed(1)}/100`} subtitle="Weights: Demand 20%, Commercial Intent 20%, Competition 15%, Cost 10%, Automation 10%, Differentiation 10%, Monetization 10%, Halal 5%" />
          <ul className="space-y-2 p-5">
            {parts.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-3 text-sm">
                <span>{p.label} · {Math.round(p.weight * 100)}%</span>
                <ScoreBar value={p.rawScore} />
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Evidence and risks" subtitle="SAMPLE / AI ESTIMATE — verify before spending money" />
          <div className="grid gap-4 p-5 text-sm md:grid-cols-2">
            <ul className="list-disc space-y-1 pl-5">{opp.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
            <ul className="list-disc space-y-1 pl-5">{opp.risks.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        </Card>
        <Card>
          <CardHeader title="Halal status" />
          <p className="p-5 text-sm text-slate-600">
            {opp.halalStatus === "REVIEW_REQUIRED"
              ? "REVIEW_REQUIRED means a human must review this model before launch. Automated screening is not a religious ruling."
              : "Automated screening is only a first filter. Confirm compliance manually before launch."}
          </p>
        </Card>
      </div>
    </div>
  );
}
