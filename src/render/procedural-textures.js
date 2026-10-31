// Albedo maps are seen from orbit down to the ground, at grazing angles where the
// mip comes from the largest screen-space derivative. At anisotropy 1 that picks
// visible concentric rings around the horizon, so use the GPU's 16x, which costs nothing extra in memory.
function applyMaxAnisotropy(texture) {
    if (!texture) return texture;
    let max = 1;
    try {
        if (typeof renderer !== "undefined" && renderer.capabilities?.getMaxAnisotropy) {
            max = renderer.capabilities.getMaxAnisotropy() || 1;
        }
    } catch (error) { /* no renderer yet: leave the default */ }
    texture.anisotropy = Math.max(texture.anisotropy || 1, Math.min(16, max));
    return texture;
}

function createCanvasTexture(width, height, drawFn) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    drawFn(ctx, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    applyMaxAnisotropy(texture);
    return texture;
}

// The pattern itself lives in render/clouds/cloud-field.js: it is the piece
// with the measured numbers in it, and it is dense enough to want its own file.
// This is the cache and the naming, nothing else.
function createEarthCloudTexture(options) {
    if (proceduralTextures["earth-clouds"]) return proceduralTextures["earth-clouds"];
    const texture = createCloudFieldTexture(THREE, options || {});
    texture.userData.cloudMaskChannel = "rgb";
    proceduralTextures["earth-clouds"] = texture;
    return texture;
}

function createThemeGradientBackground() {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * .75);
    g.addColorStop(0, "#1e1e1e");
    g.addColorStop(.45, "#161616");
    g.addColorStop(.75, "#0d0d0d");
    g.addColorStop(1, "#050505");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
}

function drawMercuryTexture(ctx, w, h) {
    ctx.fillStyle = "#9a9a9a";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 200; i++) {
        const x = Math.random() * w, y = Math.random() * h, r = 3 + Math.random() * 15;
        const dark = Math.random() > .5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = dark ? `rgba(80,80,80,${.2 + Math.random() * .4})` : `rgba(180,180,180,${.15 + Math.random() * .3})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, r * .7, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(60,60,60,${.3})`;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function drawVenusCloudTexture(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "#e9e5dc");
    base.addColorStop(.18, "#f6f3eb");
    base.addColorStop(.42, "#fffdf6");
    base.addColorStop(.63, "#f4f0e7");
    base.addColorStop(.84, "#fbf8f0");
    base.addColorStop(1, "#e8e3d9");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
        const latitude = y / Math.max(1, h - 1);
        const broadBand = Math.sin(latitude * Math.PI * 14 + .3) * .5 + .5;
        const alpha = .012 + broadBand * .022;
        ctx.fillStyle = `rgba(151,139,120,${alpha})`;
        ctx.fillRect(0, y, w, 1);
    }
    for (let band = 0; band < 88; band++) {
        const y0 = (band + .5) * h / 88;
        const phase = band * 2.399963229728653;
        const amplitude = 1.2 + (band % 5) * .55;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
            const u = x / w;
            const wave = Math.sin(u * Math.PI * 6 + phase) * amplitude + Math.sin(u * Math.PI * 14 + phase * .7) * amplitude * .32;
            const y = y0 + wave;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = band % 4 === 0 ? "rgba(158,145,126,0.12)" : "rgba(255,255,255,0.16)";
        ctx.lineWidth = band % 6 === 0 ? 2 : 1;
        ctx.stroke();
    }
}

function drawVenusTexture(ctx, w, h) {
    drawVenusCloudTexture(ctx, w, h);
}

