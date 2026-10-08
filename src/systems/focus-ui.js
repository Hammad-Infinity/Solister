function hideFocusCard() {
    equatorialGrid?.setFocused(null);
    focusLineLayer.classList.remove('visible');
    focusLine.setAttribute('opacity', '0');
    focusDot.setAttribute('opacity', '0');
}
function updateFocusLine() {
    if (!focusedObject || focusedObject === solarSystem ||
        (focusedObject.userData.planetKey === 'asteroidbelt' && !asteroidsEnabled) ||
        camTransition || !focusLineLayer.classList.contains('visible')) {
        _lineFadeOut();
        return;
    }
    resolveFocusWorldPosition(_focusWorld);
    _focusScreen.copy(_focusWorld).project(camera);
    if (_focusScreen.z > 1 || _focusScreen.z < -1) {
        _lineFadeOut();
        return;
    }
    const sx = (_focusScreen.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-_focusScreen.y * 0.5 + 0.5) * window.innerHeight;
    if (!_focusAnchorEl) _focusAnchorEl = focusSectionEl.querySelector('.dock-section-header');
    const headerRect = _focusAnchorEl.getBoundingClientRect();
    const bodyRect   = dockBodyEl.getBoundingClientRect();
    if (!headerRect.width || !headerRect.height || dockEl.classList.contains('collapsed') ||
        headerRect.bottom < 0 || headerRect.top > window.innerHeight ||
        Math.abs(_focusScreen.x) > 1 || Math.abs(_focusScreen.y) > 1) {
        _lineFadeOut();
        return;
    }
    const _aimX = dockEl.dataset.side === 'right' ? headerRect.left : headerRect.right;
    const _aimY = Math.min(bodyRect.bottom - 6, Math.max(bodyRect.top + 6,
        headerRect.top + headerRect.height / 2));
    const _nowMs = performance.now();
    const _dtMs = _lineEase.at ? Math.min(50, _nowMs - _lineEase.at) : 60;
    _lineEase.at = _nowMs;
    if (!_lineEase.on) {
        _lineEase.on = true; _lineEase.ax = _aimX; _lineEase.ay = _aimY; _lineEase.o = 1;
    } else {
        const _k = 1 - Math.exp(-_dtMs / 60);
        _lineEase.ax += (_aimX - _lineEase.ax) * _k;
        _lineEase.ay += (_aimY - _lineEase.ay) * _k;
        if (Math.abs(_aimX - _lineEase.ax) < 0.25) _lineEase.ax = _aimX;
        if (Math.abs(_aimY - _lineEase.ay) < 0.25) _lineEase.ay = _aimY;
    }
    const ax = _lineEase.ax, ay = _lineEase.ay;
    focusLine.setAttribute('x1', sx);
    focusLine.setAttribute('y1', sy);
    focusLine.setAttribute('x2', ax);
    focusLine.setAttribute('y2', ay);
    _lineOpacity();
    focusDot.setAttribute('cx', sx);
    focusDot.setAttribute('cy', sy);
}
function updateLabelVisibility() {
    const mode=typeof getLabelMode==='function'?getLabelMode():'symbols';
    const enabled=markersEnabled&&mode!=='off';
    for(const label of labelObjects){
        if(!label)continue;
        if(label.element?.style){label.element.style.opacity=enabled?'1':'0';label.element.style.display=enabled?'':'none';}
        const name=label.element?.querySelector('.label-name');
        if(name?.style)name.style.display=mode==='names'?'':'none';
        label.visible=enabled;
    }
}
function addInlineToggle(labelText, initialState, onToggle) {
    const dt = document.createElement('dt');
    dt.textContent = labelText;
    const dd = document.createElement('dd');
    dd.style.textAlign = 'right';
    dd.style.paddingTop = '0';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inline-toggle';
    btn.textContent = initialState ? 'On' : 'Off';
    btn.classList.toggle('active', initialState);
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = !btn.classList.contains('active');
        btn.textContent = next ? 'On' : 'Off';
        btn.classList.toggle('active', next);
        onToggle(next);
    });
    dd.appendChild(btn);
    focusStatsEl.appendChild(dt);
    focusStatsEl.appendChild(dd);
}
function showFocusCard(bodyInfo) {
    const bodyKey = Object.keys(bodyFacts).find(key => bodyFacts[key] === bodyInfo) || null;
    equatorialGrid?.setFocused(bodyKey);
    focusKindEl.textContent = bodyInfo.kind;
    focusNameEl.textContent = bodyInfo.name;
    focusTaglineEl.textContent = /^Moon of /.test(bodyInfo.kind)
        ? `A natural satellite of ${bodyInfo.kind.slice(8)}.` : bodyInfo.tagline;
    focusStatsEl.innerHTML = '';
    const technicalRows = new Set(['Position model', 'Date controls',
        'Accuracy', 'Trajectory', 'Appearance', 'Moons rendered here']);
    bodyInfo.stats.forEach(([k, v]) => {
        if (technicalRows.has(k)) return;
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        focusStatsEl.appendChild(dt);
        focusStatsEl.appendChild(dd);
    });
    if (bodyKey && bodyKey !== 'solarsystem' && bodyKey !== 'asteroidbelt' && elevationCatalog?.getEntry(bodyKey)) {
        const dt = document.createElement('dt');
        dt.textContent = 'Topography';
        const dd = document.createElement('dd');
        const entry = elevationCatalog.getEntry(bodyKey);
        dd.textContent = elevationCatalog.describe(bodyKey);
        dd.title = [entry.source, entry.sourceVerticalDatum, entry.referenceShape].filter(Boolean).join(' — ');
        focusStatsEl.append(dt, dd);
    }
    if (bodyInfo === bodyFacts.earth) {
        addInlineToggle('Atmosphere', earthCloudsEnabled, (on) => {
            earthCloudsEnabled = on;
            try { localStorage.setItem('solarEarthClouds', on ? '1' : '0'); } catch (e) {}
        });
    }
    if (bodyInfo === bodyFacts.venus) {
        addInlineToggle('Atmosphere', venusAtmoEnabled, (on) => {
            venusAtmoEnabled = on;
            try { localStorage.setItem('solarVenusAtmo', on ? '1' : '0'); } catch (e) {}
        });
    }
    if (bodyInfo === bodyFacts.asteroidbelt) {
        const views = document.createElement('div');
        views.className = 'belt-view-options';
        views.style.gridColumn = '1 / -1';
        views.setAttribute('role', 'group');
        views.setAttribute('aria-label', 'Asteroid view');
        for (const [value, text] of [['close', 'Close asteroid'], ['overview', 'Belt overview']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = text;
            button.setAttribute('aria-pressed', String((objectRegistry.asteroidbelt?.userData.beltView || 'close') === value));
            button.addEventListener('click', () => {
                const target = objectRegistry.asteroidbelt;
                if (!target || !solarAccuracy.available) return;
                focusOnObject(target, value);
                for (const other of views.children) other.setAttribute('aria-pressed', String(other === button));
            });
            views.append(button);
        }
        const dt = document.createElement('dt');
        dt.textContent = 'View';
        const dd = document.createElement('dd');
        dd.style.gridColumn = '1 / -1';
        dd.append(views);
        focusStatsEl.append(dt, dd);
    }
    showDock();
    focusLineLayer.classList.add('visible');
}
let planetVisuals = null;
function updatePlanetVisuals() {
    if (!planetVisuals) planetVisuals = createPlanetVisuals();
    planetVisuals.update();
}
function createPlanetVisuals() {
    const planetKeys = ['sun','moon','mercury','venus','earth','mars','jupiter','saturn','uranus','neptune','pluto'];
    const ns='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(ns,'svg');
    svg.id='planet-focus-markers';
    svg.style.cssText='position:fixed;pointer-events:none;z-index:2;overflow:hidden;outline:none;-webkit-tap-highlight-color:transparent;';
    document.body.appendChild(svg);
    const entries=new Map(),world=new THREE.Vector3(),view=new THREE.Vector3();
    const scale=new THREE.Vector3();
    const eyeWorld=new THREE.Vector3();
    let hovered=null,hoverKind=null,textMetricsVersion=0;
    const invalidateTextMetrics=()=>textMetricsVersion++;
    document.fonts?.addEventListener('loadingdone',invalidateTextMetrics);
    function attr(el,key,value){value=String(value);if(el.getAttribute(key)!==value)el.setAttribute(key,value);}
    function style(el,key,value){if(el.style[key]!==value)el.style[key]=value;}
    const markerKeys=new Set(planetKeys);
    const bodySymbols={sun:'☉',mercury:'☿',venus:'♀',earth:'⊕',mars:'♂',jupiter:'♃',saturn:'♄',uranus:'♅',neptune:'♆',pluto:'♇',moon:'☾'};
    const symbolParent=new THREE.Vector3();
    const glyphFont='Segoe UI Symbol, DejaVu Sans, sans-serif';
    const nameFont='system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    const POPULATION_KEYS=new Set(['asteroidbelt','trojanl4','trojanl5','hildas','nea','kuiperbelt']);
    const MARKER_GAP_X=14,MARKER_GAP_Y=6,MARKER_PAD=6,MARKER_BOX_H=26;
    const boxesClear=(a,b)=>Math.abs(a.x-b.x)*2>=a.w+b.w+MARKER_GAP_X||Math.abs(a.y-b.y)*2>=a.h+b.h+MARKER_GAP_Y;
    const boxOnScreen=(box,W,H)=>box.x-box.w/2>=MARKER_PAD&&box.x+box.w/2<=W-MARKER_PAD&&box.y-box.h/2>=MARKER_PAD&&box.y+box.h/2<=H-MARKER_PAD;
    function markerGlyph(key,body,moon){
        if(bodySymbols[key])return bodySymbols[key];
        if(POPULATION_KEYS.has(key))return '';
        if(body.userData.isComet||bodyFacts[key]?.kind==='Comet')return '☄';
        return moon?'☾':null;
    }
    const SHORT_SKY_LABELS={comet67p:'67P',comet2p:'2P',comet46p:'46P',comet9p:'9P',asteroidbelt:'Main Belt',trojanl4:'Trojan L4',trojanl5:'Trojan L5',hildas:'Hildas',nea:'Near-Earth',kuiperbelt:'Kuiper Belt'};
    function shortSkyLabel(key){
        const full=String(bodyFacts[key]?.name||key);
        if(SHORT_SKY_LABELS[key])return SHORT_SKY_LABELS[key];
        let head=full;
        for(const cut of ['·','—','–','(']){const at=head.indexOf(cut);if(at>0)head=head.slice(0,at);}
        const slash=head.indexOf('/');
        if(slash>0)head=head.slice(0,slash);
        head=head.trim();
        if(head.length<=12)return head;
        return head.slice(0,11).trim()+'…';
    }
    function markerLabelRank(key){
        if(key===(focusedObject?.userData?.planetKey||focusedObject?.name))return -1;
        if(key==='sun')return 0;
        const planet=planetKeys.indexOf(key);
        if(planet>=0)return 1+planet;
        if(key==='moon'||/^Moon of\b/i.test(bodyFacts[key]?.kind||'')||bodyFacts[key]?.kind==='Natural Satellite')return 40;
        if(bodyFacts[key]?.kind==='Comet')return 50;
        return 60;
    }
    function textWidth(el,fallback){
        let width=0;
        try{width=el.getComputedTextLength?el.getComputedTextLength():0;}catch(_){width=0;}
        return width>0?width:fallback;
    }
    function paintMarkerText(e,key){
        const glyph=e.glyph||'',metricsChanged=e.metricsVersion!==textMetricsVersion;
        const glyphChanged=e.glyphEl.textContent!==glyph;
        if(glyphChanged)e.glyphEl.textContent=glyph;
        const label=shortSkyLabel(key);
        const nameChanged=e.nameEl.textContent!==label;
        if(nameChanged)e.nameEl.textContent=label;
        if(glyphChanged||metricsChanged)e.glyphW=glyph?textWidth(e.glyphEl,20):21;
        if(nameChanged||metricsChanged)e.nameW=Math.max(14,textWidth(e.nameEl,label.length*6.2));
        e.metricsVersion=textMetricsVersion;
        const name=bodyFacts[key]?.name||key;
        attr(e.hit,'aria-label','Focus '+name+' using its symbol; click again for the default close view');
        attr(e.nameHit,'aria-label','Focus '+name+' using its name; click again for the default close view');
        attr(e.nameHit,'x',-(e.nameW+12)/2);
        attr(e.nameHit,'width',e.nameW+12);
    }
    let nextKeyScan=0;
    const trailColors={mercury:0xd3c8b9,venus:0xf0cd93,earth:0x92d7ec,mars:0xf0a080,
        jupiter:0xe1c2a2,saturn:0xf0dba4,uranus:0xa2e3e6,neptune:0x9bb9ff};
    const fallbackColor=new THREE.Color();
    function markerColor(key,body){
        const tint=trailLayer?.entries.get(key)?.mesh.material.uniforms?.tint?.value;
        if(tint)return '#'+tint.getHexString();
        const parent=body.userData.parentKey || (key==='moon'?'earth':null);
        return '#'+fallbackColor.setHex(key==='sun'?0xffe7ac:(trailColors[key]||trailColors[parent]||0xbfdde7)).getHexString();
    }
    function paintMarker(key,e){
        const color=markerColor(key,e.body),active=hovered===key||document.activeElement===e.hit||document.activeElement===e.nameHit;
        if(e.color!==color){
            e.color=color;
            attr(e.ringOuter,'stroke',color);
            attr(e.ringCore,'fill',color);
        }
        attr(e.glyphEl,'fill',active?color:'#ccd5dd');
        attr(e.nameEl,'fill',active?color:'#d6dde4');
        style(e.group,'filter',active?`drop-shadow(0 0 3px ${color}e6) drop-shadow(0 0 7px ${color}cc)`:'none');
    }
    const visible=body=>{for(let p=body;p;p=p.parent)if(!p.visible)return false;return true;};
    function highlight(key,kind='marker'){
        hovered=key;hoverKind=key===null?null:kind;
        trailLayer?.setHighlighted?.(key);
        cometLayer.setHighlighted(key);
        for(const [k,e] of entries){
            paintMarker(k,e);
        }
    }
    function create(key,body){
        const group=document.createElementNS(ns,'g');
        group.dataset.bodyMarker=key;group.style.transition='opacity .45s ease';group.style.opacity='0';
        const hit=document.createElementNS(ns,'circle');
        hit.setAttribute('cx','0');hit.setAttribute('cy','0');hit.setAttribute('r','17');
        hit.setAttribute('fill','transparent');hit.setAttribute('stroke','none');
        hit.setAttribute('role','button');hit.setAttribute('aria-label','Focus '+key);
        hit.setAttribute('tabindex','0');
        hit.style.cssText='pointer-events:all;cursor:pointer;outline:none;-webkit-tap-highlight-color:transparent;';
        const nameHit=document.createElementNS(ns,'rect');
        nameHit.setAttribute('y','-11');nameHit.setAttribute('height','22');
        nameHit.setAttribute('fill','transparent');nameHit.setAttribute('stroke','none');
        nameHit.setAttribute('role','button');nameHit.setAttribute('tabindex','0');
        nameHit.dataset.bodyName=key;
        nameHit.style.cssText='pointer-events:all;cursor:pointer;outline:none;-webkit-tap-highlight-color:transparent;';
        const glyphEl=document.createElementNS(ns,'text');
        glyphEl.setAttribute('x','0');glyphEl.setAttribute('y','0');glyphEl.setAttribute('text-anchor','middle');
        glyphEl.setAttribute('dominant-baseline','middle');glyphEl.setAttribute('font-size','19');
        glyphEl.setAttribute('font-family',glyphFont);glyphEl.setAttribute('font-weight','400');
        glyphEl.setAttribute('fill','#ccd5dd');glyphEl.setAttribute('stroke','rgba(8,12,16,.75)');
        glyphEl.setAttribute('stroke-width','2.2');glyphEl.setAttribute('paint-order','stroke fill');
        glyphEl.setAttribute('aria-hidden','true');glyphEl.style.pointerEvents='none';
        glyphEl.style.textRendering='geometricPrecision';
        const nameEl=document.createElementNS(ns,'text');
        nameEl.setAttribute('x','0');nameEl.setAttribute('y','0');nameEl.setAttribute('text-anchor','middle');nameEl.setAttribute('dominant-baseline','middle');
        nameEl.setAttribute('font-size','11.5');nameEl.setAttribute('font-family',nameFont);
        nameEl.setAttribute('font-weight','400');nameEl.setAttribute('letter-spacing','.2');
        nameEl.setAttribute('fill','#d6dde4');nameEl.setAttribute('stroke','rgba(6,10,14,.72)');
        nameEl.setAttribute('stroke-width','2.6');nameEl.setAttribute('paint-order','stroke fill');
        nameEl.setAttribute('aria-hidden','true');nameEl.style.pointerEvents='none';
        nameEl.style.textRendering='geometricPrecision';
        const ring=document.createElementNS(ns,'g');
        ring.setAttribute('aria-hidden','true');ring.style.pointerEvents='none';
        const ringOuter=document.createElementNS(ns,'circle');
        ringOuter.setAttribute('r','7.5');ringOuter.setAttribute('fill','none');
        ringOuter.setAttribute('stroke','#ccd5dd');ringOuter.setAttribute('stroke-width','1.4');
        ringOuter.setAttribute('stroke-dasharray','2.6 3.4');
        const ringCore=document.createElementNS(ns,'circle');
        ringCore.setAttribute('r','2.1');ringCore.setAttribute('fill','#ccd5dd');
        ring.append(ringOuter,ringCore);
        group.append(hit,nameHit,glyphEl,ring,nameEl);svg.appendChild(group);
        const activate=()=>{
            if(!visible(body)||!solarAccuracy.available)return;
            const facts=bodyFacts[key];if(!facts)return;
            focusOnObject(body);showFocusCard(facts);syncBodySelect(key);
            if(focusedObject===body){group.style.display='none';hit.blur();nameHit.blur();highlight(null);}
        };
        for(const button of [hit,nameHit]){
            button.addEventListener('pointerenter',()=>highlight(key));
            button.addEventListener('pointerleave',event=>{
                if(!group.contains(event.relatedTarget)&&hovered===key&&hoverKind==='marker')highlight(null);
            });
            button.addEventListener('focus',()=>highlight(key));
            button.addEventListener('blur',event=>{
                if(!group.contains(event.relatedTarget)&&hovered===key&&hoverKind==='marker')highlight(null);
            });
            button.addEventListener('pointerdown',event=>{event.preventDefault();event.stopPropagation();});
            button.addEventListener('click',event=>{event.stopPropagation();activate();});
            button.addEventListener('keydown',event=>{
                if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();activate();}
            });
        }
        const moon=key==='moon'||/^Moon of\b/i.test(bodyFacts[key]?.kind||'')||bodyFacts[key]?.kind==='Natural Satellite';
        const glyph=markerGlyph(key,body,moon);
        glyphEl.style.display=glyph?'':'none';
        ring.style.display=glyph?'none':'';
        const entry={key,labelRank:markerLabelRank(key),body,group,hit,nameHit,glyphEl,nameEl,ring,ringOuter,ringCore,glyph:glyph||'',glyphW:20,nameW:24,moon,color:''};
        entries.set(key,entry);paintMarkerText(entry,key);return entry;
    }
    function remove(key,e){
        if(hovered===key)highlight(null);
        if(document.activeElement===e.hit)e.hit.blur();
        if(document.activeElement===e.nameHit)e.nameHit.blur();
        e.group.remove();
        entries.delete(key);
    }
    return {update(){
        const symbolCandidates=[];
        camera.updateWorldMatrix(true,false);
        const rect=renderer.domElement.getBoundingClientRect();
        style(svg,'left',rect.left+'px');style(svg,'top',rect.top+'px');
        attr(svg,'width',rect.width);attr(svg,'height',rect.height);
        attr(svg,'viewBox',`0 0 ${rect.width} ${rect.height}`);
        camera.getWorldPosition(eyeWorld);
        for(const [key,e] of entries)if(objectRegistry[key]!==e.body)remove(key,e);
        const now=performance.now();
        if(now>=nextKeyScan){
            for(const key of Object.keys(bodyFacts))if(/^Moon of\b/i.test(bodyFacts[key]?.kind||'') ||
                bodyFacts[key]?.kind==='Natural Satellite' || bodyFacts[key]?.kind==='Comet')markerKeys.add(key);
            nextKeyScan=now+500;
        }
        const labelMode=typeof getLabelMode==='function'?getLabelMode():'symbols';
        for(const key of markerKeys){
            const body=objectRegistry[key];if(!body?.geometry)continue;
            const e=entries.get(key)||create(key,body);
            body.getWorldPosition(world);body.getWorldScale(scale);
            view.copy(world).applyMatrix4(camera.matrixWorldInverse);
            const radius=(body.geometry.parameters.radius||0)*Math.max(Math.abs(scale.x),Math.abs(scale.y),Math.abs(scale.z));
            const depth=-view.z;
            const pixelRadius=radius*camera.projectionMatrix.elements[5]*rect.height/(2*Math.max(depth,camera.near));
            const ndc=view.copy(world).project(camera);
            let onScreen=visible(body)&&depth>radius&&ndc.z>-1&&ndc.z<1&&Math.abs(ndc.x)<1&&Math.abs(ndc.y)<1;
            if(onScreen&&bodyGlowMarkers)onScreen=!bodyGlowMarkers.occluded(body,world);
            paintMarkerText(e,key);
            const symbolsMode=labelMode==='symbols';
            const namesMode=labelMode==='names';
            style(e.glyphEl,'display',symbolsMode&&e.glyph?'':'none');
            style(e.ring,'display',symbolsMode&&!e.glyph?'':'none');
            style(e.nameEl,'display',namesMode?'':'none');
            let show=markersEnabled&&labelMode!=='off'&&onScreen;
            const x=(ndc.x*.5+.5)*rect.width,y=(-ndc.y*.5+.5)*rect.height;
            if(show&&e.moon&&body!==focusedObject){
                const parentKey=body.userData.parentKey||(key==='moon'?'earth':null),parent=objectRegistry[parentKey];
                if(parent){parent.getWorldPosition(symbolParent);symbolParent.project(camera);const px=(symbolParent.x*.5+.5)*rect.width,py=(-symbolParent.y*.5+.5)*rect.height;show=Math.hypot(x-px,y-py)>=40;}
            }
            paintMarker(key,e);
            if(show){
                const labelWidth=(namesMode?e.nameW:Math.max(e.glyphW,16))+12;
                const halfWidth=labelWidth*0.5;
                const labelX=Math.max(MARKER_PAD+halfWidth,Math.min(rect.width-MARKER_PAD-halfWidth,x));
                const labelY=Math.max(MARKER_PAD+MARKER_BOX_H*0.5,Math.min(rect.height-MARKER_PAD-MARKER_BOX_H*0.5,y-Math.max(20,pixelRadius+16)));
                const box={x:labelX,y:labelY,w:labelWidth,h:MARKER_BOX_H};
                attr(e.group,'transform',`translate(${box.x.toFixed(3)} ${box.y.toFixed(3)})`);
                symbolCandidates.push({entry:e,rank:e.labelRank,box});
            }else{
                style(e.group,'display','none');
                style(e.group,'opacity','0');
                attr(e.group,'aria-hidden','true');
                for(const button of [e.hit,e.nameHit]){
                    style(button,'pointerEvents','none');attr(button,'tabindex','-1');
                    if(document.activeElement===button)button.blur();
                }
                if(hovered===key)highlight(null);
            }
        }
        symbolCandidates.sort((a,b)=>a.rank-b.rank||a.box.x-b.box.x);
        const placedBoxes=[];
        for(const candidate of symbolCandidates){
            const e=candidate.entry,box=candidate.box;
            let free=boxOnScreen(box,rect.width,rect.height);
            if(free)for(const placed of placedBoxes){if(!boxesClear(box,placed)){free=false;break;}}
            if(free)placedBoxes.push(box);
            style(e.group,'display','');
            style(e.group,'opacity',free?'1':'0');
            attr(e.group,'aria-hidden',String(!free));
            for(const button of [e.hit,e.nameHit]){
                style(button,'pointerEvents',free?'all':'none');
                attr(button,'tabindex',free?'0':'-1');
                if(!free&&document.activeElement===button)button.blur();
            }
            if(!free&&hovered===e.key)highlight(null);
        }
    },dispose(){document.fonts?.removeEventListener('loadingdone',invalidateTextMetrics);for(const [key,e]of entries)remove(key,e);svg.remove();}};
}