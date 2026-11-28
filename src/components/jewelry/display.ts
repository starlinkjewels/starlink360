import * as THREE from "three";

/*
 * How the studio and the try-on turn light into screen colour. One place,
 * so the two can never drift apart again: a client switching from the studio
 * to Try On should see the same metal, the same stones, the same brightness.
 *
 * Khronos PBR Neutral tone mapping, not ACES Filmic. ACES is a film look: it
 * shifts hues and desaturates as things get bright, so measured metal colours
 * (library.ts) came out more orange and darker than the alloy really is, and
 * rose and yellow gold drifted toward each other. PBR Neutral was published
 * by Khronos for exactly this job, 3D e-commerce, where the product's base
 * colour must reach the screen unchanged under white light. Highlights still
 * roll off smoothly above 0.76, so stones keep their flash.
 */
export const TONE_MAPPING = THREE.NeutralToneMapping;

/*
 * Direct lights, white. Colour in the lights tints the metal: the studio's old
 * blue fill and orange rim made white gold look blue on one side and yellow
 * gold look orange on the other. The HDRI does the shaping; these only add
 * the crisp specular glints a softbox gives a polished surface.
 */
export const LIGHT_WHITE = "#ffffff";