function drawEarthTexture(ctx, w, h) {
    const oceanGrad = ctx.createLinearGradient(0, 0, 0, h);
    oceanGrad.addColorStop(0, "#1a5c9e");
    oceanGrad.addColorStop(.5, "#1e7bc4");
    oceanGrad.addColorStop(1, "#1a5c9e");
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, 0, w, h);
    const continents = [ {
        x: w * .25,
        y: h * .35,
        rx: w * .22,
        ry: h * .15,
        rot: .3,
        color: "#3d8b40"
    }, {
        x: w * .6,
        y: h * .3,
        rx: w * .25,
        ry: h * .2,
        rot: -.2,
        color: "#4a8f3d"
    }, {
        x: w * .35,
        y: h * .65,
        rx: w * .18,
        ry: h * .12,
        rot: .5,
        color: "#5a9a45"
    }, {
        x: w * .7,
        y: h * .6,
        rx: w * .15,
        ry: h * .18,
        rot: -.4,
        color: "#3d7a35"
    }, {
        x: w * .5,
        y: h * .45,
        rx: w * .1,
        ry: h * .08,
        rot: .1,
        color: "#6aad50"
    }, {
        x: w * .15,
        y: h * .5,
        rx: w * .12,
        ry: h * .1,
        rot: -.3,
        color: "#4a8f3d"
    }, {
        x: w * .45,
        y: h * .2,
        rx: w * .15,
        ry: h * .08,
        rot: .2,
        color: "#558f38"
    } ];
    continents.forEach(c => {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, c.rx, c.ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = c.color;
        ctx.fill();
        for (let i = 0; i < 15; i++) {
            const ox = (Math.random() - .5) * c.rx * 1.5, oy = (Math.random() - .5) * c.ry * 1.5;
            if (Math.abs(ox) < c.rx * .6 && Math.abs(oy) < c.ry * .6) {
                ctx.beginPath();
                ctx.ellipse(ox, oy, c.rx * .2, c.ry * .25, 0, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(60,120,50,${.3 + Math.random() * .3})`;
                ctx.fill();
            }
        }
        ctx.restore();
    });
    ctx.fillStyle = "rgba(240,245,255,0.7)";
    ctx.fillRect(0, 0, w, h * .06);
    ctx.fillRect(0, h * .94, w, h * .06);
    for (let i = 0; i < 40; i++) {
        const x = Math.random() * w, y = Math.random() * h, rx = 20 + Math.random() * 60, ry = 5 + Math.random() * 15;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${.1 + Math.random() * .2})`;
        ctx.fill();
    }
}

function drawMarsTexture(ctx, w, h) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#d4703a");
    grad.addColorStop(.4, "#c45030");
    grad.addColorStop(.7, "#b84028");
    grad.addColorStop(1, "#a03020");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 100; i++) {
        const x = Math.random() * w, y = Math.random() * h, r = 5 + Math.random() * 25;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(130,50,30,${.2 + Math.random() * .4})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, r * .6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,100,60,${.15 + Math.random() * .25})`;
        ctx.fill();
    }
    ctx.fillStyle = "rgba(240,240,250,0.6)";
    ctx.fillRect(0, 0, w, h * .05);
    for (let i = 0; i < 30; i++) {
        const x = Math.random() * w, y = Math.random() * h, rx = 30 + Math.random() * 80, ry = 15 + Math.random() * 40;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, Math.random() * .5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(100,30,20,${.1 + Math.random() * .2})`;
        ctx.fill();
    }
}

