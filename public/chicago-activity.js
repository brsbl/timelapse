const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const empty = { type: "FeatureCollection", features: [] };

function stationSquare([lon, lat]) {
  const x = 0.00065;
  const y = 0.00049;
  return [[lon - x, lat - y], [lon + x, lat - y], [lon + x, lat + y], [lon - x, lat + y], [lon - x, lat - y]];
}

function compile(gl, kind, source) {
  const shader = gl.createShader(kind);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function createFlowLayer(map) {
  const layer = {
    id: "divvy-flows",
    type: "custom",
    renderingMode: "3d",
    active: false,
    vertices: new Float32Array(),
    onAdd(_, gl) {
      const vertex = compile(gl, gl.VERTEX_SHADER, `
        precision highp float;
        attribute vec3 a_position;
        attribute vec4 a_color;
        uniform mat4 u_matrix;
        uniform float u_scale;
        varying vec4 v_color;
        void main() {
          gl_Position = u_matrix * vec4(a_position * u_scale, 1.0);
          v_color = a_color;
        }
      `);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, `
        precision mediump float;
        varying vec4 v_color;
        void main() { gl_FragColor = v_color; }
      `);
      this.program = gl.createProgram();
      gl.attachShader(this.program, vertex);
      gl.attachShader(this.program, fragment);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      this.buffer = gl.createBuffer();
      this.position = gl.getAttribLocation(this.program, "a_position");
      this.color = gl.getAttribLocation(this.program, "a_color");
      this.matrix = gl.getUniformLocation(this.program, "u_matrix");
      this.scale = gl.getUniformLocation(this.program, "u_scale");
      this.dirty = true;
    },
    render(gl, options) {
      if (!this.active || !this.vertices.length) return;
      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      if (this.dirty) {
        gl.bufferData(gl.ARRAY_BUFFER, this.vertices, gl.DYNAMIC_DRAW);
        this.dirty = false;
      }
      gl.enableVertexAttribArray(this.position);
      gl.enableVertexAttribArray(this.color);
      gl.vertexAttribPointer(this.position, 3, gl.FLOAT, false, 28, 0);
      gl.vertexAttribPointer(this.color, 4, gl.FLOAT, false, 28, 12);
      gl.uniformMatrix4fv(this.matrix, false, options.modelViewProjectionMatrix);
      gl.uniform1f(this.scale, 512 * 2 ** map.getZoom());
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertices.length / 7);
      gl.disableVertexAttribArray(this.position);
      gl.disableVertexAttribArray(this.color);
    },
    onRemove(_, gl) {
      gl.deleteBuffer(this.buffer);
      gl.deleteProgram(this.program);
    },
  };
  map.addLayer(layer);
  return layer;
}

function buildFlowVertices(flows, mercator) {
  const values = [];
  for (const flow of flows) {
    const from = mercator.fromLngLat(flow.from);
    const to = mercator.fromLngLat(flow.to);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const span = Math.hypot(dx, dy);
    if (span < 0.000002) continue;
    const ux = -dy / span;
    const uy = dx / span;
    const meters = from.meterInMercatorCoordinateUnits();
    const width = meters * clamp(14 + Math.sqrt(flow.count) * 4, 16, 42);
    const height = meters * clamp(180 + Math.sqrt(flow.count) * 95, 200, 780);
    const tint = clamp(Math.log1p(flow.count) / 3.8, 0.35, 1);
    const color = [lerp(0.08, 1, tint), lerp(0.77, 0.64, tint), lerp(0.83, 0.28, tint), 0.78];
    const points = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      points.push([lerp(from.x, to.x, t), lerp(from.y, to.y, t), 4 * t * (1 - t) * height]);
    }
    for (let i = 0; i < 24; i++) {
      const a = points[i];
      const b = points[i + 1];
      const leftA = [a[0] - ux * width, a[1] - uy * width, a[2]];
      const rightA = [a[0] + ux * width, a[1] + uy * width, a[2]];
      const leftB = [b[0] - ux * width, b[1] - uy * width, b[2]];
      const rightB = [b[0] + ux * width, b[1] + uy * width, b[2]];
      for (const point of [leftA, rightA, leftB, rightA, rightB, leftB]) values.push(...point, ...color);
    }
  }
  return new Float32Array(values);
}

