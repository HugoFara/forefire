/**
 * Simulation worker for the browser demo (issue #171).
 *
 * The engine runs here rather than on the main thread. A step over a few
 * thousand front nodes costs tens to hundreds of milliseconds, which would
 * stutter the page and freeze the controls if it ran inline. Off the main
 * thread, the canvas keeps painting and the wind stays draggable while the
 * solver works.
 *
 * The fuel map arrives from the main thread, which is where it has to be built:
 * classifying satellite imagery needs a canvas, and workers have no DOM.
 */

import createForeFire from "./forefire.mjs";

let Module = null;
let ff = null;
let running = false;
let step = 0;
let dt = 15;
let wind = { speed: 20, angleDeg: 0, turning: true, turnPerStep: 12 };

// Replaced by the real landscape as soon as the main thread has one; until
// then a uniform burnable field, so the demo works offline.
let land = {
	side: 4000,
	nx: 200,
	ny: 200,
	fuel: null,
	fuelsTable: "Index;vv_coeff;Kcurv;beta\n1;1.0;1.0;1.0",
};

/*! Rebuild a domain from scratch. Cheap enough to do on every reset. */
function reset() {
	const { side, nx, ny } = land;
	ff = new Module.ForeFire();

	ff.setString("fuelsTable", land.fuelsTable);
	ff.setDouble("defaultFuelType", 1);
	for (const [key, value] of Object.entries({
		spatialIncrement: 0.5,
		minimalPropagativeFrontDepth: 10,
		perimeterResolution: 10,
		initialFrontDepth: 0.1,
		relax: 1,
		smoothing: 0,
		minSpeed: 0,
		bmapLayer: 1,
		windReductionFactor: 1,
	}))
		ff.setDouble(key, value);
	ff.setString("propagationModel", "WindDriven");

	ff.execute(`FireDomain[sw=(0,0,0);ne=(${side},${side},0);t=0]`);

	const fuel = land.fuel ? land.fuel : new Int32Array(nx * ny).fill(1);
	// Two-plane wind layers: plane 0 carries the u response, plane 1 the v.
	const windU = new Float64Array(2 * nx * ny);
	windU.fill(1, 0, nx * ny);
	const windV = new Float64Array(2 * nx * ny);
	windV.fill(1, nx * ny);

	const S = side;
	const ok = [
		ff.addLayer("propagation", "WindDriven", "propagationModel"),
		ff.addIndexLayer("table", "fuel", 0, 0, 0, S, S, 0, nx, ny, 1, 1, fuel),
		ff.addScalarLayer("windScalDir", "windU", 0, 0, 0, S, S, 0, nx, ny, 2, 1, windU),
		ff.addScalarLayer("windScalDir", "windV", 0, 0, 0, S, S, 0, nx, ny, 2, 1, windV),
	];
	if (ok.some((v) => !v)) throw new Error("a layer failed to register");

	ff.execute(`startFire[loc=(${side / 2},${side / 2},0.);t=0]`);
	step = 0;
	postFrame(0);
}

/*! Split print[] into one coordinate array per front.
 *
 *  Fronts nest — an inner front is printed indented inside its parent — so
 *  every FireFront line starts a fresh polygon. Running them together is what
 *  draws spurious chords straight across the burn.
 */
function parseFronts(text) {
	const fronts = [];
	let current = null;
	for (const line of text.split("\n")) {
		if (line.includes("FireFront[")) {
			current = [];
			fronts.push(current);
		} else if (current && line.includes("FireNode[")) {
			const m = /loc=\(([-\d.eE+]+),([-\d.eE+]+),/.exec(line);
			if (m) current.push(parseFloat(m[1]), parseFloat(m[2]));
		}
	}
	// A front of one or two nodes is a degenerate sliver, not a perimeter.
	return fronts.filter((f) => f.length >= 6).map((f) => Float32Array.from(f));
}

function currentWindVector() {
	// Wrapped, or a turning run reports "864°" after an hour of simulated time.
	const deg = (wind.turning ? step * wind.turnPerStep : wind.angleDeg) % 360;
	const rad = (deg * Math.PI) / 180;
	return [wind.speed * Math.cos(rad), wind.speed * Math.sin(rad), deg];
}

function postFrame(ms) {
	const [vx, vy, deg] = currentWindVector();
	const fronts = parseFronts(ff.execute("print[]"));
	const nodes = fronts.reduce((n, f) => n + f.length / 2, 0);
	self.postMessage(
		{
			type: "frame",
			t: ff.getTime(),
			step,
			ms,
			nodes,
			fronts,
			wind: { vx, vy, deg, speed: wind.speed },
			domain: land.side,
		},
		fronts.map((f) => f.buffer)
	);
}

function tick() {
	if (!running || !ff) return;
	const started = performance.now();
	const [vx, vy] = currentWindVector();
	ff.execute(`trigger[wind;loc=(0.,0.,0.);vel=(${vx.toFixed(4)},${vy.toFixed(4)},0)]`);
	ff.execute(`step[dt=${dt}]`);
	step += 1;
	postFrame(performance.now() - started);
	// Yield between steps so control messages land promptly; without this the
	// worker would never drain its queue and the wind sliders would do nothing.
	setTimeout(tick, 0);
}

self.onmessage = (event) => {
	const msg = event.data;
	switch (msg.type) {
		case "landscape":
			running = false;
			// Kept, not consumed: every later reset rebuilds the domain from it.
			land = { side: msg.side, nx: msg.nx, ny: msg.ny, fuel: msg.fuel, fuelsTable: msg.fuelsTable };
			reset();
			break;
		case "reset":
			running = false;
			reset();
			break;
		case "play":
			if (!running) {
				running = true;
				tick();
			}
			break;
		case "pause":
			running = false;
			break;
		case "wind":
			wind = { ...wind, ...msg.wind };
			break;
		case "dt":
			dt = msg.dt;
			break;
	}
};

Module = await createForeFire();
reset();
self.postMessage({ type: "ready", version: Module.version() });
