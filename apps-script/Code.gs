const LOG = "Log";
const RESULTS = "Results";
const OVERALL = "Overall";
const SETTINGS = "Settings";
const DIVISIONS = "Divisions";
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
const CLAIM_REQUIRED = ["event", "heat", "lane", "email", "team", "athletes", "division"];
const RELEASE_REQUIRED = ["event", "heat", "lane", "email"];

const SETTINGS_ROWS = [
  ["compName", "12 Years of 12th State"],
  ["compDate", "2027-09-11"],
  ["timeZone", "America/New_York"],
  ["laneLabel", "Lane"],
  ["signupsOpen", false],
];
const DEFAULT_LANE_LABEL = "Lane";
const DEFAULT_COMP_NAME = "12 Years of 12th State";
const RETIRED_SETTINGS = ["teamSize", "divisions"];
const DIVISION_HEADERS = ["division", "teamSize"];
const DIVISION_ROWS = [
  ["F/F RX", 2],
  ["F/F Scaled", 2],
  ["F/M RX", 2],
  ["F/M Scaled", 2],
  ["M/M RX", 2],
  ["M/M Scaled", 2],
];
const EVENT_HEADERS = ["event", "title", "format", "scoring", "capSeconds", "rx", "intermediate", "scaled", "lanes"];
const HEAT_HEADERS = ["event", "heat", "date", "start", "end"];
const SLOT_HEADERS = ["event", "heat", "lane", "email", "team", "athletes", "division", "signedUpAt"];
const SCORING_FORMATS = ["time-or-rounds", "rounds-reps"];
const SCHEDULE_CACHE_KEY = "schedule";
const SCHEDULE_CACHE_SECONDS = 30;
const CACHE_REFILL_WAIT_MS = 20000;
const MENU_TITLE = "12th State";
const GITHUB_REPO = "mikesholar/12th-state-heats";
const DEPLOY_WORKFLOW = "deploy.yml";
const GITHUB_TOKEN_PROPERTY = "GITHUB_TOKEN";
const LAST_FALLBACK_REFRESH_PROPERTY = "lastFallbackRefreshAt";
const FALLBACK_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const CALCULATOR = "Calculator";
const CALCULATOR_FIRST_ROW = 4;
const CALCULATOR_INPUT_HEADERS = ["date", "start", "length", "buffer", "heats"];
const CALCULATOR_PREVIEW_HEADERS = ["heat", "date", "start", "end"];
const MINUTES_PER_DAY = 24 * 60;
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const WHOLE_NUMBER_TEXT = /^\d+$/;
const CLOCK_TEXT = /^(\d{1,2}):(\d{2})$/;
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function missingTabs(ss) {
  return [SETTINGS, DIVISIONS, EVENTS_TAB, HEATS, SLOTS].filter((name) => !ss.getSheetByName(name));
}

function setupError(ss) {
  const missing = missingTabs(ss);
  return missing.length > 0 ? "Run setup() in the script editor first (missing " + missing.join(", ") + ")" : "";
}

function replyText(json) {
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(SCHEDULE_CACHE_KEY);
  if (hit) return replyText(hit);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CACHE_REFILL_WAIT_MS)) return reply({ ok: false, error: "The sheet is busy — try again" });
  try {
    const refilled = cache.get(SCHEDULE_CACHE_KEY);
    if (refilled) return replyText(refilled);
    const json = scheduleReplyJson();
    cache.put(SCHEDULE_CACHE_KEY, json, SCHEDULE_CACHE_SECONDS);
    return replyText(json);
  } finally {
    lock.releaseLock();
  }
}

function scheduleReplyJson() {
  const ss = SpreadsheetApp.getActive();
  const error = setupError(ss);
  if (error) return JSON.stringify({ ok: false, error: error });
  try {
    return JSON.stringify({ ok: true, schedule: readSchedule(ss) });
  } catch (err) {
    return JSON.stringify({ ok: false, error: String((err && err.message) || err) });
  }
}

