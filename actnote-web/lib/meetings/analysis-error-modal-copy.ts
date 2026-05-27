import type { AnalysisErrorUxKind } from "@/lib/meetings/analysis-error-ux";

export type AnalysisErrorModalCopy = {
  title: string;
  lead: string;
  bullets: string[];
  primaryLabel: string;
};

/** Figma S-14-02 pop up (180:9060) 및 wireframe case 1/2/3. */
export function analysisErrorModalCopy(kind: AnalysisErrorUxKind): AnalysisErrorModalCopy {
  if (kind === "reattach_file") {
    return {
      title: "File Not Found",
      lead: "We couldn't access the file. It may have been moved or deleted.",
      bullets: ["Re-upload a supported recording for this meeting."],
      primaryLabel: "Re-attach the file",
    };
  }
  if (kind === "retry_network") {
    return {
      title: "Connection issue",
      lead: "We couldn't sync with the server. This is usually temporary.",
      bullets: ["Check your network connection.", "Try running analysis again."],
      primaryLabel: "Try again",
    };
  }
  return {
    title: "Server issue",
    lead: "Analysis failed due to a problem on our side (storage or AI service).",
    bullets: ["Contact support and we'll investigate.", "You can keep using ACTNOTE meanwhile."],
    primaryLabel: "Contact support",
  };
}
