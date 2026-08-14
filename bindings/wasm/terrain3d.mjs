/**
 * A small WebGL terrain view for the browser demo (issue #171).
 *
 * The elevation field the simulation runs on is drawn as a mesh, textured with
 * whatever the 2D view painted — imagery, fuel, burnt area, fronts. One
 * drawing path, two presentations: the map is rendered once to an offscreen
 * canvas and uploaded here as a texture, so the two views can never disagree.
 *
 * Deliberately no library: the whole thing is a textured heightfield with one
 * directional light, which is not worth a megabyte of dependency.
 */

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec2 aUV;
uniform mat4 uMVP;
varying vec2 vUV;
varying float vShade;
void main() {
  vUV = aUV;
  vec3 sun = normalize(vec3(-0.6, 0.5, 0.62));
  // Lifted off zero so shadowed faces stay legible rather than going black.
  vShade = 0.55 + 0.45 * max(dot(normalize(aNormal), sun), 0.0);
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uMap;
varying vec2 vUV;
varying float vShade;
void main() {
  vec4 c = texture2D(uMap, vUV);
  gl_FragColor = vec4(c.rgb * vShade, 1.0);
}`;

function compile(gl, type, src) {
	const s = gl.createShader(type);
	gl.shaderSource(s, src);
	gl.compileShader(s);
	if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
		throw new Error("shader: " + gl.getShaderInfoLog(s));
	return s;
}

/*! Column-major, like everything else here and like uniformMatrix4fv with
 *  transpose=false: element (row r, column c) lives at index c*4 + r. Indexing
 *  this the other way round still type-checks and still produces a matrix; it
 *  just projects the mesh into streaks radiating from a vanishing point. */
function multiply(a, b) {
	const o = new Float32Array(16);
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
			o[c * 4 + r] = sum;
		}
	return o;
}

function perspective(fovy, aspect, near, far) {
	const f = 1 / Math.tan(fovy / 2);
	return new Float32Array([
		f / aspect, 0, 0, 0,
		0, f, 0, 0,
		0, 0, (far + near) / (near - far), -1,
		0, 0, (2 * far * near) / (near - far), 0,
	]);
}

function lookAt(eye, target, up) {
	const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
	const norm = (v) => {
		const l = Math.hypot(...v) || 1;
		return [v[0] / l, v[1] / l, v[2] / l];
	};
	const cross = (a, b) => [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
	const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	const z = norm(sub(eye, target));
	const x = norm(cross(up, z));
	const y = cross(z, x);
	return new Float32Array([
		x[0], y[0], z[0], 0,
		x[1], y[1], z[1], 0,
		x[2], y[2], z[2], 0,
		-dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
	]);
}

/*!
 * The full model-view-projection for a camera orbiting the origin.
 *
 * Exported so it can be checked without a GL context: feed it corners of the
 * mesh and confirm they land inside the clip volume. That is the test the
 * column-major slip above would have failed.
 */
export function mvpFor({ azimuth, elevation, distance, aspect, exaggeration, side }) {
	const eye = [
		distance * Math.cos(elevation) * Math.sin(azimuth),
		-distance * Math.cos(elevation) * Math.cos(azimuth),
		distance * Math.sin(elevation),
	];
	const view = multiply(
		perspective(Math.PI / 4, aspect, 0.05, 20),
		lookAt(eye, [0, 0, 0], [0, 0, 1])
	);
	// x and y are a unit square standing for `side` metres, while z is still
	// metres; dividing by `side` puts them back in proportion, and the
	// exaggeration then lifts the relief to something readable.
	const zScale = exaggeration / side;
	const model = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, zScale, 0, 0, 0, 0, 1]);
	return multiply(view, model);
}

/*! Apply a column-major 4x4 to a point, returning normalised device
 *  coordinates and the clip-space w (positive means in front of the camera). */
export function projectPoint(m, [x, y, z]) {
	const c = [0, 1, 2, 3].map((r) => m[0 + r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
	return { ndc: [c[0] / c[3], c[1] / c[3], c[2] / c[3]], w: c[3] };
}

/*!
 * Build the terrain view.
 *
 * `altitude` is the simulation's elevation field in (t,z,y,x) order — row 0 at
 * the domain's south edge — `grid` its side, `side` the domain in metres.
 * Returns { setMap, render, orbit, zoom, setExaggeration, dispose }, or throws
 * if WebGL is unavailable so the caller can stay in 2D.
 */
export function createTerrainView(canvas, { altitude, grid, side, resolution = 129 }) {
	const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
	if (!gl) throw new Error("WebGL unavailable");

	const program = gl.createProgram();
	gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
	gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS))
		throw new Error("link: " + gl.getProgramInfoLog(program));

	// Sample the elevation field down to the mesh resolution.
	const N = Math.min(resolution, grid);
	const at = (ix, iy) => {
		const x = Math.min(grid - 1, Math.round((ix / (N - 1)) * (grid - 1)));
		const y = Math.min(grid - 1, Math.round((iy / (N - 1)) * (grid - 1)));
		return altitude[x + grid * y];
	};

	let lo = Infinity;
	let hi = -Infinity;
	for (const v of altitude) {
		if (v < lo) lo = v;
		if (v > hi) hi = v;
	}
	const mid = (lo + hi) / 2;

	// Positions are normalised to a unit square in x/y so the camera framing is
	// independent of the domain size; heights stay in metres, scaled at draw
	// time by the exaggeration.
	const positions = new Float32Array(N * N * 3);
	const uvs = new Float32Array(N * N * 2);
	for (let iy = 0; iy < N; iy++)
		for (let ix = 0; ix < N; ix++) {
			const i = iy * N + ix;
			positions[i * 3] = ix / (N - 1) - 0.5;
			positions[i * 3 + 1] = iy / (N - 1) - 0.5;
			positions[i * 3 + 2] = at(ix, iy) - mid;
			uvs[i * 2] = ix / (N - 1);
			// The texture is the map as drawn, whose rows run north to south;
			// the mesh's y runs south to north, so v flips.
			uvs[i * 2 + 1] = 1 - iy / (N - 1);
		}

	const indices = [];
	for (let iy = 0; iy < N - 1; iy++)
		for (let ix = 0; ix < N - 1; ix++) {
			const a = iy * N + ix;
			indices.push(a, a + 1, a + N, a + 1, a + N + 1, a + N);
		}
	const indexArray = N * N > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
	const uintExt = N * N > 65535 ? gl.getExtension("OES_element_index_uint") : true;
	if (!uintExt) throw new Error("mesh too large for this WebGL context");

	// Normals are computed once on the CPU: the terrain never changes, and this
	// keeps the vertex shader to a single matrix multiply.
	const cell = side / (N - 1);
	const normals = new Float32Array(N * N * 3);
	for (let iy = 0; iy < N; iy++)
		for (let ix = 0; ix < N; ix++) {
			const i = iy * N + ix;
			const dzdx = (at(Math.min(N - 1, ix + 1), iy) - at(Math.max(0, ix - 1), iy)) / (2 * cell);
			const dzdy = (at(ix, Math.min(N - 1, iy + 1)) - at(ix, Math.max(0, iy - 1))) / (2 * cell);
			const l = Math.hypot(-dzdx, -dzdy, 1);
			normals[i * 3] = -dzdx / l;
			normals[i * 3 + 1] = -dzdy / l;
			normals[i * 3 + 2] = 1 / l;
		}

	const buffer = (data, target = gl.ARRAY_BUFFER) => {
		const b = gl.createBuffer();
		gl.bindBuffer(target, b);
		gl.bufferData(target, data, gl.STATIC_DRAW);
		return b;
	};
	const posBuf = buffer(positions);
	const normBuf = buffer(normals);
	const uvBuf = buffer(uvs);
	const idxBuf = buffer(indexArray, gl.ELEMENT_ARRAY_BUFFER);

	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	// No mipmaps and clamped edges: the map canvas is not power-of-two.
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

	const loc = {
		pos: gl.getAttribLocation(program, "aPos"),
		normal: gl.getAttribLocation(program, "aNormal"),
		uv: gl.getAttribLocation(program, "aUV"),
		mvp: gl.getUniformLocation(program, "uMVP"),
		map: gl.getUniformLocation(program, "uMap"),
	};

	const camera = { azimuth: -0.6, elevation: 0.72, distance: 1.9 };
	let exaggeration = 2.5;
	let mapReady = false;

	gl.enable(gl.DEPTH_TEST);
	gl.clearColor(0.05, 0.04, 0.03, 1);

	function setMap(source) {
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
		mapReady = true;
	}

	function render() {
		if (!mapReady) return;
		const w = canvas.width;
		const h = canvas.height;
		gl.viewport(0, 0, w, h);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		const final = mvpFor({ ...camera, aspect: w / h, exaggeration, side });

		gl.useProgram(program);
		gl.uniformMatrix4fv(loc.mvp, false, final);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.uniform1i(loc.map, 0);

		const bind = (buf, index, size) => {
			gl.bindBuffer(gl.ARRAY_BUFFER, buf);
			gl.enableVertexAttribArray(index);
			gl.vertexAttribPointer(index, size, gl.FLOAT, false, 0, 0);
		};
		bind(posBuf, loc.pos, 3);
		bind(normBuf, loc.normal, 3);
		bind(uvBuf, loc.uv, 2);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
		gl.drawElements(
			gl.TRIANGLES,
			indexArray.length,
			indexArray.BYTES_PER_ELEMENT === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
			0
		);
	}

	return {
		setMap,
		render,
		orbit(dAz, dEl) {
			camera.azimuth += dAz;
			// Stop short of straight down, where the up vector degenerates.
			camera.elevation = Math.max(0.08, Math.min(1.45, camera.elevation + dEl));
		},
		zoom(factor) {
			// The near limit stops short of the point where the mesh's corners
			// all leave the frame and the view loses its footing.
			camera.distance = Math.max(0.9, Math.min(5, camera.distance * factor));
		},
		setExaggeration(v) {
			exaggeration = v;
		},
		elevationRange: { lo, hi },
	};
}
