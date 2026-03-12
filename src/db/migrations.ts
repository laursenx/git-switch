// Embedded migrations — Bun inlines these as string constants at build time.
// When adding new migrations: import the .sql file and append to the array.
// @ts-ignore — Bun handles `with { type: "text" }` imports
import m0000 from "./migrations/0000_whole_thunderbolt.sql" with { type: "text" };

export const migrations: [string, string][] = [
  ["0000_whole_thunderbolt", m0000],
];
