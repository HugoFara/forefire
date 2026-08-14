/**
 * Builds a ForeFire landscape out of satellite imagery, in the browser.
 *
 * There is no NetCDF here and no GIS stack: slippy-map tiles go onto a canvas,
 * the pixels are classified into fuel indices, and the resulting Int32Array is
 * exactly what addIndexLayer takes. It is a crude classifier — greenness, not
 * a land-cover product — but it makes the imagery load-bearing rather than
 * decorative: the fire slows on sparse ground and stops on bare rock, roads
 * and rooftops.
 */

const TILE = 256;
const IMAGERY =
	"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";

/*! Fuel classes, and the table the WindDriven model reads. ROS is
 *  vv_coeff × normal wind, so vv_coeff 0 is a barrier the fire cannot cross. */
export const FUELS = [
	{ index: 1, label: "dense vegetation", vv: 1.0, rgb: [46, 125, 50] },
	{ index: 2, label: "sparse / grass", vv: 0.45, rgb: [190, 180, 70] },
	{ index: 3, label: "bare, built, water", vv: 0.0, rgb: [110, 100, 95] },
];

export const FUELS_TABLE =
	"Index;vv_coeff;Kcurv;beta\n" +
	FUELS.map((f) => `${f.index};${f.vv};1.0;1.0`).join("\n");

/*! Web Mercator: fractional pixel coordinates at a given zoom. */
function project(lon, lat, zoom) {
	const n = 2 ** zoom;
	const rad = (lat * Math.PI) / 180;
	return [
		((lon + 180) / 360) * n * TILE,
		((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n * TILE,
	];
}

/*! Ground resolution in metres per pixel, which is what ties the tile grid to
 *  the simulation's Cartesian metres. */
function resolution(lat, zoom) {
	return (156543.03392804097 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

function loadTile(zoom, x, y) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		// Required to read the pixels back out; Esri's tiles send
		// Access-Control-Allow-Origin, so the canvas stays untainted.
		img.crossOrigin = "anonymous";
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`tile ${zoom}/${x}/${y} failed`));
		img.src = `${IMAGERY}/${zoom}/${y}/${x}`;
	});
}

/*!
 * Fetch the imagery covering a `side`-metre square centred on (lon, lat) and
 * derive a fuel map from it.
 *
 * Returns { image, fuel, nx, ny, counts }, where `image` is the imagery canvas
 * for display and `fuel` is the (t,z,y,x)-ordered index array for the layer.
 * Throws if the tiles cannot be fetched, so the caller can fall back.
 */
export async function buildLandscape({ lon, lat, side, zoom, grid }) {
	const metresPerPx = resolution(lat, zoom);
	const sidePx = Math.round(side / metresPerPx);
	const [cx, cy] = project(lon, lat, zoom);
	const left = cx - sidePx / 2;
	const top = cy - sidePx / 2;

	const image = document.createElement("canvas");
	image.width = image.height = sidePx;
	const ictx = image.getContext("2d");

	const x0 = Math.floor(left / TILE);
	const x1 = Math.floor((left + sidePx) / TILE);
	const y0 = Math.floor(top / TILE);
	const y1 = Math.floor((top + sidePx) / TILE);

	const jobs = [];
	for (let ty = y0; ty <= y1; ty++)
		for (let tx = x0; tx <= x1; tx++)
			jobs.push(
				loadTile(zoom, tx, ty).then((img) =>
					ictx.drawImage(img, tx * TILE - left, ty * TILE - top)
				)
			);
	await Promise.all(jobs);

	// Resample to the simulation grid, then classify. Downsampling first means
	// each fuel cell averages its footprint instead of sampling one pixel of it.
	const small = document.createElement("canvas");
	small.width = small.height = grid;
	const sctx = small.getContext("2d");
	sctx.drawImage(image, 0, 0, grid, grid);
	const px = sctx.getImageData(0, 0, grid, grid).data;

	const fuel = new Int32Array(grid * grid);
	const counts = { 1: 0, 2: 0, 3: 0 };
	for (let row = 0; row < grid; row++) {
		// Image rows run north to south; the fuel array's row 0 is the domain's
		// south edge, so the vertical order flips here.
		const y = grid - 1 - row;
		for (let x = 0; x < grid; x++) {
			const i = (row * grid + x) * 4;
			const r = px[i];
			const g = px[i + 1];
			const b = px[i + 2];
			// Excess green separates vegetation from rock, road and roof about
			// as well as anything this cheap can. Water lands below both cuts.
			const excessGreen = g - (r + b) / 2;
			const index = excessGreen >= 20 ? 1 : excessGreen >= 10 ? 2 : 3;
			fuel[x + grid * y] = index;
			counts[index]++;
		}
	}

	return { image, fuel, nx: grid, ny: grid, counts, metresPerPx, sidePx };
}

/*! A translucent raster of the fuel classes, drawn at simulation resolution and
 *  scaled up by the caller. */
export function fuelOverlay(fuel, grid) {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = grid;
	const ctx = canvas.getContext("2d");
	const img = ctx.createImageData(grid, grid);
	const palette = Object.fromEntries(FUELS.map((f) => [f.index, f.rgb]));
	for (let row = 0; row < grid; row++) {
		const y = grid - 1 - row; // back to image order
		for (let x = 0; x < grid; x++) {
			const [r, g, b] = palette[fuel[x + grid * y]];
			const i = (row * grid + x) * 4;
			img.data[i] = r;
			img.data[i + 1] = g;
			img.data[i + 2] = b;
			img.data[i + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}
