import { redirect } from "next/navigation";

type SignupPageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

/** Email signup removed — keep route for old links; send users to Google sign-in. */
export default function SignupPage({ searchParams }: SignupPageProps) {
  const raw = searchParams.next;
  const nextParam = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;

  if (nextParam) {
    redirect(`/login?next=${encodeURIComponent(nextParam)}`);
  }
  redirect("/login");
}
