// FXAA 3.11 (quality preset 12), applied after the tone curve.
//
// The shader below is a mechanical transform of NVIDIA's reference
// implementation: the desktop-GL preamble is dropped, the vertex stage is
// replaced (this file's own vertex shader feeds it the same pixel coordinates
// the reference's does), `texture` becomes `texture2D`, `OutColor` becomes
// `gl_FragColor`, and the luma is computed from RGB (NVIDIA's `Lum` variant)
// because our toned image carries no luma in alpha. Nothing else -- no
// coefficient, no threshold, no ordering -- is touched, and the preset block is
// kept whole so the quality is one #define away from any other preset exactly
// as NVIDIA ships it.
//
// Why this stage, when the scene already renders with 4x MSAA: MSAA resolves
// geometry edges inside the scene buffer, but the atmosphere's own edge -- the
// limb, where a hundred kilometres of air fade to nothing -- is a shading edge,
// not a geometry edge, and MSAA cannot see it. FXAA works on final luminance
// and can. That is also why it runs after the tone curve: the curve compresses
// highlights, and the thresholds are stated in what the eye receives.
//
// Defaults are NVIDIA's documented ones for the quality presets:
// subpix 0.75, edge threshold 0.166, edge threshold min 0.0833.

const FXAA_QUALITY = { subpix: 0.75, edgeThreshold: 0.166, edgeThresholdMin: 0.0833 };

