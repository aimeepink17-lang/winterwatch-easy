(function (root) {
  const clock = typeof module !== "undefined" ? require("./clock.js") : root.WinterClock;
  const fields = ["soil_temperature_0cm", "temperature_2m", "dew_point_2m", "rain"];
  const displayTime = epoch => clock.stamp(epoch).replace("T", " ");

  function requestUrl(routes) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: routes.map(route => route.latitude).join(","),
      longitude: routes.map(route => route.longitude).join(","),
      hourly: fields.join(","), timezone: "GMT", timeformat: "unixtime", forecast_days: "3"
    });
    return url;
  }

  function analyze(payload, routes, date) {
    if (!Array.isArray(payload) || payload.length !== routes.length) {
      throw new Error("Open-Meteo did not return one forecast per route.");
    }
    return routes.map((route, index) => {
      const forecast = payload[index];
      const id = forecast?.location_id ?? (index === 0 ? 0 : null);
      const gap = Math.hypot(forecast?.latitude - route.latitude,
        (forecast?.longitude - route.longitude) * Math.cos(route.latitude * Math.PI / 180));
      if (id !== index || !Number.isFinite(gap) || gap > 0.05) {
        throw new Error(`Open-Meteo location order could not be verified for ${route.id}.`);
      }
      const h = forecast.hourly;
      if (!h || !Array.isArray(h.time) || h.time.some(t => !Number.isSafeInteger(t)) ||
          new Set(h.time).size !== h.time.length ||
          fields.some(field => !Array.isArray(h[field]) || h[field].length !== h.time.length)) {
        throw new Error(`Open-Meteo returned invalid hourly arrays for ${route.id}.`);
      }
      const readings = h.time.map((time, i) => ({
        epoch: time * 1000, soil: h.soil_temperature_0cm[i], dew: h.dew_point_2m[i], rain: h.rain[i]
      }));
      const result = clock.evaluate(date, readings, { priority: route.priority, stock: route.stock, lengthKm: route.lengthKm });
      const air = h.time.flatMap((time, i) =>
        time * 1000 >= result.start && time * 1000 <= result.end && Number.isFinite(h.temperature_2m[i])
          ? [h.temperature_2m[i]] : []);
      const returned = new Set(readings.map(row => row.epoch));
      const missingHours = result.rows.filter(row => !returned.has(row.epoch)).length;
      const missingDew = result.rows.filter(row => !Number.isFinite(row.dew)).length;
      const missingRain = result.rows.slice(1).filter(row => !Number.isFinite(row.rain)).length;
      const rain = result.rows.slice(1).find(row => row.rain > 0);
      const dew = result.rows.find(row => Number.isFinite(row.soil) && Number.isFinite(row.dew) &&
        Math.round(Math.abs(row.soil - row.dew) * 1e9) <= 1e9);
      const wetness = rain ? `${rain.rain} mm rain in hour ending ${displayTime(rain.epoch)}` :
        dew ? `${Math.abs(dew.soil - dew.dew).toFixed(1)} °C soil–dew gap at ${displayTime(dew.epoch)}` :
        result.wet === null ? "Wetness unresolved" : "No qualifying rain or soil–dew gap";
      return { route, result, wetness, missingHours, missingDew, missingRain, minAir: air.length ? Math.min(...air) : null };
    });
  }

  const api = { requestUrl, analyze, displayTime };
  if (typeof module !== "undefined") module.exports = api;
  else root.WinterLive = api;
})(globalThis);
