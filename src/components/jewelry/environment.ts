/**
 * The room the piece sits in — what the metal reflects.
 *
 * The stones do NOT use this. They refract the light tent in gemEnvironment.ts
 * instead, for the reason set out there: a diamond is a picture of whatever its
 * rays land on, and pointing it at a warehouse renders a warehouse. Metal in a
 * room and stones in a tent is how the photograph is actually taken.
 */
export const ENV_PRESET = "warehouse" as const;
