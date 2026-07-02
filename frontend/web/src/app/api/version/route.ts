// Always reflects whatever code is currently deployed, since serverless
// functions run the latest build — unlike a tab's own bundle, which is frozen
// at whatever version was loaded until the page is fully reloaded.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { sha: process.env.VERCEL_GIT_COMMIT_SHA || "dev" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
