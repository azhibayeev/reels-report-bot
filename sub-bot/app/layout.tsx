export const metadata = { title: "Субтитры" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          margin: 0,
          padding: "24px",
          maxWidth: 560,
        }}
      >
        {children}
      </body>
    </html>
  );
}
