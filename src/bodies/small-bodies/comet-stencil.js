export function configureNucleusStencil(THREE,material){
    material.stencilWrite=true;material.stencilRef=1;
    material.stencilWriteMask=1;material.stencilFuncMask=1;
    material.stencilFunc=THREE.AlwaysStencilFunc;
    material.stencilFail=THREE.KeepStencilOp;
    material.stencilZFail=THREE.KeepStencilOp;
    material.stencilZPass=THREE.ReplaceStencilOp;
}

export function useNucleusStencil(THREE,renderer,material,nucleus){
    const target=renderer.getRenderTarget();
    const available=target?target.stencilBuffer:renderer.getContext().getContextAttributes()?.stencil;
    const enabled=!!available&&renderer.autoClear&&(nucleus.material?.opacity??1)>=.999;
    material.stencilWrite=enabled;
    if(enabled){
        material.stencilRef=1;material.stencilWriteMask=0;material.stencilFuncMask=1;
        material.stencilFunc=THREE.NotEqualStencilFunc;
        material.stencilFail=THREE.KeepStencilOp;
        material.stencilZFail=THREE.KeepStencilOp;
        material.stencilZPass=THREE.KeepStencilOp;
    }
    return enabled;
}
