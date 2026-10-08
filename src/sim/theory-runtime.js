(function(g) {
    const AU=149597870.7, YEAR=31557600, TAU=2*Math.PI;
    class Matrix3 {
        constructor(){this.elements=[1,0,0,0,1,0,0,0,1];}
        set(a,b,c,d,e,f,h,i,j){this.elements=[a,d,h,b,e,i,c,f,j];return this;}
        multiplyMatrices(a,b){
            const x=a.elements,y=b.elements,z=new Array(9);
            for(let col=0;col<3;col++)for(let row=0;row<3;row++)
                z[col*3+row]=x[row]*y[col*3]+x[row+3]*y[col*3+1]+x[row+6]*y[col*3+2];
            this.elements=z;return this;
        }
    }
    g.THREE={Matrix3};
    g.CYCLE=x=>((x%TAU)+TAU)%TAU;
    Math.fmod=(x,y)=>x%y;
    g.JY2KtoJD=y=>2451545+y*365.25;
    const factor=YEAR*YEAR/(AU*AU*AU);
    g.GMJY={ear:398600.435436*factor,moon:4902.800066*factor};
    g.VSOP=function(raw,name,GM,coeffs,toVSOP,givesMeanMotion){
        const model={name,GM,coeffs,toVSOP,givesMeanMotion};
        model.raw=(years,out=[])=>raw(model,years,out,false,false,0);
        return model;
    };
    g.STATE=function(raw,name,GM,coeffs){
        const model={name,GM,coeffs};
        model.raw=(years,out=[])=>raw(model,years,out,false,false,0);
        return model;
    };
    function rotate(v,m){
        if(!m)return v;
        const e=m.elements,x=v[0],y=v[1],z=v[2];
        return [e[0]*x+e[3]*y+e[6]*z,e[1]*x+e[4]*y+e[7]*z,e[2]*x+e[5]*y+e[8]*z];
    }
    function planetFrame(v) {
        const arc=Math.PI/(180*3600),ep=84381.41136*arc,phi=-0.05188*arc,ref=84381.448*arc;
        const y=Math.cos(ep)*v[1]-Math.sin(ep)*v[2],z=Math.sin(ep)*v[1]+Math.cos(ep)*v[2];
        const xq=Math.cos(phi)*v[0]-Math.sin(phi)*y,yq=Math.sin(phi)*v[0]+Math.cos(phi)*y;
        return [xq,Math.cos(ref)*yq+Math.sin(ref)*z,-Math.sin(ref)*yq+Math.cos(ref)*z];
    }
    function elements(model,seconds) {
        const years=seconds/YEAR, q=model.raw(years,[]);
        let a=q[0];
        if(model.givesMeanMotion){const n=a*model.givesMeanMotion;a=Math.cbrt(model.GM/(n*n));}
        const e=Math.hypot(q[2],q[3]);
        const inc=2*Math.asin(Math.min(1,Math.hypot(q[4],q[5])));
        const node=Math.atan2(q[5],q[4]),peri=Math.atan2(q[3],q[2]);
        let M=g.CYCLE(q[1]-peri);if(M>Math.PI)M-=TAU;
        let E=M;
        for(let k=0;k<16;k++){const d=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));E-=d;if(Math.abs(d)<1e-14)break;}
        const w=peri-node,cw=Math.cos(w),sw=Math.sin(w),co=Math.cos(node),so=Math.sin(node),ci=Math.cos(inc),si=Math.sin(inc);
        let U=[(cw*co-sw*so*ci)*a*AU,(cw*so+sw*co*ci)*a*AU,sw*si*a*AU];
        let V=[(-sw*co-cw*so*ci)*a*AU,(-sw*so+cw*co*ci)*a*AU,cw*si*a*AU];
        let matrix=model.toVSOP;
        if(typeof matrix==='function'){const m=new Matrix3();matrix(years,m);matrix=m;}
        U=rotate(U,matrix);V=rotate(V,matrix);
        if (!model.toVSOP) { U=planetFrame(U); V=planetFrame(V); }
        const scale=Math.sqrt(1-e*e),cx=Math.cos(E)-e,sy=Math.sin(E)*scale;
        const position=U.map((u,i)=>u*cx+V[i]*sy);
        if(!position.every(Number.isFinite))throw new Error(`Non-finite ${model.name} position`);
        return {position,U,V:V.map(x=>x*scale),e,E,aKm:a*AU,periodDays:TAU*Math.sqrt(a*a*a/model.GM)*365.25};
    }
    g.TheoryRuntime={AU,YEAR,elements,
        lunarPosition(ttSeconds){
            const q=g.elpmpp02.llr.raw(ttSeconds/YEAR,[]);
            return q.slice(0,3).map(x=>x/6.6846e-9);
        }
    };
})(globalThis);