/**
 * One environment for the whole viewer.
 *
 * The lighting and the diamond material must sample the *same* map: the gems
 * trace their internal bounces against it, so a mismatch would light the metal
 * from one room and the stones from another.
 */
export const ENV_PRESET = "warehouse" as const;