function drawJupiterTexture(ctx, w, h) {
    const bands = [ {
        y: 0,
        color: "#c8a070"
    }, {
        y: .08,
        color: "#e8d0b0"
    }, {
        y: .18,
        color: "#b89060"
    }, {
        y: .3,
        color: "#f0e0c0"
    }, {
        y: .42,
        color: "#c49868"
    }, {
        y: .55,
        color: "#e0c8a0"
    }, {
        y: .65,
        color: "#a88050"
    }, {
        y: .75,
        color: "#d8bc90"
    }, {
        y: .85,
        color: "#b89060"
    }, {
        y: .92,
        color: "#e0c8a0"
    }, {
        y: 1,
        color: "#c49868"
    } ];
    for (let i = 0; i < bands.length - 1; i++) {
        const y1 = bands[i].y * h, y2 = bands[i + 1].y * h;
        const grad = ctx.createLinearGradient(0, y1, 0, y2);
        grad.addColorStop(0, bands[i].color);
        grad.addColorStop(1, bands[i + 1].color);
        ctx.fillStyle = grad;
        ctx.fillRect(0, y1, w, y2 - y1);
    }
    const grsX = w * .65, grsY = h * .68;
    ctx.save();
    ctx.translate(grsX, grsY);
    ctx.beginPath();
    ctx.ellipse(0, 0, w * .08, h * .05, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#c04030";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, w * .05, h * .03, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#d05040";
    ctx.fill();
    ctx.restore();
    for (let i = 0; i < 200; i++) {
        const x = Math.random() * w, y = Math.random() * h, rx = 15 + Math.random() * 50, ry = 3 + Math.random() * 8;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        const alpha = .05 + Math.random() * .2;
        ctx.fillStyle = Math.random() > .5 ? `rgba(255,255,255,${alpha})` : `rgba(80,50,30,${alpha})`;
        ctx.fill();
    }
}

function drawSaturnTexture(ctx, w, h) {
    const bands = [ {
        y: 0,
        color: "#e8d5a3"
    }, {
        y: .1,
        color: "#d4bc8a"
    }, {
        y: .22,
        color: "#f0e0c0"
    }, {
        y: .35,
        color: "#c8a870"
    }, {
        y: .5,
        color: "#e0c898"
    }, {
        y: .62,
        color: "#d0b888"
    }, {
        y: .75,
        color: "#e8d0a0"
    }, {
        y: .88,
        color: "#c8a870"
    }, {
        y: 1,
        color: "#d8bc90"
    } ];
    for (let i = 0; i < bands.length - 1; i++) {
        const y1 = bands[i].y * h, y2 = bands[i + 1].y * h;
        const grad = ctx.createLinearGradient(0, y1, 0, y2);
        grad.addColorStop(0, bands[i].color);
        grad.addColorStop(1, bands[i + 1].color);
        ctx.fillStyle = grad;
        ctx.fillRect(0, y1, w, y2 - y1);
    }
    for (let i = 0; i < 150; i++) {
        const x = Math.random() * w, y = Math.random() * h, rx = 10 + Math.random() * 40, ry = 2 + Math.random() * 6;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,180,140,${.08 + Math.random() * .15})`;
        ctx.fill();
    }
}

function drawUranusTexture(ctx, w, h) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#8ec8e0");
    grad.addColorStop(.3, "#7ec8e3");
    grad.addColorStop(.5, "#a0d8e8");
    grad.addColorStop(.7, "#7ec8e3");
    grad.addColorStop(1, "#6ab8d8");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) {
        const y = Math.random() * h;
        ctx.fillStyle = `rgba(255,255,255,${.03 + Math.random() * .08})`;
        ctx.fillRect(0, y, w, 5 + Math.random() * 15);
    }
}

function drawNeptuneTexture(ctx, w, h) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#2a4a8a");
    grad.addColorStop(.3, "#3a5ca0");
    grad.addColorStop(.5, "#2a4a8a");
    grad.addColorStop(.7, "#3a5ca0");
    grad.addColorStop(1, "#1a3a70");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    ctx.ellipse(w * .5, h * .4, w * .15, h * .08, .2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(200,220,255,0.3)";
    ctx.fill();
    for (let i = 0; i < 40; i++) {
        const y = Math.random() * h;
        ctx.fillStyle = `rgba(255,255,255,${.03 + Math.random() * .06})`;
        ctx.fillRect(0, y, w, 3 + Math.random() * 10);
    }
}

function drawMoonTexture(ctx, w, h) {
    ctx.fillStyle = "#b0b0b0";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
        const x = Math.random() * w, y = Math.random() * h, r = 2 + Math.random() * 12;
        const dark = Math.random() > .4;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = dark ? `rgba(80,80,80,${.2 + Math.random() * .5})` : `rgba(200,200,200,${.1 + Math.random() * .3})`;
        ctx.fill();
    }
    const marias = [ {
        x: w * .3,
        y: h * .35,
        r: w * .15
    }, {
        x: w * .6,
        y: h * .5,
        r: w * .2
    }, {
        x: w * .45,
        y: h * .7,
        r: w * .12
    }, {
        x: w * .7,
        y: h * .3,
        r: w * .1
    } ];
    marias.forEach(m => {
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(70,70,80,0.35)";
        ctx.fill();
    });
}

function drawUranusRingTexture(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const bands = [ [ .06, .1, .1 ], [ .16, .2, .14 ], [ .28, .33, .2 ], [ .4, .47, .55 ], [ .55, .6, .5 ], [ .68, .72, .28 ], [ .76, .79, .35 ], [ .82, .86, .6 ], [ .93, .99, 1 ] ];
    for (const [v0, v1, a] of bands) {
        const y0 = (1 - v1) * h, y1 = (1 - v0) * h;
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, "rgba(200,210,225,0)");
        g.addColorStop(.5, `rgba(200,210,225,${a})`);
        g.addColorStop(1, "rgba(200,210,225,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, y0, w, y1 - y0);
    }
}

function drawNeptuneRingTexture(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const RING_INNER = 1.6, RING_OUTER = 2.65, RANGE = RING_OUTER - RING_INNER;
    const bands = [ [ 1.66, 1.74, .14 ], [ 2.16, 2.17, .55 ], [ 2.17, 2.32, .18 ], [ 2.32, 2.33, .48 ], [ 2.51, 2.52, .12 ], [ 2.55, 2.57, .22 ] ];
    for (const [r0, r1, a] of bands) {
        const v0 = (r0 - RING_INNER) / RANGE;
        const v1 = (r1 - RING_INNER) / RANGE;
        const y0 = (1 - v1) * h, y1 = (1 - v0) * h;
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, "rgba(180,170,160,0)");
        g.addColorStop(.5, `rgba(180,170,160,${a})`);
        g.addColorStop(1, "rgba(180,170,160,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, y0, w, y1 - y0);
    }
    const adamsV0 = (2.54 - RING_INNER) / RANGE;
    const adamsV1 = (2.58 - RING_INNER) / RANGE;
    const arcY = (1 - (adamsV0 + adamsV1) * .5) * h;
    const arcHeight = Math.max(3, (adamsV1 - adamsV0) * h * 2.4);
    const arcs = [ [ .47, .045, .95 ], [ .505, .03, .72 ], [ .545, .036, .88 ], [ .59, .026, .64 ], [ .632, .04, .8 ] ];
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [u, halfWidth, alpha] of arcs) {
        const cx = u * w, rx = Math.max(2, halfWidth * w);
        const g = ctx.createRadialGradient(cx, arcY, 0, cx, arcY, rx);
        g.addColorStop(0, `rgba(190,182,172,${alpha})`);
        g.addColorStop(.55, `rgba(190,182,172,${alpha * .45})`);
        g.addColorStop(1, "rgba(190,182,172,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, arcY, rx, arcHeight, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawSaturnRingTexture(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const bands = [ [ 0, 0 ], [ .1, .85 ], [ .2, .35 ], [ .25, .95 ], [ .35, .45 ], [ .4, 1 ], [ .5, .7 ], [ .55, .9 ], [ .65, .35 ], [ .7, .8 ], [ .8, .55 ], [ .9, .2 ], [ 1, .05 ] ];
    for (let i = 0; i < bands.length - 1; i++) {
        const [p1, v1] = bands[i];
        const [p2, v2] = bands[i + 1];
        const y1 = p1 * h, y2 = p2 * h;
        const grad = ctx.createLinearGradient(0, y1, 0, y2);
        grad.addColorStop(0, `rgba(255,255,255,${v1})`);
        grad.addColorStop(1, `rgba(255,255,255,${v2})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, y1, w, y2 - y1);
    }
    for (let i = 0; i < 60; i++) {
        const y = Math.random() * h;
        ctx.fillStyle = `rgba(0,0,0,${.05 + Math.random() * .15})`;
        ctx.fillRect(0, y, w, 1 + Math.random() * 2);
    }
}

