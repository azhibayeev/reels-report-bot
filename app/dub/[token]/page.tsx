import { jobIdOf } from "../../../lib/dub/bot";
import { uploadSecret, verifyUploadToken } from "../../../lib/dub/tokens";
import { MAX_UPLOAD_BYTES } from "../../../lib/dub/uploads";
import UploadForm from "./upload-form";

export const dynamic = "force-dynamic";

const page = { fontFamily: "system-ui", padding: 24, maxWidth: 640, margin: "0 auto" } as const;

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const claim = verifyUploadToken(token, uploadSecret(), Date.now());

  // Просрочку обязательно ловить до формы: иначе человек зальёт сотню мегабайт
  // с телефона и узнает о ней на последнем проценте.
  if (!claim) {
    return (
      <main style={page}>
        <h1>Ссылка недействительна</h1>
        <p>Она живёт час. Пришли ролик боту ещё раз — он выдаст новую.</p>
      </main>
    );
  }

  return (
    <main style={page}>
      <h1>Загрузка ролика</h1>
      <p style={{ color: "#555", lineHeight: 1.5 }}>
        Telegram не отдаёт ботам файлы больше 20 МБ, поэтому тяжёлый ролик идёт мимо него.
        Выбери тот же файл — дубляж на индонезийском вернётся в тот же чат.
      </p>
      <UploadForm
        token={token}
        jobId={jobIdOf(claim.chatId, claim.messageId)}
        maxBytes={MAX_UPLOAD_BYTES}
      />
    </main>
  );
}
