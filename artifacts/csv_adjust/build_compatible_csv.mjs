import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const sourcePath = "C:/Users/rafae/Desktop/projetos.csv";
const outputDir = "../../outputs/csv_projetos";
const csvOutputPath = `${outputDir}/projetos_compativel_erp.csv`;
const xlsxOutputPath = `${outputDir}/projetos_compativel_erp.xlsx`;
const previewPath = `${outputDir}/projetos_compativel_erp_preview.png`;

const sourceText = await fs.readFile(sourcePath, "utf8");
const sourceWorkbook = await Workbook.fromCSV(sourceText, { sheetName: "Origem" });
const sourceValues = sourceWorkbook.worksheets.getItem("Origem").getUsedRange(true).values;
const sourceHeaders = sourceValues[0].map(String);
const sourceRows = sourceValues.slice(1);
const index = Object.fromEntries(sourceHeaders.map((header, position) => [header, position]));

const targetHeaders = [
  "nome",
  "po",
  "empresa",
  "cliente",
  "site",
  "tipo_projeto",
  "categoria",
  "responsavel_cstr",
  "responsavel_cliente",
  "status",
  "inicio_previsto",
  "termino_previsto",
  "descricao",
  "observacoes",
  "ativo",
];

function text(row, field) {
  return String(row[index[field]] ?? "").trim();
}

function bool(row, field) {
  return text(row, field).toLowerCase() === "true";
}

function formatDate(value) {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function statusFor(row) {
  if (bool(row, "pausado")) return "Pausado";
  if (bool(row, "encerrado")) return "Concluído";
  if (Number(text(row, "percentual") || 0) > 0) return "Em Andamento";
  return "Planejamento";
}

const targetRows = sourceRows.map((row) => {
  const legacyClient = text(row, "cliente");
  const legacySite = text(row, "site_id");
  const legacyCategory = text(row, "categoria");
  const compatibleClient = legacyClient.toUpperCase() === "AWS" ? "AWS" : "";
  const compatibleSite = compatibleClient && legacySite.toUpperCase() === "GRU65" ? "GRU65" : "";
  const notes = [
    `ID legado: ${text(row, "id")}`,
    legacyCategory ? `Categoria original: ${legacyCategory}` : "",
    `Progresso legado: ${text(row, "percentual") || "0"}%`,
    !compatibleClient && legacyClient ? `Cliente original: ${legacyClient}` : "",
    !compatibleSite && legacySite ? `Site original: ${legacySite}` : "",
  ].filter(Boolean).join("; ");

  return [
    text(row, "nome"),
    text(row, "po"),
    "CONSULTIMER BRASIL LTDA",
    compatibleClient,
    compatibleSite,
    "",
    "",
    "",
    "",
    statusFor(row),
    formatDate(text(row, "data_inicio")),
    formatDate(text(row, "data_fim")),
    "",
    notes,
    "Sim",
  ];
});

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Projetos para Importação");
const matrix = [targetHeaders, ...targetRows];
sheet.getRangeByIndexes(0, 0, matrix.length, targetHeaders.length).values = matrix;
sheet.showGridLines = false;
sheet.freezePanes.freezeRows(1);

const header = sheet.getRangeByIndexes(0, 0, 1, targetHeaders.length);
header.format = {
  fill: "#6D28D9",
  font: { bold: true, color: "#FFFFFF" },
  rowHeight: 26,
  wrapText: true,
};
const dataRange = sheet.getRangeByIndexes(1, 0, targetRows.length, targetHeaders.length);
dataRange.format = {
  borders: { insideHorizontal: { style: "thin", color: "#E5E7EB" } },
  rowHeight: 22,
};
sheet.tables.add(`A1:O${matrix.length}`, true, "ProjetosImportacao");

const widths = [32, 18, 30, 16, 12, 20, 20, 26, 26, 18, 18, 18, 34, 68, 10];
widths.forEach((width, column) => {
  sheet.getRangeByIndexes(0, column, matrix.length, 1).format.columnWidth = width;
});
sheet.getRange(`N2:N${matrix.length}`).format.wrapText = true;

await fs.mkdir(outputDir, { recursive: true });

function csvEscape(value) {
  const normalized = String(value ?? "");
  return /[;"\r\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

const csvText = "\uFEFF" + matrix.map((row) => row.map(csvEscape).join(";")).join("\r\n") + "\r\n";
await fs.writeFile(csvOutputPath, csvText, "utf8");

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(xlsxOutputPath);

const preview = await workbook.render({
  sheetName: "Projetos para Importação",
  range: "A1:O12",
  scale: 0.8,
  format: "png",
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const inspection = await workbook.inspect({
  kind: "table",
  range: "'Projetos para Importação'!A1:O8",
  include: "values,formulas",
  tableMaxRows: 8,
  tableMaxCols: 15,
  maxChars: 10000,
});
console.log(inspection.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);
console.log(JSON.stringify({ rows: targetRows.length, csvOutputPath, xlsxOutputPath, previewPath }));
