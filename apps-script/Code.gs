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

function setupResults(ss) {
  const sheet = sheetNamed(ss, RESULTS);
  sheet.clear();
  writeHeaders(sheet, [
    "event", "division", "team", "scoreKind", "seconds", "rounds", "reps", "submittedAt", "display", "sortKey", "placing",
  ]);
  const formulas = [
    "=IFERROR(SORTN(SORT(FILTER({Log!D2:D, Log!H2:H, Log!G2:G, Log!I2:I, Log!J2:J, Log!K2:K, Log!L2:L, Log!B2:B}, " +
      'Log!G2:G<>""), 8, FALSE), 9^9, 2, 1, TRUE, 3, TRUE), "")',
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    '=ARRAYFORMULA(IF(C2:C="", "", IF(D2:D="time", INT(E2:E/60)&":"&TEXT(MOD(E2:E,60),"00"), F2:F&" + "&G2:G)))',
    '=ARRAYFORMULA(IF(C2:C="", "", IF(D2:D="time", E2:E, 1000000 - F2:F*10000 - G2:G)))',
    '=ARRAYFORMULA(IF(C2:C="", "", COUNTIFS(A2:A, A2:A, B2:B, B2:B, J2:J, "<"&J2:J) + 1))',
  ];
  sheet.getRange(2, 1, 1, formulas.length).setFormulas([formulas]);
  sheet.getRange("A1").setNote("Latest Log row per event + team (by submittedAt), sorted by event then team.");
  sheet.getRange("J1").setNote("Lower is better. time → seconds; rounds-reps → 1,000,000 − rounds×10,000 − reps, so any finish beats any capped score.");
}

function eventPlacing(eventNumber) {
  return (
    '=ARRAYFORMULA(IF(B2:B="", "", IFERROR(' +
    "VLOOKUP(" + eventNumber + '&"|"&B2:B, {Results!A2:A&"|"&Results!C2:C, Results!K2:K}, 2, FALSE), ' +
    "COUNTIFS(Results!A2:A, " + eventNumber + ", Results!B2:B, A2:A) + 1)))"
  );
}

function setupOverall(ss) {
  const sheet = sheetNamed(ss, OVERALL);
  sheet.clear();
  const eventHeaders = EVENTS.map((n) => "E" + n);
  writeHeaders(sheet, ["division", "team"].concat(eventHeaders, ["total", "place"]));
  const eventColumns = EVENTS.map((_, i) => String.fromCharCode("C".charCodeAt(0) + i));
  const totalCol = String.fromCharCode("C".charCodeAt(0) + EVENTS.length);
  const formulas = [
    '=IFERROR(SORT(UNIQUE(FILTER({Results!B2:B, Results!C2:C}, Results!C2:C<>""))), "")',
    "",
  ]
    .concat(EVENTS.map(eventPlacing))
    .concat([
      '=ARRAYFORMULA(IF(B2:B="", "", ' + eventColumns.map((c) => c + "2:" + c).join(" + ") + "))",
      '=ARRAYFORMULA(IF(B2:B="", "", COUNTIFS(A2:A, A2:A, ' + totalCol + "2:" + totalCol + ', "<"&' + totalCol + "2:" + totalCol + ") + 1))",
    ]);
  sheet.getRange(2, 1, 1, formulas.length).setFormulas([formulas]);
  sheet.getRange(totalCol + "1").setNote("Sum of event placings within division; lowest wins. A missing event counts as one worse than last.");
}
