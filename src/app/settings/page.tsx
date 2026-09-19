import { Card, CardHeader } from "@/components/ui";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Card>
        <CardHeader title="Environment" subtitle="Secrets belong in environment variables, never in code" />
        <ul className="list-disc space-y-1 p-5 pl-8 text-sm text-slate-600">
          <li>Use `.env.local` for local secrets (ignored by git).</li>
          <li>Configure production secrets in Vercel project settings.</li>
          <li>Set `DATABASE_URL` on the server only. Never use `NEXT_PUBLIC_DATABASE_URL`.</li>
          <li>Copy `.env.example` and fill in your own PostgreSQL credentials. Do not commit `.env`.</li>
        </ul>
      </Card>
    </div>
  );
}