function clearScheduleCache() {
  CacheService.getScriptCache().remove(SCHEDULE_CACHE_KEY);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(MENU_TITLE)
    .addItem("Update site fallback", "refreshFallback")
    .addItem("Write heats to Heats tab", "writeCalculatorHeats")
    .addToUi();
}

function refreshFallback() {
  SpreadsheetApp.getActive().toast(fallbackRefreshMessage(), MENU_TITLE, 10);
}

function fallbackRefreshMessage() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty(GITHUB_TOKEN_PROPERTY);
  if (!token) return "Fallback updates aren't set up — see docs/deploy.md §1g.";
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return "The sheet is busy — try again.";
  try {
    const retryAt = cooldownEndsAt(props);
    if (retryAt) {
      const clock = Utilities.formatDate(retryAt, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), "HH:mm");
      return "An update started less than " + FALLBACK_REFRESH_COOLDOWN_MS / 60000 + " minutes ago — try again at " + clock + ".";
    }
    clearScheduleCache();
    const response = dispatchDeploy(token);
    const status = response.getResponseCode();
    if (status !== 204) return "GitHub refused the update (" + status + "): " + githubMessage(response);
    props.setProperty(LAST_FALLBACK_REFRESH_PROPERTY, String(Date.now()));
    return "Site fallback update started — live in about 2 minutes.";
  } catch (err) {
    return "Couldn't start the update: " + String((err && err.message) || err);
  } finally {
    lock.releaseLock();
  }
}

function cooldownEndsAt(props) {
  const last = Number(props.getProperty(LAST_FALLBACK_REFRESH_PROPERTY));
  if (!last) return null;
  const endsAt = last + FALLBACK_REFRESH_COOLDOWN_MS;
  return endsAt > Date.now() ? new Date(Math.ceil(endsAt / 60000) * 60000) : null;
}

function dispatchDeploy(token) {
  const url = "https://api.github.com/repos/" + GITHUB_REPO + "/actions/workflows/" + DEPLOY_WORKFLOW + "/dispatches";
  return UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    payload: JSON.stringify({ ref: "main" }),
    muteHttpExceptions: true,
  });
}

function githubMessage(response) {
  const text = response.getContentText();
  if (!text) return "no details";
  try {
    return JSON.parse(text).message || text.slice(0, 200);
  } catch (err) {
    return text.slice(0, 200);
  }
}

