// Draft report as a PDF file (made in the browser, loaded only when someone asks for it).
// The table component passes rows already sorted and filtered the way they are on screen.

export type PdfReport = {
  title: string;
  fileName: string;
  subtitle: string;
  legend: string;
  head: string[];
  rows: string[][];
  /** Column indexes that hold numbers (right-aligned). */
  numeric: number[];
};

export async function downloadPdf(report: PdfReport) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const margin = 28;
  const made = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  doc.setFont("helvetica", "bold").setFontSize(14).text(report.title, margin, margin + 6);
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(70);
  doc.text(`${report.subtitle} Made ${made}.`, margin, margin + 20);
  doc.text(doc.splitTextToSize(report.legend, doc.internal.pageSize.getWidth() - margin * 2), margin, margin + 32);

  autoTable(doc, {
    head: [report.head],
    body: report.rows,
    startY: margin + 52,
    margin: { left: margin, right: margin, top: margin, bottom: margin + 10 },
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 2.5, valign: "middle", lineColor: 180, lineWidth: 0.4, textColor: 20, overflow: "linebreak" },
    headStyles: { fillColor: [236, 239, 241], textColor: 20, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: Object.fromEntries(report.numeric.map((i) => [i, { halign: "right" as const }])),
    didDrawPage: () => {
      const page = doc.getNumberOfPages();
      const h = doc.internal.pageSize.getHeight();
      doc.setFontSize(7.5).setTextColor(110);
      doc.text(`${report.title} · page ${page}`, margin, h - 14);
    },
  });
  doc.save(report.fileName);
}