const FXAA_FRAGMENT = `

//                     NVIDIA FXAA 3.11 by TIMOTHY LOTTES
//
// COPYRIGHT (C) 2010, 2011 NVIDIA CORPORATION. ALL RIGHTS RESERVED.
//
// TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THIS SOFTWARE IS PROVIDED
// *AS IS* AND NVIDIA AND ITS SUPPLIERS DISCLAIM ALL WARRANTIES, EITHER EXPRESS
// OR IMPLIED, INCLUDING, BUT NOT LIMITED TO, IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. IN NO EVENT SHALL
// NVIDIA OR ITS SUPPLIERS BE LIABLE FOR ANY SPECIAL, INCIDENTAL, INDIRECT, OR
// CONSEQUENTIAL DAMAGES WHATSOEVER (INCLUDING, WITHOUT LIMITATION, DAMAGES FOR
// LOSS OF BUSINESS PROFITS, BUSINESS INTERRUPTION, LOSS OF BUSINESS
// INFORMATION, OR ANY OTHER PECUNIARY LOSS) ARISING OUT OF THE USE OF OR
// INABILITY TO USE THIS SOFTWARE, EVEN IF NVIDIA HAS BEEN ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGES.

//=============================================================================
//                           FXAA QUALITY PRESETS
//=============================================================================

// Choose the quality preset.
// This needs to be compiled into the shader as it effects code.

#define FXAA_QUALITY__PRESET 12

// OPTIONS
// -----------------------------------------------------------------------
// 10 to 15 - default medium dither (10=fastest, 15=highest quality)
// 20 to 29 - less dither, more expensive (20=fastest, 29=highest quality)
// 39       - no dither, very expensive 
//
// NOTES
// -----------------------------------------------------------------------
// 12 = slightly faster then FXAA 3.9 and higher edge quality (default)
// 13 = about same speed as FXAA 3.9 and better than 12
// 23 = closest to FXAA 3.9 visually and performance wise
//  ^-- the lowest digit is directly related to performance
// ^--- the highest digit is directly related to style

//=============================================================================
//                  FXAA QUALITY - MEDIUM DITHER PRESETS
//=============================================================================
#if (FXAA_QUALITY__PRESET == 10)
    #define FXAA_QUALITY__PS 3
    #define FXAA_QUALITY__P0 1.5
    #define FXAA_QUALITY__P1 3.0
    #define FXAA_QUALITY__P2 12.0
#endif
//-----------------------------------------------------------------------------
#if (FXAA_QUALITY__PRESET == 11)
    #define FXAA_QUALITY__PS 4
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.5
    #define FXAA_QUALITY__P2 3.0
    #define FXAA_QUALITY__P3 12.0
#endif
//-----------------------------------------------------------------------------
#if (FXAA_QUALITY__PRESET == 12)
    #define FXAA_QUALITY__PS 5
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.5
    #define FXAA_QUALITY__P2 2.0
    #define FXAA_QUALITY__P3 4.0
    #define FXAA_QUALITY__P4 12.0
#endif
//-----------------------------------------------------------------------------
#if (FXAA_QUALITY__PRESET == 13)
    #define FXAA_QUALITY__PS 6
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.5
    #define FXAA_QUALITY__P2 2.0
    #define FXAA_QUALITY__P3 2.0
    #define FXAA_QUALITY__P4 4.0
    #define FXAA_QUALITY__P5 12.0
#endif
//-----------------------------------------------------------------------------
#if (FXAA_QUALITY__PRESET == 14)
    #define FXAA_QUALITY__PS 7
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.5
    #define FXAA_QUALITY__P2 2.0
    #define FXAA_QUALITY__P3 2.0
    #define FXAA_QUALITY__P4 2.0
    #define FXAA_QUALITY__P5 4.0
    #define FXAA_QUALITY__P6 12.0
#endif
//-----------------------------------------------------------------------------
#if (FXAA_QUALITY__PRESET == 15)
    #define FXAA_QUALITY__PS 8
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.5
    #define FXAA_QUALITY__P2 2.0
    #define FXAA_QUALITY__P3 2.0
    #define FXAA_QUALITY__P4 2.0
    #define FXAA_QUALITY__P5 2.0
    #define FXAA_QUALITY__P6 4.0
    #define FXAA_QUALITY__P7 12.0
#endif

//=============================================================================
//                  FXAA QUALITY - LOW DITHER PRESETS
//=============================================================================
#if (FXAA_QUALITY__PRESET == 20)
    #define FXAA_QUALITY__PS 3
    #define FXAA_QUALITY__P0 1.5
    #define FXAA_QUALITY__P1 2.0
    #define FXAA_QUALITY__P2 8.0
#endif
//-----------------------------------------------------------------------------
#if (FXAA_QUALITY__PRESET == 21)
    #define FXAA_QUALITY__PS 4
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.5
    #define FXAA_QUALITY__P2 2.0
    #define FXAA_QUALITY__P3 8.0
#endif
//-----------------------------------------------------------------------------
#if (FXAA_QUALITY__PRESET == 22)
    #define FXAA_QUALITY__PS 5
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.5
    #define FXAA_QUALITY__P2 2.0
    #define FXAA_QUALITY__P3 2.0
    #define FXAA_QUALITY__P4 8.0
#endif
//-----------------------------------------------------------------------------
#if (FXAA_QUALITY__PRESET == 23)
    #define FXAA_QUALITY__PS 6
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.5
    #define FXAA_QUALITY__P2 2.0
    #define FXAA_QUALITY__P3 2.0
    #define FXAA_QUALITY__P4 2.0
    #define FXAA_QUALITY__P5 8.0
#endif
//-----------------------------------------------------------------------------
#if (FXAA_QUALITY__PRESET == 24)
    #define FXAA_QUALITY__PS 7
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.5
    #define FXAA_QUALITY__P2 2.0
    #define FXAA_QUALITY__P3 2.0
    #define FXAA_QUALITY__P4 2.0
    #define FXAA_QUALITY__P5 3.0
    #define FXAA_QUALITY__P6 8.0
#endif
//-----------------------------------------------------------------------------
#if (FXAA_QUALITY__PRESET == 25)
    #define FXAA_QUALITY__PS 8
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.5
    #define FXAA_QUALITY__P2 2.0
    #define FXAA_QUALITY__P3 2.0
    #define FXAA_QUALITY__P4 2.0
    #define FXAA_QUALITY__P5 2.0
    #define FXAA_QUALITY__P6 4.0
    #define FXAA_QUALITY__P7 8.0
#endif
//-----------------------------------------------------------------------------
#if (FXAA_QUALITY__PRESET == 26)
    #define FXAA_QUALITY__PS 9
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.5
    #define FXAA_QUALITY__P2 2.0
    #define FXAA_QUALITY__P3 2.0
    #define FXAA_QUALITY__P4 2.0
    #define FXAA_QUALITY__P5 2.0
    #define FXAA_QUALITY__P6 2.0
    #define FXAA_QUALITY__P7 4.0
    #define FXAA_QUALITY__P8 8.0
#endif
//-----------------------------------------------------------------------------
#if (FXAA_QUALITY__PRESET == 27)
    #define FXAA_QUALITY__PS 10
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.5
    #define FXAA_QUALITY__P2 2.0
    #define FXAA_QUALITY__P3 2.0
    #define FXAA_QUALITY__P4 2.0
    #define FXAA_QUALITY__P5 2.0
    #define FXAA_QUALITY__P6 2.0
    #define FXAA_QUALITY__P7 2.0
    #define FXAA_QUALITY__P8 4.0
    #define FXAA_QUALITY__P9 8.0
#endif
//-----------------------------------------------------------------------------
#if (FXAA_QUALITY__PRESET == 28)
    #define FXAA_QUALITY__PS 11
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.5
    #define FXAA_QUALITY__P2 2.0
    #define FXAA_QUALITY__P3 2.0
    #define FXAA_QUALITY__P4 2.0
    #define FXAA_QUALITY__P5 2.0
    #define FXAA_QUALITY__P6 2.0
    #define FXAA_QUALITY__P7 2.0
    #define FXAA_QUALITY__P8 2.0
    #define FXAA_QUALITY__P9 4.0
    #define FXAA_QUALITY__P10 8.0
#endif
//-----------------------------------------------------------------------------
#if (FXAA_QUALITY__PRESET == 29)
    #define FXAA_QUALITY__PS 12
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.5
    #define FXAA_QUALITY__P2 2.0
    #define FXAA_QUALITY__P3 2.0
    #define FXAA_QUALITY__P4 2.0
    #define FXAA_QUALITY__P5 2.0
    #define FXAA_QUALITY__P6 2.0
    #define FXAA_QUALITY__P7 2.0
    #define FXAA_QUALITY__P8 2.0
    #define FXAA_QUALITY__P9 2.0
    #define FXAA_QUALITY__P10 4.0
    #define FXAA_QUALITY__P11 8.0
#endif

//=============================================================================
//                      FXAA QUALITY - EXTREME QUALITY
//=============================================================================
#if (FXAA_QUALITY__PRESET == 39)
    #define FXAA_QUALITY__PS 12
    #define FXAA_QUALITY__P0 1.0
    #define FXAA_QUALITY__P1 1.0
    #define FXAA_QUALITY__P2 1.0
    #define FXAA_QUALITY__P3 1.0
    #define FXAA_QUALITY__P4 1.0
    #define FXAA_QUALITY__P5 1.5
    #define FXAA_QUALITY__P6 2.0
    #define FXAA_QUALITY__P7 2.0
    #define FXAA_QUALITY__P8 2.0
    #define FXAA_QUALITY__P9 2.0
    #define FXAA_QUALITY__P10 4.0
    #define FXAA_QUALITY__P11 8.0
#endif



//=============================================================================
//                              SHADER UNIFORMS
//=============================================================================

// Input color texture.
// RGB = color in linear or perceptual color space
// A   = luma in perceptual color space (not linear)
uniform sampler2D uTex;

uniform vec4 RcpFrame;      // ( pixelStepX, pixelStepY, FrameWidth, FrameHeight )
uniform vec3 QualityParams; // ( Subpix, EdgeThreshold, EdgeThresholdMin )

// This used to be the FXAA_QUALITY__SUBPIX define.
// Choose the amount of sub-pixel aliasing removal.
// This can effect sharpness.
//   1.00 - upper limit (softer)
//   0.75 - default amount of filtering
//   0.50 - lower limit (sharper, less sub-pixel aliasing removal)
//   0.25 - almost off
//   0.00 - completely off
#define Subpix       QualityParams.x

// This used to be the FXAA_QUALITY__EDGE_THRESHOLD define.
// The minimum amount of local contrast required to apply algorithm.
//   0.333 - too little (faster)
//   0.250 - low quality
//   0.166 - default
//   0.125 - high quality 
//   0.063 - overkill (slower)
#define EdgeThreshold    QualityParams.y

// This used to be the FXAA_QUALITY__EDGE_THRESHOLD_MIN define.
// Trims the algorithm from processing darks.
//   0.0833 - upper limit (default, the start of visible unfiltered edges)
//   0.0625 - high quality (faster)
//   0.0312 - visible limit (slower)
#define EdgeThresholdMin     QualityParams.z


//=============================================================================
//                              FXAA shader
//=============================================================================

// Use noperspective interpolation here (turn off perspective interpolation).
varying vec2 pos;



#define saturate(x) clamp(x, 0.0, 1.0)

float   Lum(vec4 Color)
{
    //return sqrt(dot(Color.rgb, vec3(0.299, 0.587, 0.114)));
	return dot(Color.rgb, vec3(0.299, 0.587, 0.114));
}

void main()
{
    vec2 posM;
    posM.x = pos.x;
    posM.y = pos.y;

    // alpha channel of Tex must be a pixel luma
    vec4  rgbyM = texture2D(uTex, posM * RcpFrame.zw);
    float rgbyMlum = Lum(rgbyM);
    float lumaS = Lum(texture2D(uTex, (posM + vec2( 0, 1)) * RcpFrame.zw));
    float lumaE = Lum(texture2D(uTex, (posM + vec2( 1, 0)) * RcpFrame.zw));
    float lumaN = Lum(texture2D(uTex, (posM + vec2( 0,-1)) * RcpFrame.zw));
    float lumaW = Lum(texture2D(uTex, (posM + vec2(-1, 0)) * RcpFrame.zw));

    float maxSM  = max(lumaS, rgbyMlum);
    float minSM  = min(lumaS, rgbyMlum);
    float maxESM = max(lumaE, maxSM);
    float minESM = min(lumaE, minSM);
    float maxWN  = max(lumaN, lumaW);
    float minWN  = min(lumaN, lumaW);
    float rangeMax = max(maxWN, maxESM);
    float rangeMin = min(minWN, minESM);
    float rangeMaxScaled = rangeMax * EdgeThreshold;
    float range = rangeMax - rangeMin;

    if (range >= max(EdgeThresholdMin, rangeMaxScaled))
    {
        // compute antialiased color

        float lumaNW = Lum(texture2D(uTex, (posM + vec2(-1,-1)) * RcpFrame.zw));
        float lumaSE = Lum(texture2D(uTex, (posM + vec2( 1, 1)) * RcpFrame.zw));
        float lumaNE = Lum(texture2D(uTex, (posM + vec2( 1,-1)) * RcpFrame.zw));
        float lumaSW = Lum(texture2D(uTex, (posM + vec2(-1, 1)) * RcpFrame.zw));

        float lumaNS = lumaN + lumaS;
        float lumaWE = lumaW + lumaE;
        float subpixRcpRange = 1.0/range;
        float subpixNSWE = lumaNS + lumaWE;
        float edgeHorz1 = (-2.0 * rgbyMlum) + lumaNS;
        float edgeVert1 = (-2.0 * rgbyMlum) + lumaWE;

        float lumaNESE = lumaNE + lumaSE;
        float lumaNWNE = lumaNW + lumaNE;
        float edgeHorz2 = (-2.0 * lumaE) + lumaNESE;
        float edgeVert2 = (-2.0 * lumaN) + lumaNWNE;

        float lumaNWSW = lumaNW + lumaSW;
        float lumaSWSE = lumaSW + lumaSE;
        float edgeHorz4 = (abs(edgeHorz1) * 2.0) + abs(edgeHorz2);
        float edgeVert4 = (abs(edgeVert1) * 2.0) + abs(edgeVert2);
        float edgeHorz3 = (-2.0 * lumaW) + lumaNWSW;
        float edgeVert3 = (-2.0 * lumaS) + lumaSWSE;
        float edgeHorz = abs(edgeHorz3) + edgeHorz4;
        float edgeVert = abs(edgeVert3) + edgeVert4;

        float subpixNWSWNESE = lumaNWSW + lumaNESE;
        float lengthSign = RcpFrame.x;
        bool  horzSpan = edgeHorz >= edgeVert;
        float subpixA = subpixNSWE * 2.0 + subpixNWSWNESE;

        if (!horzSpan) lumaN = lumaW;
        if (!horzSpan) lumaS = lumaE;
        if (horzSpan) lengthSign = RcpFrame.y;
        float subpixB = (subpixA * (1.0/12.0)) - rgbyMlum;

        float gradientN = lumaN - rgbyMlum;
        float gradientS = lumaS - rgbyMlum;
        float lumaNN = lumaN + rgbyMlum;
        float lumaSS = lumaS + rgbyMlum;
        bool pairN = abs(gradientN) >= abs(gradientS);
        float gradient = max(abs(gradientN), abs(gradientS));
        if (pairN) lengthSign = -lengthSign;
        //float subpixC = saturate(abs(subpixB) * subpixRcpRange);
        float subpixC = abs(subpixB) * subpixRcpRange;

        vec2 posB;
        posB.x = posM.x;
        posB.y = posM.y;
        vec2 offNP;
        offNP.x = (!horzSpan) ? 0.0 : RcpFrame.x;
        offNP.y = ( horzSpan) ? 0.0 : RcpFrame.y;
        if (!horzSpan) posB.x += lengthSign * 0.5;
        if ( horzSpan) posB.y += lengthSign * 0.5;

        vec2 posN;
        posN.x = posB.x - offNP.x * FXAA_QUALITY__P0;
        posN.y = posB.y - offNP.y * FXAA_QUALITY__P0;
        vec2 posP;
        posP.x = posB.x + offNP.x * FXAA_QUALITY__P0;
        posP.y = posB.y + offNP.y * FXAA_QUALITY__P0;
        float subpixD = ((-2.0)*subpixC) + 3.0;
        float lumaEndN = Lum(texture2D(uTex, posN * RcpFrame.zw));
        float subpixE = subpixC * subpixC;
        float lumaEndP = Lum(texture2D(uTex, posP * RcpFrame.zw));

        if (!pairN) lumaNN = lumaSS;
        float gradientScaled = gradient * 1.0/4.0;
        float lumaMM = rgbyMlum - lumaNN * 0.5;
        float subpixF = subpixD * subpixE;
        bool lumaMLTZero = lumaMM < 0.0;

        lumaEndN -= lumaNN * 0.5;
        lumaEndP -= lumaNN * 0.5;
        bool doneN = abs(lumaEndN) >= gradientScaled;
        bool doneP = abs(lumaEndP) >= gradientScaled;
        if (!doneN) posN.x -= offNP.x * FXAA_QUALITY__P1;
        if (!doneN) posN.y -= offNP.y * FXAA_QUALITY__P1;
        bool doneNP = (!doneN) || (!doneP);
        if (!doneP) posP.x += offNP.x * FXAA_QUALITY__P1;
        if (!doneP) posP.y += offNP.y * FXAA_QUALITY__P1;

        if (doneNP)
        {
            if (!doneN) lumaEndN = Lum(texture2D(uTex, posN.xy * RcpFrame.zw));
            if (!doneP) lumaEndP = Lum(texture2D(uTex, posP.xy * RcpFrame.zw));
            if (!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
            if (!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
            doneN = abs(lumaEndN) >= gradientScaled;
            doneP = abs(lumaEndP) >= gradientScaled;
            if (!doneN) posN.x -= offNP.x * FXAA_QUALITY__P2;
            if (!doneN) posN.y -= offNP.y * FXAA_QUALITY__P2;
            doneNP = (!doneN) || (!doneP);
            if (!doneP) posP.x += offNP.x * FXAA_QUALITY__P2;
            if (!doneP) posP.y += offNP.y * FXAA_QUALITY__P2;

            #if (FXAA_QUALITY__PS > 3)
            if (doneNP)
            {
                if (!doneN) lumaEndN = Lum(texture2D(uTex, posN.xy * RcpFrame.zw));
                if (!doneP) lumaEndP = Lum(texture2D(uTex, posP.xy * RcpFrame.zw));
                if (!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
                if (!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
                doneN = abs(lumaEndN) >= gradientScaled;
                doneP = abs(lumaEndP) >= gradientScaled;
                if (!doneN) posN.x -= offNP.x * FXAA_QUALITY__P3;
                if (!doneN) posN.y -= offNP.y * FXAA_QUALITY__P3;
                doneNP = (!doneN) || (!doneP);
                if (!doneP) posP.x += offNP.x * FXAA_QUALITY__P3;
                if (!doneP) posP.y += offNP.y * FXAA_QUALITY__P3;

                #if (FXAA_QUALITY__PS > 4)
                if (doneNP)
                {
                    if (!doneN) lumaEndN = Lum(texture2D(uTex, posN.xy * RcpFrame.zw));
                    if (!doneP) lumaEndP = Lum(texture2D(uTex, posP.xy * RcpFrame.zw));
                    if (!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
                    if (!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
                    doneN = abs(lumaEndN) >= gradientScaled;
                    doneP = abs(lumaEndP) >= gradientScaled;
                    if (!doneN) posN.x -= offNP.x * FXAA_QUALITY__P4;
                    if (!doneN) posN.y -= offNP.y * FXAA_QUALITY__P4;
                    doneNP = (!doneN) || (!doneP);
                    if (!doneP) posP.x += offNP.x * FXAA_QUALITY__P4;
                    if (!doneP) posP.y += offNP.y * FXAA_QUALITY__P4;

                    #if (FXAA_QUALITY__PS > 5)
                    if (doneNP)
                    {
                        if (!doneN) lumaEndN = Lum(texture2D(uTex, posN.xy * RcpFrame.zw));
                        if (!doneP) lumaEndP = Lum(texture2D(uTex, posP.xy * RcpFrame.zw));
                        if (!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
                        if (!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
                        doneN = abs(lumaEndN) >= gradientScaled;
                        doneP = abs(lumaEndP) >= gradientScaled;
                        if (!doneN) posN.x -= offNP.x * FXAA_QUALITY__P5;
                        if (!doneN) posN.y -= offNP.y * FXAA_QUALITY__P5;
                        doneNP = (!doneN) || (!doneP);
                        if (!doneP) posP.x += offNP.x * FXAA_QUALITY__P5;
                        if (!doneP) posP.y += offNP.y * FXAA_QUALITY__P5;

                        #if (FXAA_QUALITY__PS > 6)
                        if (doneNP)
                        {
                            if (!doneN) lumaEndN = Lum(texture2D(uTex, posN.xy * RcpFrame.zw));
                            if (!doneP) lumaEndP = Lum(texture2D(uTex, posP.xy * RcpFrame.zw));
                            if (!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
                            if (!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
                            doneN = abs(lumaEndN) >= gradientScaled;
                            doneP = abs(lumaEndP) >= gradientScaled;
                            if (!doneN) posN.x -= offNP.x * FXAA_QUALITY__P6;
                            if (!doneN) posN.y -= offNP.y * FXAA_QUALITY__P6;
                            doneNP = (!doneN) || (!doneP);
                            if (!doneP) posP.x += offNP.x * FXAA_QUALITY__P6;
                            if (!doneP) posP.y += offNP.y * FXAA_QUALITY__P6;

                            #if (FXAA_QUALITY__PS > 7)
                            if (doneNP)
                            {
                                if (!doneN) lumaEndN = Lum(texture2D(uTex, posN.xy * RcpFrame.zw));
                                if (!doneP) lumaEndP = Lum(texture2D(uTex, posP.xy * RcpFrame.zw));
                                if (!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
                                if (!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
                                doneN = abs(lumaEndN) >= gradientScaled;
                                doneP = abs(lumaEndP) >= gradientScaled;
                                if (!doneN) posN.x -= offNP.x * FXAA_QUALITY__P7;
                                if (!doneN) posN.y -= offNP.y * FXAA_QUALITY__P7;
                                doneNP = (!doneN) || (!doneP);
                                if (!doneP) posP.x += offNP.x * FXAA_QUALITY__P7;
                                if (!doneP) posP.y += offNP.y * FXAA_QUALITY__P7;

                                #if (FXAA_QUALITY__PS > 8)
                                if (doneNP)
                                {
                                    if (!doneN) lumaEndN = Lum(texture2D(uTex, posN.xy * RcpFrame.zw));
                                    if (!doneP) lumaEndP = Lum(texture2D(uTex, posP.xy * RcpFrame.zw));
                                    if (!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
                                    if (!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
                                    doneN = abs(lumaEndN) >= gradientScaled;
                                    doneP = abs(lumaEndP) >= gradientScaled;
                                    if (!doneN) posN.x -= offNP.x * FXAA_QUALITY__P8;
                                    if (!doneN) posN.y -= offNP.y * FXAA_QUALITY__P8;
                                    doneNP = (!doneN) || (!doneP);
                                    if (!doneP) posP.x += offNP.x * FXAA_QUALITY__P8;
                                    if (!doneP) posP.y += offNP.y * FXAA_QUALITY__P8;

                                    #if (FXAA_QUALITY__PS > 9)
                                    if (doneNP)
                                    {
                                        if (!doneN) lumaEndN = Lum(texture2D(uTex, posN.xy * RcpFrame.zw));
                                        if (!doneP) lumaEndP = Lum(texture2D(uTex, posP.xy * RcpFrame.zw));
                                        if (!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
                                        if (!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
                                        doneN = abs(lumaEndN) >= gradientScaled;
                                        doneP = abs(lumaEndP) >= gradientScaled;
                                        if (!doneN) posN.x -= offNP.x * FXAA_QUALITY__P9;
                                        if (!doneN) posN.y -= offNP.y * FXAA_QUALITY__P9;
                                        doneNP = (!doneN) || (!doneP);
                                        if (!doneP) posP.x += offNP.x * FXAA_QUALITY__P9;
                                        if (!doneP) posP.y += offNP.y * FXAA_QUALITY__P9;

                                        #if (FXAA_QUALITY__PS > 10)
                                        if (doneNP)
                                        {
                                            if (!doneN) lumaEndN = Lum(texture2D(uTex, posN.xy * RcpFrame.zw));
                                            if (!doneP) lumaEndP = Lum(texture2D(uTex, posP.xy * RcpFrame.zw));
                                            if (!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
                                            if (!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
                                            doneN = abs(lumaEndN) >= gradientScaled;
                                            doneP = abs(lumaEndP) >= gradientScaled;
                                            if (!doneN) posN.x -= offNP.x * FXAA_QUALITY__P10;
                                            if (!doneN) posN.y -= offNP.y * FXAA_QUALITY__P10;
                                            doneNP = (!doneN) || (!doneP);
                                            if (!doneP) posP.x += offNP.x * FXAA_QUALITY__P10;
                                            if (!doneP) posP.y += offNP.y * FXAA_QUALITY__P10;

                                            #if (FXAA_QUALITY__PS > 11)
                                            if (doneNP)
                                            {
                                                if (!doneN) lumaEndN = Lum(texture2D(uTex, posN.xy * RcpFrame.zw));
                                                if (!doneP) lumaEndP = Lum(texture2D(uTex, posP.xy * RcpFrame.zw));
                                                if (!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
                                                if (!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
                                                doneN = abs(lumaEndN) >= gradientScaled;
                                                doneP = abs(lumaEndP) >= gradientScaled;
                                                if (!doneN) posN.x -= offNP.x * FXAA_QUALITY__P11;
                                                if (!doneN) posN.y -= offNP.y * FXAA_QUALITY__P11;
                                                doneNP = (!doneN) || (!doneP);
                                                if (!doneP) posP.x += offNP.x * FXAA_QUALITY__P11;
                                                if (!doneP) posP.y += offNP.y * FXAA_QUALITY__P11;

                                                #if (FXAA_QUALITY__PS > 12)
                                                if (doneNP)
                                                {
                                                    if (!doneN) lumaEndN = Lum(texture2D(uTex, posN.xy * RcpFrame.zw));
                                                    if (!doneP) lumaEndP = Lum(texture2D(uTex, posP.xy * RcpFrame.zw));
                                                    if (!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
                                                    if (!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
                                                    doneN = abs(lumaEndN) >= gradientScaled;
                                                    doneP = abs(lumaEndP) >= gradientScaled;
                                                    if (!doneN) posN.x -= offNP.x * FXAA_QUALITY__P12;
                                                    if (!doneN) posN.y -= offNP.y * FXAA_QUALITY__P12;
                                                    doneNP = (!doneN) || (!doneP);
                                                    if (!doneP) posP.x += offNP.x * FXAA_QUALITY__P12;
                                                    if (!doneP) posP.y += offNP.y * FXAA_QUALITY__P12;
                                                }
                                                #endif
                                            }
                                            #endif
                                        }
                                        #endif
                                    }
                                    #endif
                                }
                                #endif
                            }
                            #endif
                        }
                        #endif
                    }
                    #endif
                }
                #endif
            }
            #endif
        }

        float dstN = posM.x - posN.x;
        float dstP = posP.x - posM.x;
        if (!horzSpan) dstN = posM.y - posN.y;
        if (!horzSpan) dstP = posP.y - posM.y;

        bool  goodSpanN = (lumaEndN < 0.0) != lumaMLTZero;
        float spanLength = (dstP + dstN);
        bool  goodSpanP = (lumaEndP < 0.0) != lumaMLTZero;
        float spanLengthRcp = 1.0/spanLength;

        bool  directionN = dstN < dstP;
        float dst = min(dstN, dstP);
        bool  goodSpan = directionN ? goodSpanN : goodSpanP;
        float subpixG = subpixF * subpixF;
        float pixelOffset = (dst * (-spanLengthRcp)) + 0.5;
        float subpixH = subpixG * Subpix;

        float pixelOffsetGood = goodSpan ? pixelOffset : 0.0;
        float pixelOffsetSubpix = max(pixelOffsetGood, subpixH);
        if (!horzSpan) posM.x += pixelOffsetSubpix * lengthSign;
        if ( horzSpan) posM.y += pixelOffsetSubpix * lengthSign;

        gl_FragColor = vec4(texture2D(uTex, posM * RcpFrame.zw).rgb, 1.0);
    }
    else
    {
        // no antialiasing required
        gl_FragColor = rgbyM;
    }
}

//-----------------------------------------------------------------------------
`;