function clockMinutes(text) {
  const match = CLOCK_TEXT.exec(asText(text));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function clockText(minutes) {
  return pad2(Math.floor(minutes / 60)) + ":" + pad2(minutes % 60);
}

function blockHeats(row) {
  const start = clockMinutes(row.start);
  const length = Number(row.length);
  const step = length + Number(row.buffer);
  return Array.from({ length: Number(row.heats) }, (_, i) => ({
    row: row.row,
    date: row.date,
    startMinutes: start + i * step,
    endMinutes: start + i * step + length,
  }));
}

function isRealDateText(text) {
  const date = new Date(text + "T00:00:00Z");
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function isWholeNumberFrom(value, least) {
  const text = asText(value);
  return WHOLE_NUMBER_TEXT.test(text) && Number(text) >= least;
}

function planRowError(row) {
  const where = "Row " + row.row;
  if (!DATE_TEXT.test(row.date)) return where + ': date "' + row.date + '" must be YYYY-MM-DD';
  if (!isRealDateText(row.date)) return where + ': date "' + row.date + '" is not a real date';
  if (clockMinutes(row.start) === null) return where + ': start "' + row.start + '" must be HH:MM';
  if (!isWholeNumberFrom(row.length, 1)) return where + ": length must be a whole number of at least 1";
  if (!isWholeNumberFrom(row.buffer, 0)) return where + ": buffer must be a whole number of at least 0";
  if (!isWholeNumberFrom(row.heats, 1)) return where + ": heats must be a whole number of at least 1";
  if (Number(asText(row.heats)) > MINUTES_PER_DAY) return where + ": heats can't be more than " + MINUTES_PER_DAY + " in one day";
  return "";
}

function planInputError(input) {
  const event = asNumberOrText(input.event);
  if (event === "") return "Calculator: pick an event number in B1";
  if (input.eventNumbers.indexOf(event) === -1) return "Calculator: event " + event + " is not in the Events tab";
  if (input.rows.length === 0) return "Calculator: add at least one row of heats";
  return input.rows.map(planRowError).find((error) => error !== "") || "";
}

function lateHeatError(heats) {
  const late = heats.find((h) => h.endMinutes >= MINUTES_PER_DAY);
  return late ? "Row " + late.row + ": heat " + late.heat + " would end after midnight (" + clockText(late.endMinutes) + ")" : "";
}

function overlapError(blocks) {
  return blocks
    .map((block, i) => {
      const first = block[0];
      const clash = blocks.slice(0, i).find((earlier) => earlier[0].date === first.date && first.startMinutes < earlier[earlier.length - 1].endMinutes);
      if (!clash) return "";
      return "Row " + first.row + " starts " + clockText(first.startMinutes) + ", before row " + clash[0].row + "'s last heat ends " + clockText(clash[clash.length - 1].endMinutes);
    })
    .find((error) => error !== "") || "";
}

function planHeats(input) {
  const inputError = planInputError(input);
  if (inputError) return { ok: false, error: inputError };
  const blocks = input.rows.map(blockHeats);
  const numbered = blocks.flat().map((h, i) => Object.assign({}, h, { heat: i + 1 }));
  const scheduleError = lateHeatError(numbered) || overlapError(blocks);
  if (scheduleError) return { ok: false, error: scheduleError };
  return {
    ok: true,
    heats: numbered.map((h) => ({ heat: h.heat, date: h.date, start: clockText(h.startMinutes), end: clockText(h.endMinutes) })),
  };
}

function counted(n, noun) {
  return n + " " + noun + (n === 1 ? "" : "s");
}

function dayLabel(date) {
  const day = new Date(date + "T12:00:00Z");
  return WEEKDAY_NAMES[day.getUTCDay()] + " " + MONTH_NAMES[day.getUTCMonth()] + " " + day.getUTCDate();
}

function heatsPerDay(heats) {
  const dates = heats.map((h) => h.date).filter((date, i, all) => all.indexOf(date) === i);
  return dates.map((date) => dayLabel(date) + ": " + heats.filter((h) => h.date === date).length).join(", ");
}

function replaceQuestion(input) {
  const plan = counted(input.heats.length, "heat") + " (" + heatsPerDay(input.heats) + ")?";
  if (input.existingHeatCount === 0) return "Event " + input.event + " has no heats yet. Write " + plan;
  return "Replace Event " + input.event + "'s " + counted(input.existingHeatCount, "heat") + " with " + plan;
}

function droppedClaimsNote(claims, heats) {
  const kept = heats.map((h) => h.heat);
  const dropped = claims.filter((c) => kept.indexOf(asNumberOrText(c.heat)) === -1);
  if (dropped.length === 0) return "";
  const lead = dropped.length === 1 ? "1 sign-up is in a heat" : dropped.length + " sign-ups are in heats";
  const list = dropped.map((c) => "Heat " + c.heat + " lane " + c.lane + " (" + (asText(c.team) || "no team name") + ")").join(", ");
  return lead + " that won't exist and will disappear from the site: " + list + ".";
}

function writeSummary(input) {
  const claims = input.claims.filter((c) => asText(c.heat) !== "");
  const notes = [
    replaceQuestion(input),
    droppedClaimsNote(claims, input.heats),
    claims.length > 0 ? "Teams already signed up keep their heat and lane number, but the times change." : "",
  ];
  return { title: "Write Event " + input.event + "'s heats?", message: notes.filter((note) => note !== "").join("\n\n") };
}

function heatsTableAfter(input) {
  const headers = headerRow(input.values);
  const missing = HEAT_HEADERS.filter((name) => headers.indexOf(name) === -1);
  if (missing.length > 0) return { ok: false, error: "The Heats tab needs a " + missing.join(", ") + " column first — see docs/deploy.md §4b." };
  const column = (name) => headers.indexOf(name);
  const isBlank = (row) => row.every((cell) => asText(cell) === "");
  const rows = input.values.slice(1).filter((row) => !isBlank(row));
  const isThisEvent = (row) => asNumberOrText(row[column("event")]) === asNumberOrText(input.event);
  const tidied = (row) =>
    row.map((cell, i) => {
      if (i === column("date")) return asDateString(cell, input.zone);
      if (i === column("start") || i === column("end")) return asClock(cell, input.zone);
      return cell;
    });
  const written = (heat) => {
    const cells = { event: asNumberOrText(input.event), heat: heat.heat, date: heat.date, start: heat.start, end: heat.end };
    return headers.map((name) => (Object.prototype.hasOwnProperty.call(cells, name) ? cells[name] : ""));
  };
  return {
    ok: true,
    removed: rows.filter(isThisEvent).length,
    values: [input.values[0], ...rows.filter((row) => !isThisEvent(row)).map(tidied), ...input.heats.map(written)],
  };
}

function calculatorEvent(sheet) {
  return asNumberOrText(sheet.getRange("B1").getValue());
}

function calculatorPlan(ss, sheet) {
  const zone = ss.getSpreadsheetTimeZone();
  const count = Math.max(sheet.getLastRow() - CALCULATOR_FIRST_ROW + 1, 1);
  const rows = sheet
    .getRange(CALCULATOR_FIRST_ROW, 1, count, CALCULATOR_INPUT_HEADERS.length)
    .getValues()
    .map((cells, i) => ({
      row: CALCULATOR_FIRST_ROW + i,
      date: asDateString(cells[0], zone),
      start: asClock(cells[1], zone),
      length: cells[2],
      buffer: cells[3],
      heats: cells[4],
    }))
    .filter((row) => [row.date, row.start, asText(row.length), asText(row.buffer), asText(row.heats)].some((value) => value !== ""));
  const eventNumbers = readTable(ss.getSheetByName(EVENTS_TAB)).map((row) => asNumberOrText(row.event));
  return planHeats({ event: calculatorEvent(sheet), eventNumbers: eventNumbers, rows: rows });
}

function ensureRows(sheet, lastRow) {
  if (sheet.getMaxRows() < lastRow) sheet.insertRowsAfter(sheet.getMaxRows(), lastRow - sheet.getMaxRows());
}

function showCalculatorPreview(ss, sheet) {
  const plan = calculatorPlan(ss, sheet);
  const previewColumn = CALCULATOR_INPUT_HEADERS.length + 3;
  sheet.getRange(CALCULATOR_FIRST_ROW, previewColumn, sheet.getMaxRows() - CALCULATOR_FIRST_ROW + 1, CALCULATOR_PREVIEW_HEADERS.length).clearContent();
  if (!plan.ok) {
    sheet.getRange(CALCULATOR_FIRST_ROW, previewColumn).setValue(plan.error);
    return;
  }
  ensureRows(sheet, CALCULATOR_FIRST_ROW + plan.heats.length - 1);
  sheet
    .getRange(CALCULATOR_FIRST_ROW, previewColumn, plan.heats.length, CALCULATOR_PREVIEW_HEADERS.length)
    .setValues(plan.heats.map((h) => [h.heat, h.date, h.start, h.end]));
}

function onEdit(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== CALCULATOR) return;
  showCalculatorPreview(e.source, e.range.getSheet());
}

function writeHeatsTable(sheet, values) {
  const headers = headerRow(values);
  ensureRows(sheet, values.length);
  sheet.getRange(2, 1, sheet.getMaxRows() - 1, sheet.getMaxColumns()).clearContent();
  ["date", "start", "end"].forEach((name) => sheet.getRange(2, headers.indexOf(name) + 1, sheet.getMaxRows() - 1, 1).setNumberFormat("@"));
  if (values.length > 1) sheet.getRange(2, 1, values.length - 1, headers.length).setValues(values.slice(1));
}

function calculatorClaims(ss, event) {
  return readTable(ss.getSheetByName(SLOTS))
    .filter((slot) => asNumberOrText(slot.event) === event)
    .map((slot) => ({ heat: asNumberOrText(slot.heat), lane: asNumberOrText(slot.lane), team: asText(slot.team) }));
}

function writeCalculatorHeats() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const sheet = ss.getSheetByName(CALCULATOR);
  if (!sheet) {
    ui.alert("There's no Calculator tab yet — run setup() in the script editor first.");
    return;
  }
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    ss.toast("The sheet is busy — try again.", MENU_TITLE, 10);
    return;
  }
  try {
    const plan = calculatorPlan(ss, sheet);
    if (!plan.ok) {
      ui.alert(plan.error);
      return;
    }
    const event = calculatorEvent(sheet);
    const heatsSheet = ss.getSheetByName(HEATS);
    const table = heatsTableAfter({ values: heatsSheet.getDataRange().getValues(), event: event, heats: plan.heats, zone: ss.getSpreadsheetTimeZone() });
    if (!table.ok) {
      ui.alert(table.error);
      return;
    }
    const summary = writeSummary({ event: event, heats: plan.heats, existingHeatCount: table.removed, claims: calculatorClaims(ss, event) });
    if (ui.alert(summary.title, summary.message, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) {
      ss.toast("Nothing changed.", MENU_TITLE, 10);
      return;
    }
    writeHeatsTable(heatsSheet, table.values);
    clearScheduleCache();
    ss.toast("Wrote " + counted(plan.heats.length, "heat") + " for Event " + event + ". Check the site, then 12th State → Update site fallback.", MENU_TITLE, 15);
  } finally {
    lock.releaseLock();
  }
}

