import { requireEnv } from "../../../lib/config";
import { verifyToken } from "../../../lib/tokens";
import UploadForm from "./upload-form";

export const dynamic = "force-dynamic";

export default async function UploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const claim = verifyToken(token, requireEnv("DUB_TOKEN_SECRET"), Date.now());

  if (!claim) {
    return (
      <main>
        <h1>Ссылка недействительна</h1>
        <p>Отправь боту /dub, чтобы получить новую.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Дубляж на индонезийский</h1>
      <UploadForm token={token} />
    </main>
  );
}