// Gloss mask for Earth's surface: water is smooth enough to hold a sun glint,
// land is not. Sampled from the albedo the Earth already paints, so coastline
// and mask can never drift apart. Stored as roughness values, not colour, so it
// stays in linear space.
function createEarthWaterMask() {
    if (proceduralTextures["earth-water"]) return proceduralTextures["earth-water"];
    const source = proceduralTextures.earth;
    if (!source?.image) return null;
    const width = source.image.width, height = source.image.height;
    const read = document.createElement("canvas");
    read.width = width;
    read.height = height;
    const rctx = read.getContext("2d", {
        willReadFrequently: true
    });
    rctx.drawImage(source.image, 0, 0);
    const pixels = rctx.getImageData(0, 0, width, height);
    const target = document.createElement("canvas");
    target.width = width;
    target.height = height;
    const tctx = target.getContext("2d");
    const mask = tctx.createImageData(width, height);
    for (let i = 0; i < pixels.data.length; i += 4) {
        const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
        // Ocean paint is blue-dominant; anything greener or browner is land.
        const water = b > r * 1.25 && b > g * 1.06;
        // THREE multiplies the material roughness factor by this texel's green
        // channel, so the texel value IS the roughness. 0.13 is a wind-ruffled
        // sea: the sun's mirror spreads into a glitter path about 6 degrees
        // wide, which is what makes the ocean the brightest thing in the frame.
        // Land stays fully rough and never glints.
        const value = water ? 33 : 255;
        mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = value;
        mask.data[i + 3] = 255;
    }
    tctx.putImageData(mask, 0, 0);
    const texture = new THREE.CanvasTexture(target);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    applyMaxAnisotropy(texture);
    proceduralTextures["earth-water"] = texture;
    return texture;
}