function headerRow(values) {
  return (values[0] || []).map((h) => String(h).trim());
}

function readTable(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = headerRow(values);
  return values.slice(1)
    .filter((row) => row.some((cell) => cell !== "" && cell !== null))
    .map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
}

function readSettings(ss) {
  const rows = ss.getSheetByName(SETTINGS).getDataRange().getValues().slice(1);
  return Object.fromEntries(rows.map((row) => [String(row[0]).trim(), row[1]]));
}

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

function asClock(value, sheetZone) {
  if (value instanceof Date) return Utilities.formatDate(value, sheetZone, "HH:mm");
  if (typeof value === "number") {
    const minutes = Math.round(value * 24 * 60);
    return pad2(Math.floor(minutes / 60) % 24) + ":" + pad2(minutes % 60);
  }
  return String(value === undefined || value === null ? "" : value).trim();
}

function asDateString(value, sheetZone) {
  if (value instanceof Date) return Utilities.formatDate(value, sheetZone, "yyyy-MM-dd");
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

function signedUpAtMs(value) {
  const ms = new Date(value).getTime();
  return isNaN(ms) ? Infinity : ms;
}

function bySignedUpAt(a, b) {
  const left = signedUpAtMs(a.signedUpAt);
  const right = signedUpAtMs(b.signedUpAt);
  return left === right ? 0 : left < right ? -1 : 1;
}

function readEvents(ss, sheetZone) {
  const heats = readTable(ss.getSheetByName(HEATS));
  const slots = readTable(ss.getSheetByName(SLOTS)).sort(bySignedUpAt);
  return readTable(ss.getSheetByName(EVENTS_TAB)).map((row) => {
    const number = asNumberOrText(row.event);
    const laneCount = asNumberOrText(row.lanes);
    const capSeconds = asText(row.capSeconds);
    return {
      number: number,
      title: asText(row.title),
      format: asText(row.format),
      scoring: asText(row.scoring),
      rx: asText(row.rx),
      intermediate: asText(row.intermediate),
      scaled: asText(row.scaled),
      lanes: laneCount,
      heats: heats
        .filter((h) => asNumberOrText(h.event) === number)
        .map((h) => readHeat(h, number, laneCount, slots, sheetZone)),
      ...(capSeconds === "" ? {} : { capSeconds: asNumberOrText(capSeconds) }),
    };
  });
}

function readHeat(row, eventNumber, laneCount, slots, sheetZone) {
  const number = asNumberOrText(row.heat);
  const lanes = slots
    .filter((s) => asNumberOrText(s.event) === eventNumber && asNumberOrText(s.heat) === number)
    .map((s) => readLane(s))
    .filter((lane) => Number.isInteger(lane.lane) && lane.lane >= 1 && (typeof laneCount !== "number" || lane.lane <= laneCount))
    .filter((lane, i, all) => all.findIndex((other) => other.lane === lane.lane) === i);
  return { number: number, date: asDateString(row.date, sheetZone), start: asClock(row.start, sheetZone), end: asClock(row.end, sheetZone), lanes: lanes };
}

function readLane(slot) {
  const email = asText(slot.email);
  return {
    lane: asNumberOrText(slot.lane),
    team: asText(slot.team),
    athletes: asText(slot.athletes),
    division: asText(slot.division),
    ...(email === "" ? {} : { email: email }),
  };
}

function readDivisions(ss) {
  return readTable(ss.getSheetByName(DIVISIONS)).map((row) => ({
    name: asText(row.division),
    teamSize: asNumberOrText(row.teamSize),
  }));
}

function readSchedule(ss) {
  const settings = readSettings(ss);
  const sheetZone = ss.getSpreadsheetTimeZone();
  return {
    compName: asText(settings.compName) || DEFAULT_COMP_NAME,
    compDate: asDateString(settings.compDate, sheetZone),
    timeZone: asText(settings.timeZone),
    divisions: readDivisions(ss),
    laneLabel: laneLabelOf(settings),
    signupsOpen: asBoolean(settings.signupsOpen),
    events: readEvents(ss, sheetZone),
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
  if (record.action === "claim") return withLock(() => claimSlot(record));
  if (record.action === "release") return withLock(() => releaseSlot(record));
  return logScore(record);
}

function logScore(record) {
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

function withLock(action) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return reply({ ok: false, error: "The sheet is busy — try again" });
  try {
    return action();
  } catch (err) {
    return reply({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function missingFields(record, required) {
  return required.filter((key) => record[key] === undefined || asText(record[key]) === "");
}

function normalisedEmail(value) {
  return asText(value).toLowerCase();
}

function divisionNames(ss) {
  return readDivisions(ss).map((d) => d.name);
}

function withSchedule(ss, body) {
  return reply({ ...body, schedule: readSchedule(ss) });
}

function laneLabelOf(settings) {
  return asText(settings.laneLabel) || DEFAULT_LANE_LABEL;
}

function findTarget(ss, record, laneLabel) {
  const event = asNumberOrText(record.event);
  const heat = asNumberOrText(record.heat);
  const lane = asNumberOrText(record.lane);
  const eventRow = readTable(ss.getSheetByName(EVENTS_TAB)).find((r) => asNumberOrText(r.event) === event);
  if (!eventRow) return { error: "Event " + event + " does not exist" };
  const heatRow = readTable(ss.getSheetByName(HEATS)).find((r) => asNumberOrText(r.event) === event && asNumberOrText(r.heat) === heat);
  if (!heatRow) return { error: "Event " + event + " Heat " + heat + " does not exist" };
  const laneCount = asNumberOrText(eventRow.lanes);
  if (!Number.isInteger(lane) || lane < 1 || lane > laneCount) return { error: laneLabel + " " + lane + " is outside 1–" + laneCount };
  return { event: event, heat: heat, lane: lane };
}

function slotFromRow(headers, row, rowNumber) {
  const cell = (name) => row[headers.indexOf(name)];
  return {
    row: rowNumber,
    event: asNumberOrText(cell("event")),
    heat: asNumberOrText(cell("heat")),
    lane: asNumberOrText(cell("lane")),
    email: normalisedEmail(cell("email")),
    signedUpAt: cell("signedUpAt"),
  };
}

function slotRowFor(headers, values) {
  return headers.map((name) => (values[name] === undefined ? "" : values[name]));
}

function slotRows(ss) {
  const values = ss.getSheetByName(SLOTS).getDataRange().getValues();
  const headers = headerRow(values);
  const rows = values
    .slice(1)
    .map((row, i) => slotFromRow(headers, row, i + 2))
    .filter((s) => s.event !== "" || s.heat !== "" || s.lane !== "")
    .sort(bySignedUpAt);
  return { headers: headers, rows: rows };
}

function holderOf(slots, target) {
  return slots.find((s) => s.event === target.event && s.heat === target.heat && s.lane === target.lane);
}

function claimSlot(record) {
  const ss = SpreadsheetApp.getActive();
  const setupErr = setupError(ss);
  if (setupErr) return reply({ ok: false, error: setupErr });
  const missing = missingFields(record, CLAIM_REQUIRED);
  if (missing.length > 0) return reply({ ok: false, error: "Missing " + missing.join(", ") });
  const settings = readSettings(ss);
  if (!asBoolean(settings.signupsOpen)) return reply({ ok: false, error: "Sign-ups are closed" });
  const laneLabel = laneLabelOf(settings);
  const target = findTarget(ss, record, laneLabel);
  if (target.error) return reply({ ok: false, error: target.error });
  const divisions = divisionNames(ss);
  if (divisions.indexOf(asText(record.division)) === -1) return reply({ ok: false, error: "Division must be one of " + divisions.join(", ") });
  const email = normalisedEmail(record.email);
  const { headers, rows: slots } = slotRows(ss);
  const holder = holderOf(slots, target);
  if (holder && holder.email === email) return withSchedule(ss, { ok: true, duplicate: true });
  if (holder) return withSchedule(ss, { ok: false, error: laneLabel + " " + target.lane + " was just taken" });
  const elsewhere = slots.find((s) => s.event === target.event && s.email === email);
  if (elsewhere) return withSchedule(ss, { ok: false, error: "You're already in Heat " + elsewhere.heat + " of this event" });
  ss.getSheetByName(SLOTS).appendRow(slotRowFor(headers, {
    event: target.event,
    heat: target.heat,
    lane: target.lane,
    email: asText(record.email),
    team: asText(record.team),
    athletes: asText(record.athletes),
    division: asText(record.division),
    signedUpAt: new Date().toISOString(),
  }));
  clearScheduleCache();
  return withSchedule(ss, { ok: true });
}

function releaseSlot(record) {
  const ss = SpreadsheetApp.getActive();
  const setupErr = setupError(ss);
  if (setupErr) return reply({ ok: false, error: setupErr });
  const missing = missingFields(record, RELEASE_REQUIRED);
  if (missing.length > 0) return reply({ ok: false, error: "Missing " + missing.join(", ") });
  if (!asBoolean(readSettings(ss).signupsOpen)) return reply({ ok: false, error: "Sign-ups are closed" });
  const target = { event: asNumberOrText(record.event), heat: asNumberOrText(record.heat), lane: asNumberOrText(record.lane) };
  const { headers, rows } = slotRows(ss);
  const holder = holderOf(rows, target);
  if (!holder) return withSchedule(ss, { ok: true });
  if (holder.email !== normalisedEmail(record.email)) return withSchedule(ss, { ok: false, error: "That slot isn't yours" });
  const sheet = ss.getSheetByName(SLOTS);
  const currentRow = sheet.getRange(holder.row, 1, 1, headers.length).getValues()[0];
  const current = slotFromRow(headers, currentRow, holder.row);
  const unchanged = current.event === holder.event && current.heat === holder.heat && current.lane === holder.lane && current.email === holder.email;
  if (!unchanged) return withSchedule(ss, { ok: false, error: "The slot changed — reload and try again" });
  sheet.deleteRow(holder.row);
  clearScheduleCache();
  return withSchedule(ss, { ok: true });
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
  setupDivisions(ss);
  setupEvents(ss);
  setupHeats(ss);
  setupCalculator(ss);
  setupSlots(ss);
  setupLog(ss);
  setupResults(ss);
  setupOverall(ss);
  clearScheduleCache();
}

function createIfMissing(ss, name, headers, fill) {
  if (ss.getSheetByName(name)) return;
  const sheet = ss.insertSheet(name);
  writeHeaders(sheet, headers);
  fill(sheet);
}

function setupSettings(ss) {
  createIfMissing(ss, SETTINGS, ["key", "value"], (sheet) => {
    sheet.getRange("A1").setNote("compName the comp title shown on the site · compDate YYYY-MM-DD · timeZone IANA name · laneLabel the word for a lane (Lane, Position, Spot) · signupsOpen checkbox");
  });
  reconcileSettings(ss.getSheetByName(SETTINGS));
}

function reconcileSettings(sheet) {
  const values = sheet.getDataRange().getValues();
  const keyOf = (row) => String(row[0]).trim();
  const kept = values.slice(1).filter((row) => keyOf(row) !== "" && RETIRED_SETTINGS.indexOf(keyOf(row)) === -1);
  const present = kept.map(keyOf);
  const added = SETTINGS_ROWS.filter(([key]) => present.indexOf(key) === -1);
  const rows = kept.concat(added);
  if (values.length > 1) sheet.getRange(2, 1, values.length - 1, values[0].length).clearContent().clearDataValidations();
  if (rows.length === 0) return;
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  rows.forEach((row, i) => {
    const cell = sheet.getRange(2 + i, 2);
    if (keyOf(row) === "signupsOpen") cell.insertCheckboxes().setValue(asBoolean(row[1]));
    else cell.setNumberFormat("@");
  });
}

function setupDivisions(ss) {
  createIfMissing(ss, DIVISIONS, DIVISION_HEADERS, (sheet) => {
    sheet.getRange(2, 1, DIVISION_ROWS.length, 2).setValues(DIVISION_ROWS);
    sheet.getRange("A1").setNote("One row per division. teamSize 1 for individuals, 2 for pairs, and so on — the sign-up form asks for that many names.");
  });
}

function setupEvents(ss) {
  createIfMissing(ss, EVENTS_TAB, EVENT_HEADERS, (sheet) => {
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(SCORING_FORMATS, true).build();
    sheet.getRange("D2:D").setDataValidation(rule);
    sheet.getRange("A1").setNote("One row per event. scoring: time-or-rounds needs capSeconds; rounds-reps leaves it blank. lanes = lanes per heat. Re-run setup() after changing the number of events so Overall gets the right columns. rx / intermediate / scaled are the workout versions; leave intermediate blank if there is none.");
  });
}

function setupHeats(ss) {
  createIfMissing(ss, HEATS, HEAT_HEADERS, (sheet) => {
    sheet.getRange("C2:E").setNumberFormat("@");
    sheet.getRange("A1").setNote("One row per heat. date is YYYY-MM-DD; leave it blank to use Settings → compDate. start/end as 24-hour HH:MM text in the comp time zone, e.g. 08:00 or 13:30.");
  });
}

function setupCalculator(ss) {
  if (ss.getSheetByName(CALCULATOR)) return;
  const sheet = ss.insertSheet(CALCULATOR);
  sheet.getRange("A1").setValue("event").setFontWeight("bold");
  sheet.getRange(3, 1, 1, CALCULATOR_INPUT_HEADERS.length).setValues([CALCULATOR_INPUT_HEADERS]).setFontWeight("bold");
  sheet.getRange(3, CALCULATOR_INPUT_HEADERS.length + 3, 1, CALCULATOR_PREVIEW_HEADERS.length).setValues([CALCULATOR_PREVIEW_HEADERS]).setFontWeight("bold");
  sheet.getRange("A4:B").setNumberFormat("@");
  sheet.getRange("I4:K").setNumberFormat("@");
  sheet.setFrozenRows(3);
  sheet.getRange("A1").setNote(
    "Put the event number in B1. From row 4, one row per block of heats: date (YYYY-MM-DD), start of the first heat (24-hour HH:MM), length of a heat in minutes, buffer minutes between heats, and how many heats. Heat numbers carry on from row to row. The preview on the right updates as you type; 12th State → Write heats to Heats tab replaces this event's heats.",
  );
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
