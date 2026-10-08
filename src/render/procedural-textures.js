function createCanvasTexture(width, height, drawFn) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    drawFn(ctx, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
}
function createThemeGradientBackground() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size * 0.75);
    g.addColorStop(0.00, '#1e1e1e');
    g.addColorStop(0.45, '#161616');
    g.addColorStop(0.75, '#0d0d0d');
    g.addColorStop(1.00, '#050505');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
}
function drawMercuryTexture(ctx, w, h) {
    ctx.fillStyle = '#9a9a9a'; ctx.fillRect(0,0,w,h);
    for (let i = 0; i < 200; i++) {
        const x = Math.random()*w, y = Math.random()*h, r = 3+Math.random()*15;
        const dark = Math.random() > 0.5;
        ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
        ctx.fillStyle = dark ? `rgba(80,80,80,${0.2+Math.random()*0.4})` : `rgba(180,180,180,${0.15+Math.random()*0.3})`;
        ctx.fill();
        ctx.beginPath(); ctx.arc(x,y,r*0.7,0,Math.PI*2);
        ctx.strokeStyle = `rgba(60,60,60,${0.3})`; ctx.lineWidth = 1; ctx.stroke();
    }
}
function drawVenusTexture(ctx, w, h) {
    const grad = ctx.createLinearGradient(0,0,w,h);
    grad.addColorStop(0,'#e8d5a3'); grad.addColorStop(0.3,'#d4b880'); grad.addColorStop(0.6,'#f0e0c0'); grad.addColorStop(1,'#c8a870');
    ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
    for (let i = 0; i < 80; i++) {
        const x = Math.random()*w, y = Math.random()*h;
        const rx = 30+Math.random()*80, ry = 10+Math.random()*30;
        ctx.beginPath(); ctx.ellipse(x,y,rx,ry,Math.random()*Math.PI,0,Math.PI*2);
        ctx.fillStyle = `rgba(240,225,180,${0.08+Math.random()*0.15})`; ctx.fill();
    }
}
function drawEarthTexture(ctx, w, h) {
    const oceanGrad = ctx.createLinearGradient(0,0,0,h);
    oceanGrad.addColorStop(0,'#1a5c9e'); oceanGrad.addColorStop(0.5,'#1e7bc4'); oceanGrad.addColorStop(1,'#1a5c9e');
    ctx.fillStyle = oceanGrad; ctx.fillRect(0,0,w,h);
    const continents = [
        { x:w*0.25, y:h*0.35, rx:w*0.22, ry:h*0.15, rot:0.3, color:'#3d8b40' },
        { x:w*0.6, y:h*0.3, rx:w*0.25, ry:h*0.2, rot:-0.2, color:'#4a8f3d' },
        { x:w*0.35, y:h*0.65, rx:w*0.18, ry:h*0.12, rot:0.5, color:'#5a9a45' },
        { x:w*0.7, y:h*0.6, rx:w*0.15, ry:h*0.18, rot:-0.4, color:'#3d7a35' },
        { x:w*0.5, y:h*0.45, rx:w*0.1, ry:h*0.08, rot:0.1, color:'#6aad50' },
        { x:w*0.15, y:h*0.5, rx:w*0.12, ry:h*0.1, rot:-0.3, color:'#4a8f3d' },
        { x:w*0.45, y:h*0.2, rx:w*0.15, ry:h*0.08, rot:0.2, color:'#558f38' },
    ];
    continents.forEach(c => {
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
        ctx.beginPath(); ctx.ellipse(0,0,c.rx,c.ry,0,0,Math.PI*2);
        ctx.fillStyle = c.color; ctx.fill();
        for (let i = 0; i < 15; i++) {
            const ox = (Math.random()-0.5)*c.rx*1.5, oy = (Math.random()-0.5)*c.ry*1.5;
            if (Math.abs(ox) < c.rx*0.6 && Math.abs(oy) < c.ry*0.6) {
                ctx.beginPath(); ctx.ellipse(ox,oy,c.rx*0.2,c.ry*0.25,0,0,Math.PI*2);
                ctx.fillStyle = `rgba(60,120,50,${0.3+Math.random()*0.3})`; ctx.fill();
            }
        }
        ctx.restore();
    });
    ctx.fillStyle = 'rgba(240,245,255,0.7)';
    ctx.fillRect(0,0,w,h*0.06); ctx.fillRect(0,h*0.94,w,h*0.06);
    for (let i = 0; i < 40; i++) {
        const x = Math.random()*w, y = Math.random()*h, rx = 20+Math.random()*60, ry = 5+Math.random()*15;
        ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);
        ctx.fillStyle = `rgba(255,255,255,${0.1+Math.random()*0.2})`; ctx.fill();
    }
}
function drawMarsTexture(ctx, w, h) {
    const grad = ctx.createLinearGradient(0,0,0,h);
    grad.addColorStop(0,'#d4703a'); grad.addColorStop(0.4,'#c45030'); grad.addColorStop(0.7,'#b84028'); grad.addColorStop(1,'#a03020');
    ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
    for (let i = 0; i < 100; i++) {
        const x = Math.random()*w, y = Math.random()*h, r = 5+Math.random()*25;
        ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
        ctx.fillStyle = `rgba(130,50,30,${0.2+Math.random()*0.4})`; ctx.fill();
        ctx.beginPath(); ctx.arc(x,y,r*0.6,0,Math.PI*2);
        ctx.fillStyle = `rgba(200,100,60,${0.15+Math.random()*0.25})`; ctx.fill();
    }
    ctx.fillStyle = 'rgba(240,240,250,0.6)'; ctx.fillRect(0,0,w,h*0.05);
    for (let i = 0; i < 30; i++) {
        const x = Math.random()*w, y = Math.random()*h, rx = 30+Math.random()*80, ry = 15+Math.random()*40;
        ctx.beginPath(); ctx.ellipse(x,y,rx,ry,Math.random()*0.5,0,Math.PI*2);
        ctx.fillStyle = `rgba(100,30,20,${0.1+Math.random()*0.2})`; ctx.fill();
    }
}
function drawJupiterTexture(ctx, w, h) {
    const bands = [
        { y:0.0, color:'#c8a070' }, { y:0.08, color:'#e8d0b0' }, { y:0.18, color:'#b89060' }, { y:0.3, color:'#f0e0c0' },
        { y:0.42, color:'#c49868' }, { y:0.55, color:'#e0c8a0' }, { y:0.65, color:'#a88050' }, { y:0.75, color:'#d8bc90' },
        { y:0.85, color:'#b89060' }, { y:0.92, color:'#e0c8a0' }, { y:1.0, color:'#c49868' }
    ];
    for (let i = 0; i < bands.length-1; i++) {
        const y1 = bands[i].y*h, y2 = bands[i+1].y*h;
        const grad = ctx.createLinearGradient(0,y1,0,y2);
        grad.addColorStop(0,bands[i].color); grad.addColorStop(1,bands[i+1].color);
        ctx.fillStyle = grad; ctx.fillRect(0,y1,w,y2-y1);
    }
    const grsX = w*0.65, grsY = h*0.68;
    ctx.save(); ctx.translate(grsX,grsY);
    ctx.beginPath(); ctx.ellipse(0,0,w*0.08,h*0.05,0,0,Math.PI*2); ctx.fillStyle='#c04030'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(0,0,w*0.05,h*0.03,0,0,Math.PI*2); ctx.fillStyle='#d05040'; ctx.fill();
    ctx.restore();
    for (let i = 0; i < 200; i++) {
        const x = Math.random()*w, y = Math.random()*h, rx = 15+Math.random()*50, ry = 3+Math.random()*8;
        ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);
        const alpha = 0.05+Math.random()*0.2;
        ctx.fillStyle = Math.random()>0.5 ? `rgba(255,255,255,${alpha})` : `rgba(80,50,30,${alpha})`;
        ctx.fill();
    }
}
function drawSaturnTexture(ctx, w, h) {
    const bands = [
        { y:0.0, color:'#e8d5a3' }, { y:0.1, color:'#d4bc8a' }, { y:0.22, color:'#f0e0c0' }, { y:0.35, color:'#c8a870' },
        { y:0.5, color:'#e0c898' }, { y:0.62, color:'#d0b888' }, { y:0.75, color:'#e8d0a0' }, { y:0.88, color:'#c8a870' },
        { y:1.0, color:'#d8bc90' }
    ];
    for (let i = 0; i < bands.length-1; i++) {
        const y1 = bands[i].y*h, y2 = bands[i+1].y*h;
        const grad = ctx.createLinearGradient(0,y1,0,y2);
        grad.addColorStop(0,bands[i].color); grad.addColorStop(1,bands[i+1].color);
        ctx.fillStyle = grad; ctx.fillRect(0,y1,w,y2-y1);
    }
    for (let i = 0; i < 150; i++) {
        const x = Math.random()*w, y = Math.random()*h, rx = 10+Math.random()*40, ry = 2+Math.random()*6;
        ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);
        ctx.fillStyle = `rgba(200,180,140,${0.08+Math.random()*0.15})`; ctx.fill();
    }
}
function drawUranusTexture(ctx, w, h) {
    const grad = ctx.createLinearGradient(0,0,0,h);
    grad.addColorStop(0,'#8ec8e0'); grad.addColorStop(0.3,'#7ec8e3'); grad.addColorStop(0.5,'#a0d8e8'); grad.addColorStop(0.7,'#7ec8e3'); grad.addColorStop(1,'#6ab8d8');
    ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
    for (let i = 0; i < 30; i++) {
        const y = Math.random()*h;
        ctx.fillStyle = `rgba(255,255,255,${0.03+Math.random()*0.08})`;
        ctx.fillRect(0,y,w,5+Math.random()*15);
    }
}
function drawNeptuneTexture(ctx, w, h) {
    const grad = ctx.createLinearGradient(0,0,0,h);
    grad.addColorStop(0,'#2a4a8a'); grad.addColorStop(0.3,'#3a5ca0'); grad.addColorStop(0.5,'#2a4a8a'); grad.addColorStop(0.7,'#3a5ca0'); grad.addColorStop(1,'#1a3a70');
    ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
    ctx.beginPath(); ctx.ellipse(w*0.5,h*0.4,w*0.15,h*0.08,0.2,0,Math.PI*2);
    ctx.fillStyle = 'rgba(200,220,255,0.3)'; ctx.fill();
    for (let i = 0; i < 40; i++) {
        const y = Math.random()*h;
        ctx.fillStyle = `rgba(255,255,255,${0.03+Math.random()*0.06})`;
        ctx.fillRect(0,y,w,3+Math.random()*10);
    }
}
function drawMoonTexture(ctx, w, h) {
    ctx.fillStyle = '#b0b0b0'; ctx.fillRect(0,0,w,h);
    for (let i = 0; i < 300; i++) {
        const x = Math.random()*w, y = Math.random()*h, r = 2+Math.random()*12;
        const dark = Math.random() > 0.4;
        ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
        ctx.fillStyle = dark ? `rgba(80,80,80,${0.2+Math.random()*0.5})` : `rgba(200,200,200,${0.1+Math.random()*0.3})`;
        ctx.fill();
    }
    const marias = [
        { x:w*0.3, y:h*0.35, r:w*0.15 },
        { x:w*0.6, y:h*0.5, r:w*0.2 },
        { x:w*0.45, y:h*0.7, r:w*0.12 },
        { x:w*0.7, y:h*0.3, r:w*0.1 },
    ];
    marias.forEach(m => {
        ctx.beginPath(); ctx.arc(m.x,m.y,m.r,0,Math.PI*2);
        ctx.fillStyle = 'rgba(70,70,80,0.35)'; ctx.fill();
    });
}
function drawUranusRingTexture(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const bands = [
        [0.06, 0.10, 0.10],
        [0.16, 0.20, 0.14],
        [0.28, 0.33, 0.20],
        [0.40, 0.47, 0.55],
        [0.55, 0.60, 0.50],
        [0.68, 0.72, 0.28],
        [0.76, 0.79, 0.35],
        [0.82, 0.86, 0.60],
        [0.93, 0.99, 1.00],
    ];
    for (const [v0, v1, a] of bands) {
        const y0 = (1 - v1) * h, y1 = (1 - v0) * h;
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0,   'rgba(200,210,225,0)');
        g.addColorStop(0.5, `rgba(200,210,225,${a})`);
        g.addColorStop(1,   'rgba(200,210,225,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, y0, w, y1 - y0);
    }
}
function drawNeptuneRingTexture(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const RING_INNER = 1.60, RING_OUTER = 2.65, RANGE = RING_OUTER - RING_INNER;
    const bands = [
        [1.66, 1.74, 0.14],
        [2.16, 2.17, 0.55],
        [2.17, 2.32, 0.18],
        [2.32, 2.33, 0.48],
        [2.51, 2.52, 0.12],
        [2.55, 2.57, 0.22],
    ];
    for (const [r0, r1, a] of bands) {
        const v0 = (r0 - RING_INNER) / RANGE;
        const v1 = (r1 - RING_INNER) / RANGE;
        const y0 = (1 - v1) * h, y1 = (1 - v0) * h;
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0,   'rgba(180,170,160,0)');
        g.addColorStop(0.5, `rgba(180,170,160,${a})`);
        g.addColorStop(1,   'rgba(180,170,160,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, y0, w, y1 - y0);
    }
    const adamsV0 = (2.54 - RING_INNER) / RANGE;
    const adamsV1 = (2.58 - RING_INNER) / RANGE;
    const arcY = (1 - (adamsV0 + adamsV1) * 0.5) * h;
    const arcHeight = Math.max(3, (adamsV1 - adamsV0) * h * 2.4);
    const arcs = [
        [0.470, 0.045, 0.95],
        [0.505, 0.030, 0.72],
        [0.545, 0.036, 0.88],
        [0.590, 0.026, 0.64],
        [0.632, 0.040, 0.80],
    ];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [u, halfWidth, alpha] of arcs) {
        const cx = u * w, rx = Math.max(2, halfWidth * w);
        const g = ctx.createRadialGradient(cx, arcY, 0, cx, arcY, rx);
        g.addColorStop(0, `rgba(190,182,172,${alpha})`);
        g.addColorStop(0.55, `rgba(190,182,172,${alpha * 0.45})`);
        g.addColorStop(1, 'rgba(190,182,172,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, arcY, rx, arcHeight, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}
function drawSaturnRingTexture(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const bands = [
        [0.00, 0.00],
        [0.10, 0.85],
        [0.20, 0.35],
        [0.25, 0.95],
        [0.35, 0.45],
        [0.40, 1.00],
        [0.50, 0.70],
        [0.55, 0.90],
        [0.65, 0.35],
        [0.70, 0.80],
        [0.80, 0.55],
        [0.90, 0.20],
        [1.00, 0.05],
    ];
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
        ctx.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.15})`;
        ctx.fillRect(0, y, w, 1 + Math.random() * 2);
    }
}
function getProceduralTexture(key) {
    if (!proceduralTextures[key]) {
        const drawFn = proceduralDrawFns[key];
        const tex = createCanvasTexture(512, 256, drawFn);
        if (key === 'saturn-ring') {
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
        }
        proceduralTextures[key] = tex;
    }
    return proceduralTextures[key];
}
function createEarthNightLights() {
    if (!earthNightTexture || !objectRegistry['earth']) return;
    const earth = objectRegistry['earth'];
    if (earth.userData.nightMesh) {
        const old = earth.userData.nightMesh;
        earth.remove(old);
        old.geometry.dispose();
        old.material.dispose();
        earth.userData.nightMesh = null;
    }
    const radius = earth.geometry.parameters.radius * 1.0005;
    const geometry = BodyShapes.createGeometry(THREE, 'earth', radius, 256, 256);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            nightTexture: { value: earthNightTexture },
            sunDirection: { value: new THREE.Vector3(0, 0, 0) },
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            void main() {
                vUv = uv;
                vNormal = normalize(mat3(modelMatrix) * normal);
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPos.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D nightTexture;
            uniform vec3 sunDirection;
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            void main() {
                vec3 lightDir = normalize(sunDirection);
                float nightFactor = 1.0 - smoothstep(-0.10, 0.05, dot(normalize(vNormal), lightDir));
                vec4 nightColor = texture2D(nightTexture, vUv);
                float cityMask = smoothstep(0.001, 0.018, max(max(nightColor.r, nightColor.g), nightColor.b));
                gl_FragColor = vec4(nightColor.rgb * 1.2, nightColor.a * nightFactor * cityMask);
                #include <tonemapping_fragment>
                ${THREE.ShaderChunk.colorspace_fragment ? '#include <colorspace_fragment>' : '#include <encodings_fragment>'}
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
    });
    material.blending = THREE.AdditiveBlending;
    const nightMesh = new THREE.Mesh(geometry, material);
    nightMesh.userData.isNightLights = true;
    nightMesh.renderOrder = 1;
    earth.add(nightMesh);
    earth.userData.nightMesh = nightMesh;
}