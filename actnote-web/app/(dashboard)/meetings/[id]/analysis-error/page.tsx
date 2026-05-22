import { Suspense, type ReactElement } from "react";
import { Loader2 } from "lucide-react";
import { AnalysisErrorFlow } from "@/components/meetings/AnalysisErrorFlow";

function AnalysisErrorFallback(): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-white">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-[#64748b]">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
        <p className="text-[14px]">Loading…</p>
      </div>
    </div>
  );
}

export default function AnalysisErrorPage({ params }: { params: { id: string } }): React.ReactElement {
  const id = params.id;
  return (
    <Suspense fallback={<AnalysisErrorFallback />}>
      <AnalysisErrorFlow meetingId={id} />
    </Suspense>
  );
}
