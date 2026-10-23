import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Contract CRM",
  description: "Gestão de contratos",
  verification: {
    google: [
      'Yi2dxGaXjMEc_FsA3GwabGxfDRXyOoBw48OrJXJv85Q',
      'AqPkROuMdsFqF1dyK70O6tACN6O0-AZOabWeGxBLuvw',
    ],
  },
};

// Celular: largura do aparelho, sem travar o zoom (acessibilidade); cor da barra do navegador
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#153b49",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
