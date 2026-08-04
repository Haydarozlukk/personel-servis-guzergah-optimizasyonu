import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = new URL("./", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const workbook = Workbook.create();
const persons = workbook.worksheets.add("personel");
const vehicles = workbook.worksheets.add("araclar");

const personRows = [
  ["id", "adres"],
  ["person-001", "3053. Cadde No: 49, Yaşamkent, Çankaya, Ankara"],
  ["person-002", "Tunalı Hilmi Caddesi No: 85, Kavaklıdere, Çankaya, Ankara"],
  ["person-003", "Cinnah Caddesi No: 16, Çankaya, Ankara"],
  ["person-004", "Hoşdere Caddesi No: 93, Ayrancı, Çankaya, Ankara"],
  ["person-005", "Dikmen Caddesi No: 200, Çankaya, Ankara"],
  ["person-006", "Arjantin Caddesi No: 15, Gaziosmanpaşa, Çankaya, Ankara"],
  ["person-007", "İran Caddesi No: 21, Çankaya, Ankara"],
  ["person-008", "Meşrutiyet Caddesi No: 10, Çankaya, Ankara"],
  ["person-009", "Atatürk Bulvarı No: 98, Çankaya, Ankara"],
  ["person-010", "Anafartalar Caddesi No: 67, Ulus, Altındağ, Ankara"],
  ["person-011", "Talatpaşa Bulvarı No: 44, Mamak, Ankara"],
  ["person-012", "Ceyhun Atuf Kansu Caddesi No: 100, Balgat, Çankaya, Ankara"],
  ["person-013", "Eskişehir Yolu No: 25, Çankaya, Ankara"],
  ["person-014", "İstanbul Yolu No: 40, Yenimahalle, Ankara"],
  ["person-015", "Konya Yolu No: 75, Yenimahalle, Ankara"],
];

persons.getRange("A1:B16").values = personRows;
persons.tables.add("A1:B16", true, "PersonelTestTable").style = "TableStyleMedium2";
persons.freezePanes.freezeRows(1);
persons.showGridLines = false;
persons.getRange("A1:B1").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF" },
  rowHeight: 24,
};
persons.getRange("A2:A16").format = { numberFormat: "@", horizontalAlignment: "left" };
persons.getRange("A1:A16").format.columnWidth = 18;
persons.getRange("B1:B16").format.columnWidth = 48;
persons.getRange("A2:B16").format.rowHeight = 21;

vehicles.getRange("A1:D3").values = [
  ["id", "kapasite", "boylam", "enlem"],
  ["vehicle-001", 8, 32.8541, 39.9208],
  ["vehicle-002", 8, 32.8541, 39.9208],
];
vehicles.tables.add("A1:D3", true, "AracTestTable").style = "TableStyleMedium2";
vehicles.freezePanes.freezeRows(1);
vehicles.showGridLines = false;
vehicles.getRange("A1:D1").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF" },
  rowHeight: 24,
};
vehicles.getRange("A1:A3").format.columnWidth = 19;
vehicles.getRange("B1:B3").format.columnWidth = 13;
vehicles.getRange("C1:D3").format.columnWidth = 15;
vehicles.getRange("B2:B3").format.numberFormat = "0";
vehicles.getRange("C2:D3").format.numberFormat = "0.0000";

const checkPersons = await workbook.inspect({
  kind: "table",
  range: "personel!A1:B16",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 4,
});
console.log(checkPersons.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

for (const sheetName of ["personel", "araclar"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1.5, format: "png" });
  await fs.writeFile(
    `${outputDir}/${sheetName}-preview.png`,
    new Uint8Array(await preview.arrayBuffer()),
  );
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/ankara-15-kisilik-adres-test.xlsx`);
