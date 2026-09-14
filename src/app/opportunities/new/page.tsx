"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { opportunityRepository } from "@/lib/repositories";
import { calculateOverallScore } from "@/lib/scoring";
import type { Category, BusinessModel, HalalStatus, OpportunityStatus } from "@/lib/types";
import { Card, Button } from "@/components/ui";

export default function NewOpportunityPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    title: "",
    category: "" as Category | "",
    businessModel: "" as BusinessModel | "",
    targetAudience: "",
    problemSolved: "",
    monetizationMethod: "",
    estimatedStartupCost: 100,
    demandScore: 50,
    competitionScore: 50,
    commercialIntentScore: 50,
    automationScore: 50,
    differentiationScore: 50,
    monetizationStrengthScore: 50,
    halalScore: 90,
    halalStatus: "HALAL" as HalalStatus,
    status: "IDEA" as OpportunityStatus,
    evidence: [] as string[],
    risks: [] as string[],
    nextAction: "",
  });

  // Calculate current score preview
  const currentScore = formData.category && formData.businessModel ? calculateOverallScore({
    demand: formData.demandScore,
    commercialIntent: formData.commercialIntentScore,
    competitionOpportunity: 100 - formData.competitionScore,
    startupCost: Math.max(0, 100 - formData.estimatedStartupCost / 2),
    automationPotential: formData.automationScore,
    differentiation: formData.differentiationScore,
    monetizationStrength: formData.monetizationStrengthScore,
    halalCompliance: formData.halalScore,
  }) : 0;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name.includes("Score") || name === "estimatedStartupCost" ? Number(value) : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.title || !formData.category || !formData.businessModel) {
      alert("Please fill in all required fields");
      return;
    }

    setSaving(true);
    
    try {
      // Calculate overall score using the scoring engine
      const overallScore = calculateOverallScore({
        demand: formData.demandScore,
        commercialIntent: formData.commercialIntentScore,
        competitionOpportunity: formData.competitionScore,
        startupCost: 100 - formData.estimatedStartupCost / 1000 * 100, // Normalize startup cost (lower cost = higher score)
        automationPotential: formData.automationScore,
        differentiation: formData.differentiationScore,
        monetizationStrength: formData.monetizationStrengthScore,
        halalCompliance: formData.halalScore,
      });

      await opportunityRepository.create({
        title: formData.title,
        category: formData.category as Category,
        businessModel: formData.businessModel as BusinessModel,
        targetAudience: formData.targetAudience,
        problemSolved: formData.problemSolved,
        monetizationMethod: formData.monetizationMethod,
        estimatedStartupCost: formData.estimatedStartupCost,
        demandScore: formData.demandScore,
        competitionScore: formData.competitionScore,
        commercialIntentScore: formData.commercialIntentScore,
        automationScore: formData.automationScore,
        differentiationScore: formData.differentiationScore,
        monetizationStrengthScore: formData.monetizationStrengthScore,
        halalScore: formData.halalScore,
        halalStatus: formData.halalStatus,
        status: formData.status,
        evidence: formData.evidence,
        risks: formData.risks,
        nextAction: formData.nextAction,
        confidence: 50,
        overallScore,
      });
      
      router.push("/opportunities");
    } catch (error) {
      console.error("Failed to create opportunity:", error);
      alert("Failed to create opportunity. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const categories: Category[] = [
    "CHILDRENS_BOOKS", "EDUCATIONAL_RESOURCES", "TEACHER_RESOURCES", 
    "PRINTABLES", "AFFILIATE", "DIGITAL_TOOLS", "SAAS"
  ];
  
  const businessModels: BusinessModel[] = [
    "DIGITAL_PRODUCT", "AFFILIATE", "SAAS", "PRINTABLE", 
    "EDUCATIONAL", "MARKETPLACE"
  ];

  const statuses: OpportunityStatus[] = [
    "IDEA", "RESEARCHING", "VALIDATING", "VALIDATED", "BUILDING", 
    "PUBLISHED", "EARNING", "SCALING", "PAUSED", "REJECTED"
  ];

  const halalStatuses: HalalStatus[] = ["HALAL", "REVIEW_REQUIRED", "NOT_ALLOWED"];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/opportunities">
          <Button variant="secondary">← Back</Button>
        </Link>
        <h1 className="text-2xl font-bold">Create New Opportunity</h1>
      </div>

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Basic Information</h2>
            
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1">Title *</label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleChange}
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Category *</label>
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                  required
                >
                  <option value="">Select category</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1">Business Model *</label>
                <select
                  name="businessModel"
                  value={formData.businessModel}
                  onChange={handleChange}
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                  required
                >
                  <option value="">Select business model</option>
                  {businessModels.map(model => (
                    <option key={model} value={model}>{model.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Status</label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                >
                  {statuses.map(status => (
                    <option key={status} value={status}>{status.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Target Audience</label>
              <textarea
                name="targetAudience"
                value={formData.targetAudience}
                onChange={handleChange}
                className="w-full rounded-md border border-slate-200 px-3 py-2"
                rows={2}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Problem Solved</label>
              <textarea
                name="problemSolved"
                value={formData.problemSolved}
                onChange={handleChange}
                className="w-full rounded-md border border-slate-200 px-3 py-2"
                rows={2}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Monetization Method</label>
              <textarea
                name="monetizationMethod"
                value={formData.monetizationMethod}
                onChange={handleChange}
                className="w-full rounded-md border border-slate-200 px-3 py-2"
                rows={2}
              />
            </div>
          </div>

          {/* Financial & Scoring */}
          <div className="space-y-4 border-t pt-6">
            <h2 className="text-lg font-semibold">Financial & Scoring</h2>
            
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium mb-1">Est. Startup Cost ($)</label>
                <input
                  type="number"
                  name="estimatedStartupCost"
                  value={formData.estimatedStartupCost}
                  onChange={handleChange}
                  min="0"
                  max="10000"
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Halal Status</label>
                <select
                  name="halalStatus"
                  value={formData.halalStatus}
                  onChange={handleChange}
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                >
                  {halalStatuses.map(status => (
                    <option key={status} value={status}>{status.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>

              <div className="bg-slate-50 rounded-md p-4 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600">{currentScore.toFixed(1)}</div>
                  <div className="text-xs text-slate-500">Live Overall Score</div>
                </div>
              </div>
            </div>

            {/* Score sliders */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="block text-sm font-medium mb-1">Demand Score ({formData.demandScore})</label>
                <input
                  type="range"
                  name="demandScore"
                  value={formData.demandScore}
                  onChange={handleChange}
                  min="0"
                  max="100"
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Competition Score ({formData.competitionScore})</label>
                <input
                  type="range"
                  name="competitionScore"
                  value={formData.competitionScore}
                  onChange={handleChange}
                  min="0"
                  max="100"
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Commercial Intent ({formData.commercialIntentScore})</label>
                <input
                  type="range"
                  name="commercialIntentScore"
                  value={formData.commercialIntentScore}
                  onChange={handleChange}
                  min="0"
                  max="100"
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Automation Potential ({formData.automationScore})</label>
                <input
                  type="range"
                  name="automationScore"
                  value={formData.automationScore}
                  onChange={handleChange}
                  min="0"
                  max="100"
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Differentiation ({formData.differentiationScore})</label>
                <input
                  type="range"
                  name="differentiationScore"
                  value={formData.differentiationScore}
                  onChange={handleChange}
                  min="0"
                  max="100"
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Monetization Strength ({formData.monetizationStrengthScore})</label>
                <input
                  type="range"
                  name="monetizationStrengthScore"
                  value={formData.monetizationStrengthScore}
                  onChange={handleChange}
                  min="0"
                  max="100"
                  className="w-full"
                />
              </div>
            </div>
          </div>

          {/* Validation fields */}
          <div className="space-y-4 border-t pt-6">
            <h2 className="text-lg font-semibold">Validation Information</h2>
            
            <div>
              <label className="block text-sm font-medium mb-1">Next Action</label>
              <input
                type="text"
                name="nextAction"
                value={formData.nextAction}
                onChange={handleChange}
                className="w-full rounded-md border border-slate-200 px-3 py-2"
                placeholder="What's the next step to validate this opportunity?"
              />
            </div>
          </div>

          <div className="flex gap-4 pt-4 border-t">
            <Button type="submit" disabled={saving}>
              {saving ? "Creating..." : "Create Opportunity"}
            </Button>
            <Link href="/opportunities">
              <Button variant="secondary" type="button">Cancel</Button>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}