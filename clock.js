(function (root) {
  const hour = 3600000;
  const minute = 60000;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });

  function stamp(epoch) {
    const parts = Object.fromEntries(formatter.formatToParts(epoch).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  }

  function dublinHour(date, time) {
    const target = `${date}T${time}`;
    const approximate = Date.parse(target + "Z");
    for (let offset = -2; offset <= 2; offset++) {
      const candidate = approximate + offset * hour;
      if (stamp(candidate) === target) return candidate;
    }
    throw new Error(`Dublin hour unavailable: ${target}`);
  }

  function bounds(date) {
    const tomorrow = new Date(Date.parse(date + "T00:00Z") + 24 * hour).toISOString().slice(0, 10);
    return {
      start: dublinHour(date, "16:00"), end: dublinHour(tomorrow, "06:00"),
      open: dublinHour(date, "17:00"), close: dublinHour(tomorrow, "05:00")
    };
  }

  function weather(rows, priority, stock) {
    const threshold = { 1: 1, 2: 0.5, 3: -1 }[priority];
    const minimum = rows.filter(row => Number.isFinite(row.soil))
      .reduce((best, row) => !best || row.soil < best.soil ? row : best, null);
    const wet = rows.some(row => row.rain > 0 || (
      Number.isFinite(row.soil) && Number.isFinite(row.dew) &&
      Math.round(Math.abs(row.soil - row.dew) * 1e9) <= 1e9
    )) ? true : rows.some(row => !Number.isFinite(row.rain) ||
      !Number.isFinite(row.soil) || !Number.isFinite(row.dew)) ? null : false;
    const cold = minimum && minimum.soil <= threshold ? true :
      rows.every(row => Number.isFinite(row.soil)) ? false : null;
    const stockAllows = priority !== 3 ? true : Number.isFinite(stock) ? stock >= 40 : null;
    const checks = [cold, wet, stockAllows];
    const recommendation = checks.includes(false) ? "No treatment indicated" :
      checks.every(value => value === true) ? "Treatment indicated" : "Decision pending";
    return { recommendation, minimum, threshold, cold, wet, missingSoil: rows.filter(row => !Number.isFinite(row.soil)).length };
  }

  function evaluate(date, readings, { priority, stock, lengthKm }) {
    const window = bounds(date);
    const source = new Map(readings.map(row => [row.epoch, row]));
    const antecedentRain = source.get(window.start)?.rain ?? null;
    const rows = [];
    for (let epoch = window.start; epoch <= window.end; epoch += hour) {
      const row = source.get(epoch);
      rows.push({ epoch, soil: row?.soil ?? null, dew: row?.dew ?? null,
        rain: epoch === window.start ? 0 : row?.rain ?? null });
    }
    const result = weather(rows, priority, stock);
    const freezeIndex = rows.findIndex(row => Number.isFinite(row.soil) && row.soil <= 0);
    const freeze = freezeIndex < 0 ? null : rows[freezeIndex].epoch;
    const timing = { freeze, status: "no-freeze", departure: null, upperBound: null };
    if (freeze === null) {
      if (result.missingSoil) timing.status = "incomplete";
    } else {
      const latest = freeze - hour - lengthKm / 20 * hour;
      timing.upperBound = latest;
      if (freezeIndex === 0) timing.status = "already-freezing";
      else if (rows.slice(0, freezeIndex).some(row => !Number.isFinite(row.soil))) timing.status = "uncertain-onset";
      else if (latest < window.open) timing.status = "too-early";
      else {
        timing.status = "available";
        timing.departure = Math.min(window.close, latest);
      }
    }
    return { ...result, ...window, timing, antecedentRain, rows };
  }

  const date = "2026-11-21";
  const scenarios = [
    { name: "18:00 freeze", description: "16:00 soil is +3.0 °C. At 18:00 it reaches 0.0 °C with 0.2 mm of in-window rain.", startSoil: 3 },
    { name: "0 °C at start", description: "The first soil reading is exactly 0.0 °C at 16:00. The onset could have been earlier.", startSoil: 0 },
    { name: "Missing first reading", description: "The 16:00 soil reading is missing. The first known reading at or below zero is 18:00.", startSoil: null },
    { name: "Pending with missing soil", description: "The 16:00 soil reading is missing. All available soil readings are +3.0 °C, and 0.2 mm of in-window rain establishes possible wetness.", startSoil: null, noFreeze: true }
  ];
  function example(index) {
    const { start, end } = bounds(date);
    const rows = [];
    for (let epoch = start; epoch <= end; epoch += hour) {
      const elapsed = (epoch - start) / hour;
      rows.push({ epoch, soil: elapsed === 0 ? scenarios[index].startSoil : elapsed === 2 && !scenarios[index].noFreeze ? 0 : 3,
        dew: -3, rain: elapsed === 0 ? 0.4 : elapsed === 2 ? 0.2 : 0 });
    }
    return evaluate(date, rows, { priority: 1, lengthKm: 14 });
  }

  const api = { evaluate, weather, stamp, bounds, scenarios, example };
  if (typeof module !== "undefined") module.exports = api;
  else root.WinterClock = api;
})(globalThis);
