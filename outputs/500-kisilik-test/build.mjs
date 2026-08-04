import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = new URL("./", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const workbook = Workbook.create();
const personsSheet = workbook.worksheets.add("personel");
const vehiclesSheet = workbook.worksheets.add("araclar");

const addresses = [
  "Atatürk Bulvarı No:100, Kızılay, Çankaya, Ankara",
  "Aşkabat Caddesi No:20, Bahçelievler, Çankaya, Ankara",
  "3053. Cadde No:49, Yaşamkent, Çankaya, Ankara",
  "Mevlana Bulvarı No:50, Balgat, Çankaya, Ankara",
  "Eskişehir Yolu No:10, Söğütözü, Çankaya, Ankara",
  "Muhsin Yazıcıoğlu Caddesi No:25, Çukurambar, Çankaya, Ankara",
  "Atatürk Bulvarı No:100, Kızılay, Çankaya, Ankara",
  "Hoşdere Caddesi No:80, Ayrancı, Çankaya, Ankara",
  "Dikmen Caddesi No:120, Dikmen, Çankaya, Ankara",
  "Cinnah Caddesi No:45, Çankaya, Ankara",
  "Tunalı Hilmi Caddesi No:70, Kavaklıdere, Çankaya, Ankara",
  "İran Caddesi No:15, Gaziosmanpaşa, Çankaya, Ankara",
  "Simon Bolivar Caddesi No:12, Çankaya, Ankara",
  "Ümitköy Mahallesi 2432. Cadde No:8, Çankaya, Ankara",
  "3053. Cadde No:49, Yaşamkent, Çankaya, Ankara",
  "Çayyolu Mahallesi 2679. Cadde No:6, Çankaya, Ankara",
  "Aşkabat Caddesi No:20, Bahçelievler, Çankaya, Ankara",
  "İvedik Caddesi No:90, Yenimahalle, Ankara",
  "Etlik Caddesi No:75, Keçiören, Ankara",
  "Sanatoryum Caddesi No:40, Keçiören, Ankara",
  "Talatpaşa Bulvarı No:60, Altındağ, Ankara",
  "Cemal Gürsel Caddesi No:55, Cebeci, Çankaya, Ankara",
  "Natoyolu Caddesi No:100, Mamak, Ankara",
  "Ayaş Yolu No:20, Sincan, Ankara",
  "İncek Bulvarı No:45, Gölbaşı, Ankara",
];

const personRows = Array.from({ length: 500 }, (_, index) => [
  `person-${String(index + 1).padStart(3, "0")}`,
  addresses[index % addresses.length],
]);

const vehicleStarts = [
  [32.8541, 39.9208], [32.8321, 39.9255], [32.8095, 39.9102], [32.7863, 39.9071],
  [32.7632, 39.9088], [32.7395, 39.9712], [32.7068, 39.9731], [32.6802, 39.9654],
  [32.6185, 39.9638], [32.5714, 39.9596], [32.8625, 39.9710], [32.8847, 39.9873],
  [32.9001, 39.9502], [32.9217, 39.9324], [32.8934, 39.9167], [32.8742, 39.9018],
  [32.8463, 39.8895], [32.8232, 39.8841], [32.7948, 39.8823], [32.7711, 39.8819],
  [32.7482, 39.8897], [32.7245, 39.8942], [32.6973, 39.9066], [32.6664, 39.9160],
  [32.6378, 39.9251], [32.8617, 39.9391], [32.8384, 39.9486], [32.8160, 39.9404],
  [32.7897, 39.9368], [32.7572, 39.9240], [32.7301, 39.9382], [32.7044, 39.9450],
  [32.6748, 39.9475], [32.6521, 39.9511], [32.6275, 39.9550], [32.9054, 39.9692],
  [32.8861, 39.9584], [32.8689, 39.9477], [32.8512, 39.9362], [32.8338, 39.9147],
  [32.8112, 39.9003], [32.7881, 39.8965], [32.7654, 39.9011], [32.7426, 39.9128],
  [32.7189, 39.9225], [32.6952, 39.9320], [32.6718, 39.9401], [32.6487, 39.9440],
  [32.6254, 39.9490], [32.6032, 39.9534],
];

const capacities = [...Array(5).fill(24), 45, ...Array(44).fill(16)];
const vehicleRows = capacities.map((capacity, index) => [
  `vehicle-${String(index + 1).padStart(3, "0")}`,
  capacity,
  vehicleStarts[index][0],
  vehicleStarts[index][1],
]);

personsSheet.getRange("A1:B501").values = [["id", "adres"], ...personRows];
vehiclesSheet.getRange("A1:D51").values = [["id", "kapasite", "boylam", "enlem"], ...vehicleRows];

for (const [sheet, range, widths] of [
  [personsSheet, "A1:B501", [18, 64]],
  [vehiclesSheet, "A1:D51", [18, 14, 16, 16]],
]) {
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  const used = sheet.getRange(range);
  used.format = {
    font: { name: "Aptos", size: 10, color: "#17231B" },
    borders: { insideHorizontal: { style: "thin", color: "#E3EAE5" } },
  };
  used.getRow(0).format = {
    fill: "#126B3B",
    font: { name: "Aptos", size: 11, bold: true, color: "#FFFFFF" },
    rowHeight: 26,
  };
  widths.forEach((width, index) => sheet.getRangeByIndexes(0, index, used.rowCount, 1).format.columnWidth = width);
}

personsSheet.tables.add("A1:B501", true, "PersonelTable").style = "TableStyleMedium4";
vehiclesSheet.tables.add("A1:D51", true, "AraclarTable").style = "TableStyleMedium4";
vehiclesSheet.getRange("B2:B51").format.numberFormat = "0";
vehiclesSheet.getRange("C2:D51").format.numberFormat = "0.000000";

const personCheck = await workbook.inspect({ kind: "table", range: "personel!A1:B8", include: "values,formulas", tableMaxRows: 8, tableMaxCols: 2 });
const vehicleCheck = await workbook.inspect({ kind: "table", range: "araclar!A1:D51", include: "values,formulas", tableMaxRows: 8, tableMaxCols: 4 });
console.log(personCheck.ndjson);
console.log(vehicleCheck.ndjson);

for (const [sheetName, range, fileName] of [
  ["personel", "A1:B18", "personel-preview.png"],
  ["araclar", "A1:D20", "araclar-preview.png"],
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1.3, format: "png" });
  await fs.writeFile(`${outputDir}/${fileName}`, new Uint8Array(await preview.arrayBuffer()));
}

const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 50 }, summary: "formula error scan" });
console.log(errors.ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/500-personel-50-arac-test.xlsx`);
