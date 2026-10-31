import { PathLines } from "./path-lines.js";

import { LDB_FRAGMENT_PARS, LDB_FRAGMENT_HEAD } from "../render/log-depth-glsl.js";

export class WorldTrails extends PathLines {
    setHighlighted(key) {
        this.highlightedKey = key || null;
    }
    create(info) {
        const entry = super.create(info);
        const material = entry.mesh.material;
        material.uniforms.uHover = {
            value: 0
        };
        material.uniforms.uDpr = {
            value: 1
        };
        material.uniforms.uWidth = {
            value: 1
        };
        material.fragmentShader = `uniform vec3 tint;\n   uniform float uWidth;uniform float strength;uniform float halfWidth;uniform float uHover;uniform float uDpr;\n   varying float vSide;varying float vFade;${LDB_FRAGMENT_PARS}\n   void main(){${LDB_FRAGMENT_HEAD}\n    float d=abs(vSide)*halfWidth/(max(uDpr,1.0)*uWidth);\n    float core=1.0-smoothstep(0.45,1.05,d);\n    float glow=exp(-d*d/5.0)*0.30*uHover;\n    float alpha=(core*0.75+glow)*clamp(vFade,0.0,1.0)*strength;\n    if(alpha<0.002)discard;\n    gl_FragColor=vec4(mix(tint,vec3(1.0),0.30*uHover),min(alpha,0.95));\n   }`;
        return entry;
    }
    update(state) {
        super.update(state);
        const dpr = this.renderer.getPixelRatio();
        const width = Math.max(.1, this.getSettings().width);
        for (const [key, entry] of this.entries) {
            const u = entry.mesh.material.uniforms;
            u.uHover.value = key === this.highlightedKey ? 1 : 0;
            u.uDpr.value = dpr;
            u.uWidth.value = width;
            u.halfWidth.value = (u.uHover.value ? 4.5 : 1.15) * dpr * width;
        }
    }
}
