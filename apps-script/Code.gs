const LOG = "Log";
const RESULTS = "Results";
const OVERALL = "Overall";
const SETTINGS = "Settings";
const EVENTS_TAB = "Events";
const HEATS = "Heats";
const SLOTS = "Slots";
const LOCK_WAIT_MS = 10000;

const LOG_HEADERS = [
  "receivedAt", "submittedAt", "judge", "event", "heat", "lane",
  "team", "division", "scoreKind", "seconds", "rounds", "reps", "clientId",
];
const CLIENT_ID_COLUMN = LOG_HEADERS.indexOf("clientId") + 1;
const REQUIRED = ["clientId", "submittedAt", "judge", "event", "heat", "lane", "team", "division", "scoreKind"];
const SCORE_KINDS = ["time", "rounds-reps"];

const SETTINGS_ROWS = [
  ["compDate", "2027-09-11"],
  ["timeZone", "America/New_York"],
  ["teamSize", 2],
  ["divisions", "F/F RX, F/F Scaled, F/M RX, F/M Scaled, M/M RX, M/M Scaled"],
  ["signupsOpen", false],
];
const EVENT_HEADERS = ["event", "title", "format", "scoring", "capSeconds", "rx", "scaled", "lanes"];
const HEAT_HEADERS = ["event", "heat", "start", "end"];
const SLOT_HEADERS = ["event", "heat", "lane", "email", "team", "athletes", "division", "signedUpAt"];
const SCORING_FORMATS = ["time-or-rounds", "rounds-reps"];

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(SETTINGS)) return reply({ ok: false, error: "Run setup() in the script editor first" });
  return reply({ ok: true, schedule: readSchedule(ss) });
}

function readTable(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = (values[0] || []).map((h) => String(h).trim());
  return values.slice(1)
    .filter((row) => row.some((cell) => cell !== "" && cell !== null))
    .map((row) => headers.reduce((record, header, i) => Object.assign(record, { [header]: row[i] }), {}));
}

function readSettings(ss) {
  const rows = ss.getSheetByName(SETTINGS).getDataRange().getValues().slice(1);
  return rows.reduce((settings, row) => Object.assign(settings, { [String(row[0]).trim()]: row[1] }), {});
}

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

function asClock(value, timeZone) {
  if (value instanceof Date) return Utilities.formatDate(value, timeZone, "HH:mm");
  if (typeof value === "number") {
    const minutes = Math.round(value * 24 * 60);
    return pad2(Math.floor(minutes / 60) % 24) + ":" + pad2(minutes % 60);
  }
  return String(value === undefined || value === null ? "" : value).trim();
}

function asDateString(value, timeZone) {
  if (value instanceof Date) return Utilities.formatDate(value, timeZone, "yyyy-MM-dd");
  return String(value === undefined || value === null ? "" : value).trim();
}