export async function createChicagoActivity(map, maplibregl, prepare) {
  const [ridership, divvy] = await Promise.all([
    fetch("/data/chicago/ridership.json").then((response) => {
      if (!response.ok) throw new Error("Chicago ridership data missing; run npm run build:activity");
      return response.json();
    }),
    fetch("/data/chicago/divvy.json").then((response) => {
      if (!response.ok) throw new Error("Chicago Divvy data missing; run npm run build:activity");
      return response.json();
    }),
  ]);
  const months = ridership.months;
  const totals = months.map((_, index) => ridership.stations.reduce((sum, station) => sum + (station.values[index] ?? 0), 0));
  const baselineIndex = months.indexOf("2019-09");
  const stationFeatures = ridership.stations.map((station) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [stationSquare(station.coord)] },
    properties: { id: station.id, name: station.name, h: 0, ratio: 1 },
  }));
  map.addSource("station-ridership", { type: "geojson", data: empty });
  map.addLayer({
    id: "station-ridership",
    type: "fill-extrusion",
    source: "station-ridership",
    layout: { visibility: "none" },
    paint: {
      "fill-extrusion-height": ["get", "h"],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.9,
      "fill-extrusion-color": ["interpolate", ["linear"], ["get", "ratio"], 0, "#ff704d", 0.5, "#ffc278", 1, "#67d8ff", 1.4, "#c1f8ff"],
    },
  });
  const flowLayer = createFlowLayer(map);
  const hourlyTrips = divvy.hourlyTrips;
  let lastHour = -1;
  const flowHours = Array.from({ length: 24 }, (_, hour) => divvy.flows
    .filter((flow) => flow.hour === hour && flow.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 100));

  function hide() {
    flowLayer.active = false;
    map.setLayoutProperty("station-ridership", "visibility", "none");
    map.setLayoutProperty("buildings", "visibility", "visible");
  }

  function enter(mode) {
    prepare();
    map.setLayoutProperty("buildings", "visibility", "none");
    map.setLayoutProperty("station-ridership", "visibility", mode === "ridership" ? "visible" : "none");
    flowLayer.active = mode === "divvy";
    map.triggerRepaint();
  }

  const ridershipAct = {
    enter: () => enter("ridership"),
    update(p) {
      const at = clamp(p, 0, 1) * (months.length - 1);
      const index = Math.floor(at);
      const blend = at - index;
      stationFeatures.forEach((feature, i) => {
        const station = ridership.stations[i];
        const rides = lerp(station.values[index] ?? 0, station.values[Math.min(index + 1, months.length - 1)] ?? 0, blend);
        const baseline = station.values[baselineIndex] ?? 1;
        feature.properties.h = Math.max(3, rides / 22);
        feature.properties.ratio = rides / Math.max(1, baseline);
      });
      map.getSource("station-ridership").setData({ type: "FeatureCollection", features: stationFeatures });
      const total = lerp(totals[index], totals[Math.min(index + 1, months.length - 1)], blend);
      return { index, total, at };
    },
    overlay(state) {
      const month = months[state.index];
      return {
        big: month.slice(0, 4),
        suffix: new Date(`${month}-01T00:00:00`).toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase(),
        stat: `${Math.round(state.total).toLocaleString()} weekday station entries`,
        series: totals,
        playhead: state.at / (months.length - 1),
        labels: ["JAN 2019", "MAR 2020", "DEC 2021"],
        credit: "CTA monthly station entries · height = average weekday rides",
      };
    },
  };

  const divvyAct = {
    enter: () => enter("divvy"),
    update(p) {
      const hour = Math.min(23, Math.floor(clamp(p, 0, 0.99999) * 24));
      if (hour !== lastHour) {
        flowLayer.vertices = buildFlowVertices(flowHours[hour], maplibregl.MercatorCoordinate);
        flowLayer.dirty = true;
        lastHour = hour;
      }
      map.triggerRepaint();
      return { hour, count: hourlyTrips[hour] };
    },
    overlay(state) {
      const h12 = state.hour % 12 || 12;
      return {
        big: `${h12}:00`,
        suffix: state.hour < 12 ? "AM" : "PM",
        stat: `${state.count.toLocaleString()} trips starting this hour`,
        series: hourlyTrips,
        playhead: state.hour / 23,
        labels: ["12 AM", "NOON", "11 PM"],
        credit: "Divvy Sep 18 2019 · arcs connect endpoints, not routes",
      };
    },
  };

  return { hide, ridershipAct, divvyAct };
}
