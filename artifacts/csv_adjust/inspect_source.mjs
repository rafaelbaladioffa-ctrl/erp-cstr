import fs from "node:fs/promises";
import { Workbook } from "@oai/artifact-tool";

const sourcePath = "C:/Users/rafae/Desktop/projetos.csv";
const csvText = await fs.readFile(sourcePath, "utf8");
const workbook = await Workbook.fromCSV(csvText, { sheetName: "Projetos Originais" });

const inspection = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 8000,
  tableMaxRows: 8,
  tableMaxCols: 20,
  tableMaxCellChars: 100,
});
console.log(inspection.ndjson);

const preview = await workbook.render({
  sheetName: "Projetos Originais",
  range: "A1:S12",
  scale: 1,
  format: "png",
});
await fs.writeFile("source_preview.png", new Uint8Array(await preview.arrayBuffer()));
