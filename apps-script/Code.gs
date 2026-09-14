const LOG = "Log";
const RESULTS = "Results";
const OVERALL = "Overall";
const EVENTS = [1, 2, 3];
const LOCK_WAIT_MS = 10000;

const LOG_HEADERS = [
  "receivedAt", "submittedAt", "judge", "event", "heat", "lane",
  "team", "division", "scoreKind", "seconds", "rounds", "reps", "clientId",
];
const CLIENT_ID_COLUMN = LOG_HEADERS.indexOf("clientId") + 1;
const REQUIRED = ["clientId", "submittedAt", "judge", "event", "heat", "lane", "team", "division", "scoreKind"];
const SCORE_KINDS = ["time", "rounds-reps"];

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return reply({ ok: true, service: "12th-state-scoring" });
}

function doPost(e) {
  let record;
  try {
    record = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: "Body is not JSON" });
  }
  if (record === null || typeof record !== "object" || Array.isArray(record)) return reply({ ok: false, error: "Body is not an object" });
  const missing = REQUIRED.filter((key) => record[key] === undefined || record[key] === "");
  if (missing.length > 0) return reply({ ok: false, error: "Missing " + missing.join(", ") });
  if (SCORE_KINDS.indexOf(record.scoreKind) === -1) return reply({ ok: false, error: "Unknown scoreKind" });

  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(LOG);
    if (!sheet) return reply({ ok: false, error: "Run setup() in the script editor first" });
    if (alreadyLogged(sheet, record.clientId)) return reply({ ok: true, duplicate: true });
    sheet.appendRow(toRow(record));
    return reply({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function alreadyLogged(sheet, clientId) {
  const rows = sheet.getLastRow() - 1;
  if (rows < 1) return false;
  const ids = sheet.getRange(2, CLIENT_ID_COLUMN, rows, 1).getValues();
  return ids.some((row) => row[0] === clientId);
}

function numberOrBlank(value) {
  return value === "" || value === undefined || value === null ? "" : Number(value);
}

function toRow(record) {
  return [
    new Date().toISOString(),
    String(record.submittedAt),
    String(record.judge),
    Number(record.event),
    Number(record.heat),
    Number(record.lane),
    String(record.team),
    String(record.division),
    String(record.scoreKind),
    numberOrBlank(record.seconds),
    numberOrBlank(record.rounds),
    numberOrBlank(record.reps),
    String(record.clientId),
  ];
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  setupLog(ss);
  setupResults(ss);
  setupOverall(ss);
}

function sheetNamed(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function writeHeaders(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function setupLog(ss) {
  writeHeaders(sheetNamed(ss, LOG), LOG_HEADERS);
}

function latestField(column) {
  return (
    '=MAP(A2:A, C2:C, LAMBDA(ev, tm, IF(tm="", "", ' +
    "INDEX(SORTN(FILTER(Log!I$2:L, Log!D$2:D=ev, Log!G$2:G=tm), 1, 0, " +
    "FILTER(Log!B$2:B, Log!D$2:D=ev, Log!G$2:G=tm), FALSE), 1, " + column + "))))"
  );
}

function setupResults(ss) {
  const sheet = sheetNamed(ss, RESULTS);
  writeHeaders(sheet, ["event", "division", "team", "scoreKind", "seconds", "rounds", "reps", "display", "sortKey", "placing"]);
  const formulas = [
    '=IFERROR(SORT(UNIQUE(FILTER({Log!D2:D, Log!H2:H, Log!G2:G}, Log!G2:G<>"")), 1, TRUE, 2, TRUE, 3, TRUE), "")',
    "",
    "",
    latestField(1),
    latestField(2),
    latestField(3),
    latestField(4),
    '=MAP(D2:D, E2:E, F2:F, G2:G, LAMBDA(k, s, r, p, IF(k="", "", IF(k="time", INT(s/60)&":"&TEXT(MOD(s,60),"00"), r&" + "&p))))',
    '=MAP(D2:D, E2:E, F2:F, G2:G, LAMBDA(k, s, r, p, IF(k="", "", IF(k="time", s, 1000000 - r*10000 - p))))',
    '=MAP(A2:A, B2:B, I2:I, LAMBDA(ev, dv, key, IF(key="", "", COUNTIFS(A$2:A, ev, B$2:B, dv, I$2:I, "<"&key) + 1)))',
  ];
  sheet.getRange(2, 1, 1, formulas.length).setFormulas([formulas]);
  sheet.getRange("I1").setNote("Lower is better. time → seconds; rounds-reps → 1,000,000 − rounds×10,000 − reps, so any finish beats any capped score.");
}

function eventPlacing(eventNumber) {
  return (
    '=MAP(A2:A, B2:B, LAMBDA(dv, tm, IF(tm="", "", IFERROR(' +
    "INDEX(FILTER(Results!J$2:J, Results!A$2:A=" + eventNumber + ", Results!C$2:C=tm), 1), " +
    "COUNTIFS(Results!A$2:A, " + eventNumber + ", Results!B$2:B, dv) + 1))))"
  );
}

function setupOverall(ss) {
  const sheet = sheetNamed(ss, OVERALL);
  const eventHeaders = EVENTS.map((n) => "E" + n);
  writeHeaders(sheet, ["division", "team"].concat(eventHeaders, ["total", "place"]));
  const totalColumns = EVENTS.map((_, i) => String.fromCharCode("C".charCodeAt(0) + i));
  const totalCol = String.fromCharCode("C".charCodeAt(0) + EVENTS.length);
  const formulas = [
    '=IFERROR(SORT(UNIQUE(FILTER({Results!B2:B, Results!C2:C}, Results!C2:C<>""))), "")',
    "",
  ]
    .concat(EVENTS.map(eventPlacing))
    .concat([
      "=MAP(" + totalColumns.map((c) => c + "2:" + c).join(", ") + ", LAMBDA(" + totalColumns.map((c) => "v" + c).join(", ") +
        ', IF(vC="", "", ' + totalColumns.map((c) => "v" + c).join("+") + ")))",
      "=MAP(A2:A, " + totalCol + "2:" + totalCol + ', LAMBDA(dv, t, IF(t="", "", COUNTIFS(A$2:A, dv, ' + totalCol + '$2:' + totalCol + ', "<"&t) + 1)))',
    ]);
  sheet.getRange(2, 1, 1, formulas.length).setFormulas([formulas]);
  sheet.getRange(totalCol + "1").setNote("Sum of event placings within division; lowest wins. A missing event counts as one worse than last.");
}
