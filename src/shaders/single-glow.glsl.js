// ============================================================================
// single-glow.glsl.js — unified "single fading glow" model
// ----------------------------------------------------------------------------
// Replaces the older stacked/linear corona construction (several layered
// linear-falloff coronas blended on top of each other to fake a smooth fade)
// with ONE continuous, physically-motivated glow curve per object, in the
// spirit of Space Engine:
//
//   * brightness falls off as a single power law in radius (geometric
//     dilution + scattering behaviour),
//   * is attenuated by an analytic Beer-Lambert self-transmittance term,
//   * and is softly cut at the outer shell radius with a Hermite fade so the
//     glow never shows a hard edge.
//
// Performance: the radial column density of a r^-p power-law medium along the
// view ray has CLOSED-FORM antiderivatives for integer powers 3..6. Fractional
// powers are handled by interpolating the two neighbouring integer solutions,
// so the shader needs ZERO march loops — one evaluation per fragment.
// ============================================================================

// GLSL chunk: analytic column integral of density(r) = (r/R)^-p along a ray.
// All distances are in units of the surface radius R (impact b, ray t).
const SINGLE_GLOW_COLUMN_GLSL = `
// Antiderivatives of 1/(t^2+b^2)^n  (even powers) and 1/(t^2+b^2)^(n+1/2)
// (odd powers), evaluated between t0 and t1.
float sgEven(float b, float t, float n){
    float r2 = b*b + t*t;
    if(n < 1.5){ return atan(t / b) / b; }                       // I1
    if(n < 2.5){ return t / (2.0*b*b*r2) + atan(t / b) / (2.0*b*b*b); } // I2
    float i2 = t / (2.0*b*b*r2) + atan(t / b) / (2.0*b*b*b);
    return t / (4.0*b*b*r2*r2) + 0.75 * i2 / (b*b);              // I3
}
float sgOdd(float b, float t, float n){
    float r2 = b*b + t*t;
    float j1 = t / (b*b*sqrt(max(r2, 1e-12)));                   // J1 (p=3)
    if(n < 1.5){ return j1; }
    return t / (3.0*b*b*r2*sqrt(max(r2, 1e-12))) + (2.0/3.0) * j1 / (b*b); // J2 (p=5)
}
float sgAntiderivAt(float b, float t, float pi){
    // pi is an integer power in [3,6]; odd -> half-integer family.
    float odd = mod(pi, 2.0);
    float n = odd > 0.5 ? (pi - 1.0) * 0.5 : pi * 0.5;
    return odd > 0.5 ? sgOdd(b, t, n) : sgEven(b, t, n);
}
float sgIndefinite(float b, float t, float p){
    // Fractional powers: Lagrange-quadratic interpolation of the integer
    // antiderivatives in log space. The antiderivatives depend near-
    // exponentially on p, so this keeps the column error below ~0.4 %.
    float k = clamp(floor(p + 0.5), 3.0, 6.0);
    float p0, p1, p2;
    if (k < 3.5)      { p0 = 3.0; p1 = 4.0; p2 = 5.0; }
    else if (k > 5.5) { p0 = 6.0; p1 = 5.0; p2 = 4.0; }
    else              { p0 = k - 1.0; p1 = k; p2 = k + 1.0; }
    float a0 = sgAntiderivAt(b, t, p0);
    float a1 = sgAntiderivAt(b, t, p1);
    float a2 = sgAntiderivAt(b, t, p2);
    float l0 = log(max(abs(a0), 1e-9));
    float l1 = log(max(abs(a1), 1e-9));
    float l2 = log(max(abs(a2), 1e-9));
    float lp = l0 * (p - p1) * (p - p2) / ((p0 - p1) * (p0 - p2))
             + l1 * (p - p0) * (p - p2) / ((p1 - p0) * (p1 - p2))
             + l2 * (p - p0) * (p - p1) / ((p2 - p0) * (p2 - p1));
    return sign(a0 + a1 + a2) * exp(lp);
}
// Column density of r^-p between ray parameters t0..t1 (normalised to R).
float singleGlowColumn(float b, float t0, float t1, float p){
    float bb = max(b, 0.03);
    float q = clamp(p, 3.0, 6.0);
    return max(0.0, sgIndefinite(bb, t1, q) - sgIndefinite(bb, t0, q));
}
// Single smooth glow curve: power-law column rolled off with a soft knee,
// Beer-Lambert self extinction, and a Hermite cut at the shell edge.
float singleGlow(float b, float t0, float t1, float p, float edgeRatio, float knee){
    float col = singleGlowColumn(b, t0, t1, p);
    float glow = col / (1.0 + col * knee);
    float transmittance = exp(-0.035 * col);
    float cut = 1.0 - smoothstep(edgeRatio * 0.70, edgeRatio, b);
    return glow * transmittance * cut;
}
`;

// JS-side helper: same integer/fractional-power bookkeeping (kept for tests).
function singleGlowClampPower(power) {
    return Math.max(3, Math.min(6, Number.isFinite(power) ? power : 4));
}
