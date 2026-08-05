// Route: /ai-insights — placeholder only, per the sidebar's red "under
// development" dot. Deliberately no functionality yet.
import { Sparkles } from "lucide-react";

export default function AIInsightsPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[1400px] flex-col items-center justify-center p-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">AI Insights</h1>
      
    </div>
  );
}