function createAntialias(THREE, renderer, options = {}) {
    const state = {
        enabled: options.enabled !== false,
        quality: { ...FXAA_QUALITY, ...(options.quality || {}) }
    };

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));

    const material = new THREE.ShaderMaterial({
        name: "solister antialias",
        uniforms: {
            uTex: { value: null },
            uViewport: { value: new THREE.Vector2(1, 1) },
            RcpFrame: { value: new THREE.Vector4(1, 1, 1, 1) },
            QualityParams: { value: new THREE.Vector3(0.75, 0.166, 0.0833) }
        },
        vertexShader: `
            uniform vec2 uViewport;
            varying vec2 pos;
            void main() {
                vec2 uv = position.xy * 0.5 + 0.5;
                pos = uv * uViewport;
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }
        `,
        fragmentShader: FXAA_FRAGMENT,
        depthTest: false,
        depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    return {
        scene,
        camera,
        material,
        get enabled() { return state.enabled; },
        set enabled(v) { state.enabled = !!v; },
        get quality() { return state.quality; },
        begin(texture, width, height) {
            material.uniforms.uTex.value = texture;
            material.uniforms.uViewport.value.set(width, height);
            // (pixel step x, pixel step y, 1/width, 1/height). The shader is
            // handed pixel coordinates and converts to uv itself with .zw; a
            // step along those coordinates is exactly one pixel, so .xy is 1.
            // The alternative packing -- 1/width in .xy as well -- makes every
            // search offset a width-th of a pixel, and the shader then returns
            // its input unchanged: a no-op, not an antialias.
            material.uniforms.RcpFrame.value.set(1, 1, 1 / width, 1 / height);
            const q = state.quality;
            material.uniforms.QualityParams.value.set(q.subpix, q.edgeThreshold, q.edgeThresholdMin);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        }
    };
}

// The compiled shader text is exposed so probes can test the port against a
// synthetic edge without duplicating 700 lines of GLSL.
globalThis.FXAA_FRAGMENT = FXAA_FRAGMENT;
globalThis.FXAA_QUALITY = FXAA_QUALITY;
globalThis.createAntialias = createAntialias;