function getProceduralTexture(key) {
    if (!proceduralTextures[key]) {
        const drawFn = proceduralDrawFns[key];
        const tex = createCanvasTexture(512, 256, drawFn);
        if (key === "saturn-ring") {
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
        }
        proceduralTextures[key] = tex;
    }
    return proceduralTextures[key];
}

function createEarthNightLights() {
    if (!earthNightTexture || !objectRegistry["earth"]) return;
    const earth = objectRegistry["earth"];
    if (earth.userData.nightMesh) {
        const old = earth.userData.nightMesh;
        earth.remove(old);
        old.geometry.dispose();
        old.material.dispose();
        earth.userData.nightMesh = null;
    }
    const cloudMap = cloudMeshes["earth"]?.material?.map || null;
    const radius = earth.geometry.parameters.radius * (1 + 10 / BodyShapes.maxRadiusKm("earth"));
    const geometry = BodyShapes.createGeometry(THREE, "earth", radius, 512, 256);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            dayTexture: {
                value: earth.material?.map || null
            },
            dayTextureMatrix: {
                value: earth.material?.map?.matrix?.clone?.() || new THREE.Matrix3
            },
            hasDayTexture: {
                value: earth.material?.map ? 1 : 0
            },
            cloudTexture: {
                value: cloudMap
            },
            cloudTextureMatrix: {
                value: cloudMap?.matrix?.clone?.() || new THREE.Matrix3
            },
            hasCloudTexture: {
                value: cloudMap ? 1 : 0
            },
            cloudUseAlpha: {
                value: cloudMap?.userData?.cloudMaskChannel === "alpha" ? 1 : 0
            },
            cloudMaskOpacity: {
                value: 1
            },
            nightTexture: {
                value: earthNightTexture
            },
            nightTextureMatrix: {
                value: earthNightTexture.matrix.clone()
            },
            sunDirection: {
                value: new THREE.Vector3(0, 0, 0)
            },
            uInsideShell: {
                value: 0
            }
        },
        vertexShader: `\n            ${globalThis.LDB_VERTEX_PARS || ""}\n            varying vec2 vUv;\n            varying vec3 vNormal;\n            void main() {\n                vUv = uv;\n                vNormal = normalize(mat3(modelMatrix) * normal);\n                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n                ${globalThis.LDB_VERTEX_TAIL || ""}\n            }\n        `,
        fragmentShader: `\n            uniform sampler2D dayTexture;\n            uniform mat3 dayTextureMatrix;\n            uniform float hasDayTexture;\n            uniform sampler2D nightTexture;\n            uniform mat3 nightTextureMatrix;\n            uniform sampler2D cloudTexture;\n            uniform mat3 cloudTextureMatrix;\n            uniform float hasCloudTexture;\n            uniform float cloudUseAlpha;\n            uniform float cloudMaskOpacity;\n            uniform vec3 sunDirection;\n            uniform float uInsideShell;\n            varying vec2 vUv;\n            varying vec3 vNormal;\n            ${globalThis.LDB_FRAGMENT_PARS || ""}\n            void main() {\n                ${globalThis.LDB_FRAGMENT_HEAD || ""}\n                if ((uInsideShell < 0.5 && !gl_FrontFacing) || (uInsideShell >= 0.5 && gl_FrontFacing)) discard;\n                float mu = dot(normalize(vNormal), normalize(sunDirection));\n                float nightFactor = 1.0 - smoothstep(-0.12, 0.0, mu);\n                vec2 dayUv = (dayTextureMatrix * vec3(vUv, 1.0)).xy;\n                vec2 nightUv = (nightTextureMatrix * vec3(vUv, 1.0)).xy;\n                float cloudOcclusion = 0.0;\n                if (hasCloudTexture > 0.5 && cloudMaskOpacity > 0.001) {\n                    vec2 cloudUv = (cloudTextureMatrix * vec3(vUv, 1.0)).xy;\n                    vec4 cloudSample = texture2D(cloudTexture, cloudUv);\n                    float cloudRgb = max(cloudSample.r, max(cloudSample.g, cloudSample.b));\n                    float cloudDensity = mix(cloudRgb, cloudSample.a, cloudUseAlpha);\n                    float coverage = smoothstep(0.38, 0.60, cloudDensity) * cloudMaskOpacity;\n                    cloudOcclusion = smoothstep(0.02, 0.18, coverage);\n                }\n                float clearFactor = 1.0 - cloudOcclusion;\n                vec3 dayColor = hasDayTexture > 0.5 ? texture2D(dayTexture, dayUv).rgb : vec3(0.0);\n                vec3 nightColor = texture2D(nightTexture, nightUv).rgb;\n                vec3 citySignal = max(nightColor - vec3(0.02), vec3(0.0));\n                float cityLevel = max(max(citySignal.r, citySignal.g), citySignal.b);\n                float cityMask = smoothstep(0.008, 0.03, cityLevel);\n                // Keep the unlit land/ocean close to black; bright terrain bleed makes the
                // Earthshine, applied to the day map over the night hemisphere. Kept only
                // mildly cool (1.4x red) and weak: blue-heavy coefficients turned every
                // ocean pixel into a visible blue wash on the night side.
                vec3 surfaceGlow = dayColor * vec3(0.0055, 0.0062, 0.0078) + vec3(0.00004, 0.00005, 0.00007);\n                vec3 cityGlow = pow(citySignal, vec3(0.82)) * vec3(1.45, 1.05, 0.68) * cityMask;\n                gl_FragColor = vec4(surfaceGlow + cityGlow, nightFactor * 0.9 * clearFactor);\n                #include <tonemapping_fragment>\n                ${THREE.ShaderChunk.colorspace_fragment ? "#include <colorspace_fragment>" : "#include <encodings_fragment>"}\n            }\n        `,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        forceSinglePass: true
    });
    material.blending = THREE.NormalBlending;
    const nightMesh = new THREE.Mesh(geometry, material);
    nightMesh.userData.isNightLights = true;
    nightMesh.renderOrder = -1;
    earth.add(nightMesh);
    earth.userData.nightMesh = nightMesh;
}
