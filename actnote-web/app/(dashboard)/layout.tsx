import { Sidebar } from "@/components/layout/Sidebar";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-[#f8fafc]">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </WorkspaceProvider>
  );
}