function asText(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function asNumberOrText(value) {
  const text = asText(value);
  return text !== "" && !isNaN(Number(text)) ? Number(text) : text;
}

function asBoolean(value) {
  if (typeof value === "boolean") return value;
  return asText(value).toUpperCase() === "TRUE";
}

function readEvents(ss, timeZone) {
  const heats = readTable(ss.getSheetByName(HEATS));
  const slots = readTable(ss.getSheetByName(SLOTS)).slice().sort((a, b) => new Date(a.signedUpAt) - new Date(b.signedUpAt));
  return readTable(ss.getSheetByName(EVENTS_TAB)).map((row) => {
    const number = asNumberOrText(row.event);
    const laneCount = asNumberOrText(row.lanes);
    const capSeconds = asText(row.capSeconds);
    return Object.assign(
      {
        number: number,
        title: asText(row.title),
        format: asText(row.format),
        scoring: asText(row.scoring),
        rx: asText(row.rx),
        scaled: asText(row.scaled),
        lanes: laneCount,
        heats: heats
          .filter((h) => asNumberOrText(h.event) === number)
          .map((h) => readHeat(h, number, laneCount, slots, timeZone)),
      },
      capSeconds === "" ? {} : { capSeconds: asNumberOrText(capSeconds) },
    );
  });
}

function readHeat(row, eventNumber, laneCount, slots, timeZone) {
  const number = asNumberOrText(row.heat);
  const lanes = slots
    .filter((s) => asNumberOrText(s.event) === eventNumber && asNumberOrText(s.heat) === number)
    .map((s) => readLane(s))
    .filter((lane) => typeof lane.lane === "number" && lane.lane >= 1 && (typeof laneCount !== "number" || lane.lane <= laneCount))
    .filter((lane, i, all) => all.findIndex((other) => other.lane === lane.lane) === i);
  return { number: number, start: asClock(row.start, timeZone), end: asClock(row.end, timeZone), lanes: lanes };
}

function readLane(slot) {
  const email = asText(slot.email);
  return Object.assign(
    { lane: asNumberOrText(slot.lane), team: asText(slot.team), athletes: asText(slot.athletes), division: asText(slot.division) },
    email === "" ? {} : { email: email },
  );
}

function readSchedule(ss) {
  const settings = readSettings(ss);
  const timeZone = asText(settings.timeZone) || "America/New_York";
  return {
    compDate: asDateString(settings.compDate, timeZone),
    timeZone: timeZone,
    teamSize: asNumberOrText(settings.teamSize),
    divisions: asText(settings.divisions).split(",").map((d) => d.trim()).filter((d) => d !== ""),
    signupsOpen: asBoolean(settings.signupsOpen),
    events: readEvents(ss, timeZone),
  };
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
  setupSettings(ss);
  setupEvents(ss);
  setupHeats(ss);
  setupSlots(ss);
  setupLog(ss);
  setupResults(ss);
  setupOverall(ss);
}

function createIfMissing(ss, name, headers, fill) {
  if (ss.getSheetByName(name)) return;
  const sheet = ss.insertSheet(name);
  writeHeaders(sheet, headers);
  fill(sheet);
}

function setupSettings(ss) {
  createIfMissing(ss, SETTINGS, ["key", "value"], (sheet) => {
    sheet.getRange(2, 1, SETTINGS_ROWS.length, 2).setValues(SETTINGS_ROWS);
    sheet.getRange(2 + SETTINGS_ROWS.length - 1, 2).insertCheckboxes();
    sheet.getRange("A1").setNote("compDate YYYY-MM-DD · timeZone IANA name · teamSize 1 for individuals · divisions comma-separated · signupsOpen checkbox");
  });
}

function setupEvents(ss) {
  createIfMissing(ss, EVENTS_TAB, EVENT_HEADERS, (sheet) => {
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(SCORING_FORMATS, true).build();
    sheet.getRange("D2:D").setDataValidation(rule);
    sheet.getRange("A1").setNote("One row per event. scoring: time-or-rounds needs capSeconds; rounds-reps leaves it blank. lanes = lanes per heat. Re-run setup() after changing the number of events so Overall gets the right columns.");
  });
}

function setupHeats(ss) {
  createIfMissing(ss, HEATS, HEAT_HEADERS, (sheet) => {
    sheet.getRange("C2:D").setNumberFormat("@");
    sheet.getRange("A1").setNote("One row per heat. start/end as HH:MM text in the comp time zone, e.g. 08:00.");
  });
}

function setupSlots(ss) {
  createIfMissing(ss, SLOTS, SLOT_HEADERS, (sheet) => {
    sheet.getRange("A1").setNote("One row per claimed lane; written by the sign-up page, editable by hand. Rows whose event/heat/lane do not exist are ignored by the site. If two rows claim the same lane the earlier signedUpAt wins.");
  });
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

function eventNumbers(ss) {
  const sheet = ss.getSheetByName(EVENTS_TAB);
  const numbers = sheet ? readTable(sheet).map((row) => Number(row.event)).filter((n) => Number.isInteger(n) && n > 0) : [];
  return numbers.length > 0 ? numbers : [1];
}

function eventPlacing(eventNumber) {
  return (
    '=ARRAYFORMULA(IF(B2:B="", "", IFERROR(' +
    "VLOOKUP(" + eventNumber + '&"|"&B2:B, {Results!A2:A&"|"&Results!C2:C, Results!K2:K}, 2, FALSE), ' +
    "COUNTIFS(Results!A2:A, " + eventNumber + ", Results!B2:B, A2:A) + 1)))"
  );
}

function setupOverall(ss) {
  const events = eventNumbers(ss);
  const sheet = sheetNamed(ss, OVERALL);
  sheet.clear();
  const eventHeaders = events.map((n) => "E" + n);
  writeHeaders(sheet, ["division", "team"].concat(eventHeaders, ["total", "place"]));
  const eventColumns = events.map((_, i) => String.fromCharCode("C".charCodeAt(0) + i));
  const totalCol = String.fromCharCode("C".charCodeAt(0) + events.length);
  const formulas = [
    '=IFERROR(SORT(UNIQUE(FILTER({Results!B2:B, Results!C2:C}, Results!C2:C<>""))), "")',
    "",
  ]
    .concat(events.map(eventPlacing))
    .concat([
      '=ARRAYFORMULA(IF(B2:B="", "", ' + eventColumns.map((c) => c + "2:" + c).join(" + ") + "))",
      '=ARRAYFORMULA(IF(B2:B="", "", COUNTIFS(A2:A, A2:A, ' + totalCol + "2:" + totalCol + ', "<"&' + totalCol + "2:" + totalCol + ") + 1))",
    ]);
  sheet.getRange(2, 1, 1, formulas.length).setFormulas([formulas]);
  sheet.getRange(totalCol + "1").setNote("Sum of event placings within division; lowest wins. A missing event counts as one worse than last.");
}
